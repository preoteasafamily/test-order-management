'use strict';

/**
 * E-Factura SPV – Modul V3
 * =========================
 * Modul complet nou (clean slate), construit cu lecțiile din v1, v2 și
 * referințele ANAF oficiale. Arhitectura e separată în servicii independente:
 *
 *   services/efactura-spv-v3/
 *     config.js      – citire/scriere setări din DB, validare token
 *     anaf-client.js – HTTP client cu retry exponențial (fără mTLS)
 *     xml-builder.js – Generator XML UBL 2.1 CIUS-RO
 *
 * Rute (prefix /api/efactura-v3):
 *   GET  /settings                 – Citire configurare
 *   PUT  /settings                 – Salvare configurare
 *   GET  /oauth/authorize          – Generare URL autorizare ANAF
 *   GET  /oauth/callback           – Callback OAuth2 (redirect de la ANAF)
 *   POST /oauth/refresh            – Reînnoire token cu refresh_token
 *   POST /oauth/token-import       – Import token JWT din Postman/curl
 *   GET  /oauth/diagnostic         – Diagnosticare configurare completă
 *   DELETE /oauth/token            – Ștergere token (deconectare)
 *   GET  /status                   – Stare modul (gata/nu)
 *   GET  /action-log               – Jurnal acțiuni (ultimele 50)
 *   POST /upload/:invoiceId        – Încărcare factură XML
 *   GET  /check-status/:invoiceId  – Verificare stare mesaj ANAF
 *   GET  /download/:invoiceId      – Descărcare răspuns ZIP ANAF
 *   GET  /xml/:invoiceId           – Previzualizare XML generat
 *   GET  /messages                 – Lista mesaje SPV
 *   GET  /download-message/:id     – Descărcare mesaj specific
 *   GET  /local-messages           – Mesaje cacheate local
 *   POST /upload-batch             – Încărcare lot facturi
 *   POST /check-status-batch       – Verificare stare lot
 *
 * Cerințe .env (server/.env):
 *   PUBLIC_CALLBACK_URL  – URL extern (ex: https://1.2.3.4:5000) pentru redirect_uri
 *   FRONTEND_URL         – URL frontend React (pentru redirect după callback)
 *
 * Autentificarea se face EXCLUSIV prin browser (OAuth2 cu certificat digital).
 * mTLS NU este configurat pe server – cheia privată NU trebuie extrasă din token-ul USB.
 * Tokenul JWT se obține automat prin browser sau se importă manual din Postman.
 *
 * Modulul folosește services/anaf-oauth2/token-manager.js pentru nucleul OAuth2,
 * cu auto-refresh automat al tokenului înainte de expirare.
 */

const express   = require('express');
const crypto    = require('crypto');
const db        = require('../database');
const rateLimit = require('express-rate-limit');

const {
  getSettings, getApiBase, getRedirectUri, isJwt, isTokenExpired,
  hasValidToken, updateSettings, saveToken, logAction,
} = require('../services/efactura-spv-v3/config');

const { request, withRetry, sleep } =
  require('../services/efactura-spv-v3/anaf-client');

const { buildUBL, stripSchemaLocation } =
  require('../services/efactura-spv-v3/xml-builder');

// Modul standalone OAuth2 JWT – folosit pentru buildAuthUrl, exchangeCode,
// refreshAccessToken și scheduleAutoRefresh (auto-refresh înainte de expirare).
const tokenManager = require('../services/anaf-oauth2/token-manager');

const router = express.Router();

// ─── Constants ─────────────────────────────────────────────────────────────

const ANAF_AUTH_URL  = tokenManager.ANAF_AUTH_URL;
const ANAF_TOKEN_URL = tokenManager.ANAF_TOKEN_URL;
const FRONTEND_URL   = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
const UPLOAD_DELAY   = 300;  // ms between consecutive batch uploads
const STATUS_DELAY   = 200;  // ms between consecutive batch status checks

// ─── Rate limiting ──────────────────────────────────────────────────────────

router.use(
  rateLimit({
    windowMs:       15 * 60 * 1000,
    max:            100,
    standardHeaders: true,
    legacyHeaders:   false,
    message:        { error: 'Prea multe cereri. Reîncercați după 15 minute.' },
  }),
);

// ─── Middleware helpers ─────────────────────────────────────────────────────

/**
 * Express middleware that verifies a valid non-expired JWT token is present.
 * Returns 401 with actionable message if not.
 */
const requireToken = (req, res, next) => {
  const s = getSettings();
  if (!s.oauth_token) {
    return res.status(401).json({
      error:  'Nu există token OAuth2. Autentificați-vă prin GET /api/efactura-v3/oauth/authorize.',
      action: 'authenticate',
    });
  }
  if (!isJwt(s.oauth_token)) {
    return res.status(401).json({
      error:  'Tokenul stocat NU este JWT (lipsesc segmentele base64). Importați un token JWT valid.',
      action: 'import-jwt',
      hint:   'Un token JWT are 3 segmente separate prin puncte: header.payload.signature',
    });
  }
  if (isTokenExpired(s)) {
    return res.status(401).json({
      error:  'Tokenul a expirat. Reînnoinți via POST /api/efactura-v3/oauth/refresh sau autentificați-vă din nou.',
      action: 'refresh-or-reauth',
      expired_at: s.token_expires_at,
    });
  }
  next();
};

// ─── ANAF token exchange helper ─────────────────────────────────────────────

/**
 * Exchange an authorization code or refresh token with ANAF.
 * Delegates to tokenManager which handles retry, validation, and error hints.
 * Authentication is browser-based; this call is made without mTLS.
 * If ANAF returns HTTP 500 (which can happen without client certificate),
 * the user should import a JWT token obtained via Postman instead.
 *
 * @param {{ grant_type, code?, redirect_uri?, refresh_token? }} params
 * @param {string} label  – log label
 * @returns {Promise<object>} – token data
 */
const exchangeToken = async (params, label = 'token_exchange') => {
  const s = getSettings();
  if (params.grant_type === 'authorization_code') {
    return tokenManager.exchangeCode({
      code:         params.code,
      redirectUri:  params.redirect_uri,
      clientId:     s.client_id,
      clientSecret: s.client_secret,
    });
  }
  if (params.grant_type === 'refresh_token') {
    return tokenManager.refreshAccessToken({
      refreshToken:  params.refresh_token,
      clientId:      s.client_id,
      clientSecret:  s.client_secret,
    });
  }
  throw new Error(`grant_type necunoscut: ${params.grant_type}`);
};

// ─── Upload XML parsing helper ───────────────────────────────────────────────

/**
 * Parse ANAF upload response XML string.
 * Returns { uploadId, executionStatus, errors[] } or null on parse failure.
 *
 * @param {string} xml
 * @returns {{ uploadId: string|null, executionStatus: string, errors: string[] }|null}
 */
const parseUploadResponse = (xml) => {
  if (!xml) return null;
  const attr  = (name) => {
    const re = new RegExp(`${name}="([^"]*)"`, 'i');
    const m  = xml.match(re);
    return m ? m[1] : null;
  };
  const errors = [];
  const errRe  = /errorMessage="([^"]*)"/gi;
  let m;
  while ((m = errRe.exec(xml)) !== null) errors.push(m[1]);

  return {
    uploadId:        attr('index_incarcare'),
    executionStatus: attr('ExecutionStatus'),
    errors,
  };
};

// ─── SETTINGS ──────────────────────────────────────────────────────────────

/**
 * GET /api/efactura-v3/settings
 * Returns current settings (client_secret is masked).
 */
router.get('/settings', (req, res) => {
  try {
    const s = getSettings();
    res.json({
      cif:               s.cif,
      environment:       s.environment,
      clientId:          s.client_id,
      clientSecret:      s.client_secret ? '••••••••' : '',
      redirectUri:       s.redirect_uri,
      publicCallbackUrl: s.public_callback_url,
      hasToken:          !!s.oauth_token,
      tokenIsJwt:        isJwt(s.oauth_token),
      tokenExpired:      isTokenExpired(s),
      tokenExpiresAt:    s.token_expires_at,
      lastAction:        s.last_action,
      lastActionAt:      s.last_action_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/efactura-v3/settings
 * Update configuration. Only supplied fields are changed.
 */
router.put('/settings', (req, res) => {
  try {
    const {
      cif, clientId, clientSecret, redirectUri,
      publicCallbackUrl, environment,
    } = req.body;

    const updates = {};
    if (cif               != null) updates.cif               = String(cif).trim();
    if (clientId          != null) updates.client_id          = String(clientId).trim();
    if (clientSecret      != null) updates.client_secret      = String(clientSecret).trim();
    if (redirectUri       != null) updates.redirect_uri       = String(redirectUri).trim();
    if (publicCallbackUrl != null) updates.public_callback_url = String(publicCallbackUrl).trim();
    if (environment       != null) updates.environment        = environment === 'prod' ? 'prod' : 'test';

    updateSettings(updates);
    logAction('settings_updated', updates);
    res.json({ ok: true, message: 'Setări salvate cu succes.' });
  } catch (err) {
    logAction('settings_update_error', null, false, err);
    res.status(500).json({ error: err.message });
  }
});

// ─── OAUTH2 ────────────────────────────────────────────────────────────────

/**
 * GET /api/efactura-v3/oauth/authorize
 * Generate the ANAF authorization URL.
 * IMPORTANT: token_content_type=jwt is MANDATORY – without it ANAF emits an
 * opaque (hex) token that always returns 401 on API calls.
 */
router.get('/oauth/authorize', (req, res) => {
  try {
    const s = getSettings();

    if (!s.client_id || !s.client_secret) {
      return res.status(400).json({
        error: 'Client ID și Client Secret sunt obligatorii. Configurați în Setări.',
      });
    }

    const redirectUri = getRedirectUri(s);
    if (!redirectUri) {
      return res.status(400).json({
        error: 'redirect_uri lipsește. Setați Public Callback URL sau Redirect URI în Setări.',
      });
    }

    // Folosim tokenManager.buildAuthUrl care include automat token_content_type=jwt
    // și generează state anti-CSRF cu 32 octeți cryptografici.
    const { authUrl, state } = tokenManager.buildAuthUrl({
      clientId:    s.client_id,
      redirectUri,
    });

    // Persist state + redirect_uri used (for CSRF check at callback time)
    updateSettings({
      oauth_state:             state,
      oauth_redirect_uri_used: redirectUri,
    });

    logAction('oauth_authorize_generated', { redirectUri });
    res.json({ authUrl, state, redirectUri });
  } catch (err) {
    logAction('oauth_authorize_error', null, false, err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v3/oauth/callback
 * ANAF redirects here after user authenticates with digital certificate in browser.
 * Attempts to exchange the authorization code for a JWT token.
 *
 * ANAF redirect parameters (RFC 6749 §4.1.2):
 *   Success: ?code=<auth_code>&state=<csrf_state>
 *   Error:   ?error=<code>&error_description=<msg>&state=<csrf_state>
 *
 * Common ANAF errors:
 *   access_denied        – User rejected or certificate lacks SPV role
 *   internal_server_error – ANAF server-side issue
 */
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  // ── Helper: send self-contained HTML result page ─────────────────────────
  // Used when FRONTEND_URL is not configured so the user gets a readable
  // response instead of a 404 at the server root.
  const sendResultPage = (success, message) => {
    const title = success ? 'Autentificare reușită' : 'Eroare autentificare ANAF';
    const color = success ? '#28a745' : '#dc3545';
    const icon  = success ? '✅' : '❌';
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(success ? 200 : 400).send(`<!DOCTYPE html>
<html lang="ro">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>
    body { font-family: sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; background: #f8f9fa; }
    .card { max-width: 520px; width: 90%; padding: 2rem; border-radius: 8px;
            box-shadow: 0 2px 16px rgba(0,0,0,.15); background: #fff; text-align: center; }
    h1 { color: ${color}; margin-bottom: .5rem; font-size: 1.4rem; }
    p  { color: #555; margin: 1rem 0; word-break: break-word; }
    a  { display: inline-block; margin-top: 1rem; padding: .5rem 1.5rem;
         background: #0d6efd; color: #fff; text-decoration: none; border-radius: 4px; }
    a:hover { background: #0a58ca; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${icon} ${title}</h1>
    <p>${message}</p>
    <a href="/">Înapoi la aplicație</a>
  </div>
</body>
</html>`);
  };

  // ── Helper: redirect to frontend or fall back to HTML page ───────────────
  const redirectOrRender = (success, msgText) => {
    const encoded = encodeURIComponent(msgText);
    if (FRONTEND_URL) {
      const param = success ? `oauth_success=1` : `oauth_error=${encoded}`;
      return res.redirect(`${FRONTEND_URL}?${param}&section=efactura-v3`);
    }
    return sendResultPage(success, msgText);
  };

  // ── 1. Handle ANAF error redirect ────────────────────────────────────────
  if (error) {
    logAction('oauth_callback_error', { error, error_description }, false);
    let msg = error_description || error;
    if (error === 'access_denied' && !error_description) {
      msg = 'Autorizarea a fost refuzată (access_denied). Cauze posibile: certificatul nu are rolul e-Factura în SPV, utilizatorul a refuzat accesul, sau aplicația nu este autorizată pentru CIF-ul respectiv.';
    }
    return redirectOrRender(false, msg);
  }

  // ── 2. Code must be present ──────────────────────────────────────────────
  if (!code) {
    logAction('oauth_callback_no_code', { query: req.query }, false);
    return redirectOrRender(false, 'Codul de autorizare lipsește din callback-ul ANAF. Reîncercați autentificarea.');
  }

  const s = getSettings();

  // ── 3. Strict CSRF state verification (RFC 6749 §10.12) ──────────────────
  // Both sides must have a state value; if either is missing the session is
  // invalid (e.g., no prior authorize call, session replay, or CSRF attempt).
  if (!state || !s.oauth_state) {
    logAction('oauth_callback_state_missing', { hasState: !!state, hasStored: !!s.oauth_state }, false);
    return redirectOrRender(false,
      'Parametrul state lipsește din sesiunea OAuth2. Sesiunea a expirat sau a apărut o eroare CSRF. Reîncercați autentificarea.');
  }
  if (state !== s.oauth_state) {
    logAction('oauth_callback_state_mismatch', { received: state }, false);
    return redirectOrRender(false,
      'State OAuth2 invalid – posibil atac CSRF. Reîncercați autentificarea.');
  }

  const redirectUri = s.oauth_redirect_uri_used || getRedirectUri(s);

  // ── 4. Clear session state before exchange ───────────────────────────────
  // Clears state before the exchange so any retry of the callback URL fails
  // the state check (auth codes are single-use; a retry always needs re-auth).
  updateSettings({ oauth_state: '', oauth_redirect_uri_used: '' });

  // ── 5. Exchange authorization code for JWT token ──────────────────────────
  try {
    const tokenData = await exchangeToken(
      {
        grant_type:   'authorization_code',
        code,
        redirect_uri:  redirectUri,
      },
      'authorization_code_exchange',
    );

    saveToken(tokenData);
    logAction('oauth_token_obtained', { environment: s.environment });

    return redirectOrRender(true, 'Autentificare ANAF reușită! Tokenul JWT a fost obținut.');
  } catch (err) {
    logAction('oauth_token_exchange_failed', null, false, err);
    return redirectOrRender(false, err.message);
  }
});

/**
 * POST /api/efactura-v3/oauth/refresh
 * Renew access token using the stored refresh_token.
 */
router.post('/oauth/refresh', async (req, res) => {
  try {
    const s = getSettings();
    if (!s.refresh_token) {
      return res.status(400).json({
        error: 'Niciun refresh_token stocat. Autentificați-vă din nou.',
      });
    }

    const tokenData = await exchangeToken(
      {
        grant_type:    'refresh_token',
        refresh_token:  s.refresh_token,
      },
      'token_refresh',
    );

    saveToken(tokenData, /* keepRefreshIfMissing= */ true);
    logAction('oauth_token_refreshed');

    res.json({ ok: true, message: 'Token reînnoit cu succes.', expiresAt: getSettings().token_expires_at });
  } catch (err) {
    logAction('oauth_refresh_failed', null, false, err);
    res.status(err.status || 500).json({
      error:    err.message,
      anafData: err.anafData || null,
    });
  }
});

/**
 * POST /api/efactura-v3/oauth/token-import
 * Import a JWT token obtained externally (Postman, curl, etc.).
 * Body: { access_token, refresh_token?, expires_in? }
 */
router.post('/oauth/token-import', (req, res) => {
  try {
    const { access_token, refresh_token, expires_in } = req.body || {};

    if (!access_token) {
      return res.status(400).json({ error: 'Câmpul access_token este obligatoriu.' });
    }

    if (!isJwt(access_token)) {
      return res.status(400).json({
        error: 'Tokenul furnizat NU este JWT. Un token JWT are 3 segmente base64 separate prin puncte (header.payload.signature).',
        hint:  'Asigurați-vă că ați configurat token_content_type=jwt în Postman (Advanced → Extra Parameters).',
        received_preview: String(access_token).substring(0, 40) + '...',
      });
    }

    saveToken({ access_token, refresh_token, expires_in });
    logAction('token_imported_manually', { hasRefresh: !!refresh_token, expires_in });

    res.json({ ok: true, message: 'Token JWT importat cu succes.', expiresAt: getSettings().token_expires_at });
  } catch (err) {
    logAction('token_import_error', null, false, err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * DELETE /api/efactura-v3/oauth/token
 * Clear stored tokens (logout / deauthenticate).
 */
router.delete('/oauth/token', (req, res) => {
  try {
    updateSettings({ oauth_token: '', refresh_token: '', token_expires_at: '' });
    logAction('token_cleared');
    res.json({ ok: true, message: 'Token șters. Modulul SPV este deconectat.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v3/oauth/diagnostic
 * Returns a full readiness check with actionable issues.
 */
router.get('/oauth/diagnostic', (req, res) => {
  try {
    const s      = getSettings();
    const issues = [];
    const config = {
      environment:          s.environment,
      hasCif:               !!s.cif,
      hasClientId:          !!s.client_id,
      hasClientSecret:      !!s.client_secret,
      redirectUri:          getRedirectUri(s) || '(nesetat)',
      hasToken:             !!s.oauth_token,
      tokenIsJwt:           isJwt(s.oauth_token),
      tokenExpired:         isTokenExpired(s),
      tokenExpiresAt:       s.token_expires_at || null,
      hasRefreshToken:      !!s.refresh_token,
    };

    if (!config.hasCif)          issues.push('CIF lipsă – configurați în Setări');
    if (!config.hasClientId)     issues.push('Client ID lipsă – obțineți din portalul ANAF logincert.anaf.ro');
    if (!config.hasClientSecret) issues.push('Client Secret lipsă');
    if (!config.redirectUri || config.redirectUri === '(nesetat)')
      issues.push('redirect_uri nesetat – completați Public Callback URL în Setări');
    if (!config.hasToken)
      issues.push('Niciun token OAuth2 – autentificați-vă via /oauth/authorize sau importați cu /oauth/token-import');
    if (config.hasToken && !config.tokenIsJwt)
      issues.push('Tokenul NU este JWT – importați un token JWT valid (3 segmente base64 separate prin puncte)');
    if (config.hasToken && config.tokenIsJwt && config.tokenExpired)
      issues.push('Token expirat – reînnoinți via POST /oauth/refresh sau autentificați-vă din nou');

    res.json({ ready: issues.length === 0, issues, config });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── STATUS & LOG ──────────────────────────────────────────────────────────

/**
 * GET /api/efactura-v3/status
 * Quick readiness check.
 */
router.get('/status', (req, res) => {
  try {
    const s = getSettings();
    const ready = isJwt(s.oauth_token) && !isTokenExpired(s);
    res.json({
      ready,
      environment:   s.environment,
      cif:           s.cif || null,
      tokenValid:    ready,
      tokenExpiresAt: s.token_expires_at || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v3/action-log
 * Returns the last 50 actions from the audit log.
 */
router.get('/action-log', (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT id, action, details, success, error_message, created_at
         FROM spv_v3_action_log
         ORDER BY id DESC
         LIMIT 50`,
      )
      .all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── XML PREVIEW ───────────────────────────────────────────────────────────

/**
 * GET /api/efactura-v3/xml/:invoiceId
 * Preview the generated UBL 2.1 XML for an invoice.
 */
router.get('/xml/:invoiceId', (req, res) => {
  try {
    const inv = db
      .prepare('SELECT * FROM billing_invoices WHERE id = ?')
      .get(req.params.invoiceId);
    if (!inv) {
      return res.status(404).json({ error: 'Factură negăsită.' });
    }
    const xml = stripSchemaLocation(buildUBL(inv));
    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── INVOICE OPERATIONS ─────────────────────────────────────────────────────

/**
 * POST /api/efactura-v3/upload/:invoiceId
 * Generate UBL XML and upload to ANAF SPV.
 * Requires a valid JWT token.
 */
router.post('/upload/:invoiceId', requireToken, async (req, res) => {
  const { invoiceId } = req.params;
  const s = getSettings();

  try {
    const inv = db
      .prepare('SELECT * FROM billing_invoices WHERE id = ?')
      .get(invoiceId);
    if (!inv) {
      return res.status(404).json({ error: `Factura ${invoiceId} nu a fost găsită în baza de date.` });
    }

    const xml     = stripSchemaLocation(buildUBL(inv));
    const apiBase = getApiBase(s);

    // Mark as uploading
    db.prepare(`UPDATE billing_invoices SET spv_status = 'uploading', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(invoiceId);

    const uploadRes = await withRetry(
      () => request(`${apiBase}/upload?standard=UBL&cif=${encodeURIComponent(s.cif)}`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${s.oauth_token}`,
          'Content-Type':  'text/plain',  // ANAF standard per test-spv2 reference
        },
        body: xml,
      }),
      `upload:${invoiceId}`,
    );

    const rawBody = uploadRes._raw;

    if (uploadRes.status === 401) {
      const err401 = 'ANAF a respins tokenul (401 Unauthorized). Cel mai frecvent: tokenul nu este JWT sau a expirat. ' +
        'Soluție: importați un token JWT proaspăt via POST /api/efactura-v3/oauth/token-import.';
      db.prepare(`UPDATE billing_invoices SET spv_status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(invoiceId);
      logAction('upload_rejected_401', { invoiceId }, false, err401);
      return res.status(401).json({ error: err401, anafHttpStatus: 401 });
    }

    if (!uploadRes.ok) {
      const errMsg = `ANAF upload eșuat – HTTP ${uploadRes.status}: ${rawBody.substring(0, 300)}`;
      db.prepare(`UPDATE billing_invoices SET spv_status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(invoiceId);
      logAction('upload_failed', { invoiceId, status: uploadRes.status }, false, errMsg);
      return res.status(uploadRes.status).json({ error: errMsg, anafHttpStatus: uploadRes.status, anafBody: rawBody });
    }

    // Parse the XML response from ANAF
    const parsed = parseUploadResponse(rawBody);
    const uploadId = parsed?.uploadId || null;

    db.prepare(
      `UPDATE billing_invoices
       SET spv_status = 'uploaded', spv_uploaded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(invoiceId);

    logAction('upload_success', { invoiceId, uploadId });

    res.json({
      ok:           true,
      uploadId,
      status:       'uploaded',
      anafResponse: rawBody,
      parsed,
    });
  } catch (err) {
    db.prepare(`UPDATE billing_invoices SET spv_status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(invoiceId);
    logAction('upload_error', { invoiceId }, false, err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v3/check-status/:invoiceId
 * Check the ANAF processing status for an uploaded invoice.
 */
router.get('/check-status/:invoiceId', requireToken, async (req, res) => {
  const { invoiceId } = req.params;
  const s = getSettings();

  try {
    const inv = db
      .prepare('SELECT * FROM billing_invoices WHERE id = ?')
      .get(invoiceId);
    if (!inv) {
      return res.status(404).json({ error: 'Factura negăsită.' });
    }
    if (!inv.spv_upload_id && !req.query.uploadId) {
      return res.status(400).json({ error: 'ID upload ANAF necunoscut. Furnizați ?uploadId=... sau încărcați factura mai întâi.' });
    }

    const uploadId = req.query.uploadId || inv.spv_upload_id;
    const apiBase  = getApiBase(s);

    const statusRes = await withRetry(
      () => request(`${apiBase}/stareMesaj?id_incarcare=${encodeURIComponent(uploadId)}`, {
        headers: { 'Authorization': `Bearer ${s.oauth_token}` },
      }),
      `check-status:${invoiceId}`,
    );

    if (!statusRes.ok) {
      return res.status(statusRes.status).json({
        error: `ANAF status check eșuat – HTTP ${statusRes.status}`,
        body:  statusRes._raw,
      });
    }

    let statusData = {};
    try { statusData = JSON.parse(statusRes._raw); } catch { /* XML or plain */ }

    logAction('check_status', { invoiceId, uploadId, status: statusRes.status });
    res.json({ ok: true, uploadId, statusData, raw: statusRes._raw });
  } catch (err) {
    logAction('check_status_error', { invoiceId }, false, err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v3/download/:invoiceId
 * Download ANAF response ZIP for an uploaded invoice.
 */
router.get('/download/:invoiceId', requireToken, async (req, res) => {
  const { invoiceId } = req.params;
  const s = getSettings();

  try {
    const inv = db
      .prepare('SELECT * FROM billing_invoices WHERE id = ?')
      .get(invoiceId);
    if (!inv) {
      return res.status(404).json({ error: 'Factura negăsită.' });
    }

    const uploadId = req.query.uploadId || inv.spv_upload_id;
    if (!uploadId) {
      return res.status(400).json({ error: 'ID upload ANAF necunoscut.' });
    }

    const apiBase = getApiBase(s);
    const dlRes   = await withRetry(
      () => request(`${apiBase}/descarcare?id=${encodeURIComponent(uploadId)}`, {
        headers: { 'Authorization': `Bearer ${s.oauth_token}` },
      }),
      `download:${invoiceId}`,
    );

    if (!dlRes.ok) {
      return res.status(dlRes.status).json({
        error: `ANAF download eșuat – HTTP ${dlRes.status}`,
      });
    }

    logAction('download_response', { invoiceId, uploadId });
    res.set('Content-Type', dlRes.headers['content-type'] || 'application/zip');
    res.set('Content-Disposition', `attachment; filename="anaf_${uploadId}.zip"`);
    res.send(Buffer.from(dlRes._raw, 'utf8'));
  } catch (err) {
    logAction('download_error', { invoiceId }, false, err);
    res.status(500).json({ error: err.message });
  }
});

// ─── MESSAGES ──────────────────────────────────────────────────────────────

/**
 * GET /api/efactura-v3/messages?days=30&filter=E
 * Fetch SPV messages from ANAF (last N days, optional type filter).
 */
router.get('/messages', requireToken, async (req, res) => {
  const s    = getSettings();
  const days = Math.min(Math.max(parseInt(req.query.days || '30', 10), 1), 60);
  const filter = req.query.filter || 'E';  // E = e-Factura messages
  const apiBase = getApiBase(s);

  try {
    const msgRes = await withRetry(
      () => request(
        `${apiBase}/listaMesajeFactura?zile=${days}&cif=${encodeURIComponent(s.cif)}&filter=${filter}`,
        { headers: { 'Authorization': `Bearer ${s.oauth_token}` } },
      ),
      'list_messages',
    );

    if (!msgRes.ok) {
      return res.status(msgRes.status).json({
        error: `ANAF messages eșuat – HTTP ${msgRes.status}`,
        body:  msgRes._raw,
      });
    }

    let data = {};
    try { data = JSON.parse(msgRes._raw); } catch { data = { raw: msgRes._raw }; }

    // Cache messages in local DB
    const messages = data.mesaje || data.messages || data.Messages || [];
    if (Array.isArray(messages)) {
      const upsert = db.prepare(`
        INSERT OR IGNORE INTO spv_messages
          (anaf_message_id, tip, data_creare, cif, id_solicitant, detalii, id_descarcare)
        VALUES (@anaf_message_id, @tip, @data_creare, @cif, @id_solicitant, @detalii, @id_descarcare)
      `);
      const tx = db.transaction((msgs) => {
        msgs.forEach((m) => upsert.run({
          anaf_message_id: String(m.id || m.Id || ''),
          tip:             m.tip || m.Tip || '',
          data_creare:     m.data_creare || m.DataCreare || '',
          cif:             m.cif || m.Cif || s.cif,
          id_solicitant:   String(m.id_solicitant || m.IdSolicitant || ''),
          detalii:         m.detalii || m.Detalii || '',
          id_descarcare:   String(m.id_descarcare || m.IdDescarcare || ''),
        }));
      });
      tx(messages);
    }

    logAction('messages_fetched', { count: messages.length, days, filter });
    res.json({ ok: true, count: messages.length, messages, raw: msgRes._raw });
  } catch (err) {
    logAction('messages_error', null, false, err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v3/download-message/:id
 * Download a specific SPV message by its ANAF download ID.
 */
router.get('/download-message/:id', requireToken, async (req, res) => {
  const s       = getSettings();
  const apiBase = getApiBase(s);
  const msgId   = req.params.id;

  try {
    const dlRes = await withRetry(
      () => request(`${apiBase}/descarcare?id=${encodeURIComponent(msgId)}`, {
        headers: { 'Authorization': `Bearer ${s.oauth_token}` },
      }),
      `download-message:${msgId}`,
    );

    if (!dlRes.ok) {
      return res.status(dlRes.status).json({ error: `ANAF HTTP ${dlRes.status}` });
    }

    logAction('message_downloaded', { msgId });
    res.set('Content-Type', dlRes.headers['content-type'] || 'application/zip');
    res.set('Content-Disposition', `attachment; filename="msg_${msgId}.zip"`);
    res.send(Buffer.from(dlRes._raw, 'binary'));
  } catch (err) {
    logAction('download_message_error', { msgId }, false, err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v3/local-messages
 * Return cached SPV messages from the local database.
 */
router.get('/local-messages', (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT id, anaf_message_id, tip, data_creare, cif,
                id_solicitant, detalii, id_descarcare, downloaded_at, created_at
         FROM spv_messages
         ORDER BY id DESC
         LIMIT 200`,
      )
      .all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── BATCH OPERATIONS ──────────────────────────────────────────────────────

/**
 * POST /api/efactura-v3/upload-batch
 * Upload multiple invoices sequentially with a delay between each.
 * Body: { invoiceIds: string[] }
 */
router.post('/upload-batch', requireToken, async (req, res) => {
  const { invoiceIds } = req.body || {};
  if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
    return res.status(400).json({ error: 'invoiceIds trebuie să fie un array nevid.' });
  }

  const results = [];
  for (const invoiceId of invoiceIds) {
    try {
      const s   = getSettings();
      const inv = db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(invoiceId);
      if (!inv) {
        results.push({ invoiceId, ok: false, error: 'Factură negăsită' });
        continue;
      }

      const xml = stripSchemaLocation(buildUBL(inv));
      const uploadRes = await withRetry(
        () => request(`${getApiBase(s)}/upload?standard=UBL&cif=${encodeURIComponent(s.cif)}`, {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${s.oauth_token}`,
            'Content-Type':  'text/plain',
          },
          body: xml,
        }),
        `batch-upload:${invoiceId}`,
      );

      const parsed  = parseUploadResponse(uploadRes._raw);
      const uploadId = parsed?.uploadId || null;

      if (uploadRes.ok) {
        db.prepare(`UPDATE billing_invoices SET spv_status = 'uploaded', spv_uploaded_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(invoiceId);
        results.push({ invoiceId, ok: true, uploadId, status: uploadRes.status });
      } else {
        db.prepare(`UPDATE billing_invoices SET spv_status = 'error', updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(invoiceId);
        results.push({ invoiceId, ok: false, status: uploadRes.status, body: uploadRes._raw.substring(0, 200) });
      }
    } catch (err) {
      results.push({ invoiceId, ok: false, error: err.message });
    }

    // Throttle between uploads
    await sleep(UPLOAD_DELAY);
  }

  logAction('batch_upload', { count: invoiceIds.length, succeeded: results.filter((r) => r.ok).length });
  res.json({ ok: true, results });
});

/**
 * POST /api/efactura-v3/check-status-batch
 * Check ANAF processing status for multiple upload IDs.
 * Body: { items: [{ invoiceId, uploadId }] }
 */
router.post('/check-status-batch', requireToken, async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items trebuie să fie un array nevid.' });
  }

  const s       = getSettings();
  const apiBase = getApiBase(s);
  const results = [];

  for (const { invoiceId, uploadId } of items) {
    if (!uploadId) {
      results.push({ invoiceId, ok: false, error: 'uploadId lipsă' });
      continue;
    }
    try {
      const statusRes = await withRetry(
        () => request(`${apiBase}/stareMesaj?id_incarcare=${encodeURIComponent(uploadId)}`, {
          headers: { 'Authorization': `Bearer ${s.oauth_token}` },
        }),
        `batch-status:${invoiceId}`,
      );

      let statusData = {};
      try { statusData = JSON.parse(statusRes._raw); } catch { /* ignore */ }

      results.push({ invoiceId, uploadId, ok: statusRes.ok, status: statusRes.status, statusData });
    } catch (err) {
      results.push({ invoiceId, uploadId, ok: false, error: err.message });
    }
    await sleep(STATUS_DELAY);
  }

  logAction('batch_check_status', { count: items.length });
  res.json({ ok: true, results });
});

// ─── INVOICES LIST ─────────────────────────────────────────────────────────

/**
 * GET /api/efactura-v3/invoices?page=1&limit=20&status=
 * List billing invoices with SPV status info.
 */
router.get('/invoices', (req, res) => {
  try {
    const page   = Math.max(parseInt(req.query.page  || '1',  10), 1);
    const limit  = Math.min(parseInt(req.query.limit || '20', 10), 100);
    const offset = (page - 1) * limit;
    const status = req.query.status || null;

    const where = status ? 'WHERE spv_status = ?' : '';
    const args  = status ? [status, limit, offset] : [limit, offset];

    const rows  = db.prepare(
      `SELECT id, invoice_code, order_id, document_date, status, spv_status,
              spv_uploaded_at, total_with_vat, bt_44_buyer_name, created_at
       FROM billing_invoices ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
    ).all(...args);

    const total = db.prepare(
      `SELECT COUNT(*) as cnt FROM billing_invoices ${where}`,
    ).get(...(status ? [status] : []));

    res.json({ ok: true, invoices: rows, total: total.cnt, page, limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

// ─── Auto-Refresh Scheduler ───────────────────────────────────────────────────
// Pornit la prima importare a modulului (odată cu serverul).
// Se oprește automat la SIGTERM/SIGINT via handler-ul din server.js.
// Reînnoiește tokenul JWT cu 10 minute înainte de expirare.

const _stopAutoRefresh = tokenManager.scheduleAutoRefresh({
  getToken:  () => getSettings(),
  saveToken: (d) => {
    // keepRefreshIfMissing=true → saveToken (config.js) păstrează refresh_token vechi
    saveToken(d, /* keepRefreshIfMissing */ !d.refresh_token);
    logAction('oauth_token_auto_refreshed', { expiresAt: d.token_expires_at });
  },
  onError: (err) => {
    logAction('oauth_auto_refresh_failed', null, false, err);
    console.error('[SPV-V3] Auto-refresh eșuat:', err.message);
  },
});

// Curățare la oprirea procesului
process.once('SIGTERM', _stopAutoRefresh);
process.once('SIGINT',  _stopAutoRefresh);

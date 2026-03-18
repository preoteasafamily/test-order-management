/**
 * ANAF OAuth2 & e-Factura SPV Integration
 *
 * Flux OAuth2 (Authorization Code Flow):
 * 1. Utilizatorul apasă "Autorizează în ANAF" → redirect la logincert.anaf.ro cu client_id
 * 2. ANAF redirecționează înapoi la redirect_uri cu ?code=... (authorization code)
 * 3. Serverul schimbă code-ul pe access_token + refresh_token via POST la /token
 * 4. Token-urile sunt stocate în baza de date
 * 5. La upload XML, se folosește access_token în header Authorization: Bearer <token>
 * 6. La expirare, se folosește refresh_token pentru a obține un nou access_token
 *
 * Endpoint-uri ANAF:
 * - Authorize: https://logincert.anaf.ro/anaf-oauth2/v1/authorize
 * - Token:     https://logincert.anaf.ro/anaf-oauth2/v1/token
 * - Upload (test): https://api.anaf.ro/test/FCTEL/rest/upload
 * - Upload (prod): https://api.anaf.ro/prod/FCTEL/rest/upload
 * - Status (test): https://api.anaf.ro/test/FCTEL/rest/stareMesaj
 * - Status (prod): https://api.anaf.ro/prod/FCTEL/rest/stareMesaj
 * - List   (test): https://api.anaf.ro/test/FCTEL/rest/listaMesajeFactura
 * - List   (prod): https://api.anaf.ro/prod/FCTEL/rest/listaMesajeFactura
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const rateLimit = require('express-rate-limit');

// ─── Constants ────────────────────────────────────────────────────────────────

const ANAF_AUTHORIZE_URL = 'https://logincert.anaf.ro/anaf-oauth2/v1/authorize';
const ANAF_TOKEN_URL     = 'https://logincert.anaf.ro/anaf-oauth2/v1/token';

const ANAF_API_BASE = {
  test: 'https://api.anaf.ro/test/FCTEL/rest',
  prod: 'https://api.anaf.ro/prod/FCTEL/rest',
};

const TOKEN_STORE_KEY = 'anaf_oauth_token';
const CONFIG_KEY      = 'anaf_oauth_config';

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const anafLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(anafLimiter);

// ─── DB helpers ───────────────────────────────────────────────────────────────

function getAppConfig(key) {
  try {
    const row = db.prepare("SELECT value FROM app_config WHERE key = ?").get(key);
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

function setAppConfig(key, value) {
  db.prepare(`
    INSERT INTO app_config (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value));
}

// ─── Token helpers ────────────────────────────────────────────────────────────

function loadToken() {
  return getAppConfig(TOKEN_STORE_KEY);
}

function saveToken(tokenData) {
  setAppConfig(TOKEN_STORE_KEY, {
    access_token:  tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_type:    tokenData.token_type || 'Bearer',
    expires_in:    tokenData.expires_in,
    // Store absolute expiry timestamp (ms)
    expires_at:    Date.now() + (tokenData.expires_in || 600) * 1000,
    obtained_at:   Date.now(),
  });
}

function isTokenValid(token) {
  if (!token || !token.access_token) return false;
  // Consider token valid if it has more than 60 seconds left
  return token.expires_at && token.expires_at > Date.now() + 60_000;
}

// ─── GET /api/anaf/config ─────────────────────────────────────────────────────
// Returns the stored OAuth2 config (without exposing client_secret)

router.get('/config', (req, res) => {
  try {
    const cfg = getAppConfig(CONFIG_KEY) || {};
    const token = loadToken();
    res.json({
      client_id:    cfg.client_id    || '',
      redirect_uri: cfg.redirect_uri || '',
      cif:          cfg.cif          || '',
      environment:  cfg.environment  || 'test',
      has_secret:   !!(cfg.client_secret),
      token_status: token
        ? {
            has_token:     true,
            is_valid:      isTokenValid(token),
            expires_at:    token.expires_at,
            has_refresh:   !!(token.refresh_token),
            obtained_at:   token.obtained_at,
          }
        : { has_token: false, is_valid: false },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/anaf/config ────────────────────────────────────────────────────
// Save OAuth2 configuration

router.post('/config', (req, res) => {
  try {
    const { client_id, client_secret, redirect_uri, cif, environment } = req.body;

    if (!client_id || !redirect_uri || !cif) {
      return res.status(400).json({ error: 'client_id, redirect_uri și cif sunt obligatorii.' });
    }

    const existing = getAppConfig(CONFIG_KEY) || {};
    const updated = {
      ...existing,
      client_id:    String(client_id).trim(),
      redirect_uri: String(redirect_uri).trim(),
      cif:          String(cif).trim(),
      environment:  environment === 'prod' ? 'prod' : 'test',
    };

    // Only update client_secret if provided (non-empty)
    if (client_secret && String(client_secret).trim()) {
      updated.client_secret = String(client_secret).trim();
    }

    setAppConfig(CONFIG_KEY, updated);
    res.json({ ok: true, message: 'Configurare ANAF salvată cu succes.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/anaf/authorize-url ─────────────────────────────────────────────
// Build and return the authorization URL (frontend will open it in a new tab)

router.get('/authorize-url', (req, res) => {
  try {
    const cfg = getAppConfig(CONFIG_KEY);
    if (!cfg || !cfg.client_id || !cfg.redirect_uri) {
      return res.status(400).json({
        error: 'Configurarea OAuth2 este incompletă. Salvați client_id și redirect_uri mai întâi.',
      });
    }

    const params = new URLSearchParams({
      response_type:      'code',
      client_id:          cfg.client_id,
      redirect_uri:       cfg.redirect_uri,
      token_content_type: 'jwt',
    });

    res.json({ url: `${ANAF_AUTHORIZE_URL}?${params.toString()}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/anaf/oauth/callback ───────────────────────────────────────────
// Exchange authorization code for access + refresh tokens
// Frontend calls this with the `code` it received in the redirect

router.post('/oauth/callback', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Parametrul "code" lipsește.' });
    }

    const cfg = getAppConfig(CONFIG_KEY);
    if (!cfg || !cfg.client_id || !cfg.client_secret || !cfg.redirect_uri) {
      return res.status(400).json({ error: 'Configurarea OAuth2 este incompletă.' });
    }

    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      code:          String(code).trim(),
      client_id:     cfg.client_id,
      client_secret: cfg.client_secret,
      redirect_uri:  cfg.redirect_uri,
    });

    const response = await fetch(ANAF_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });

    const text = await response.text();
    let tokenData;
    try {
      tokenData = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: 'Răspuns invalid de la serverul ANAF.',
        raw:   text.slice(0, 500),
      });
    }

    if (!response.ok || tokenData.error) {
      return res.status(response.status || 400).json({
        error:       tokenData.error_description || tokenData.error || 'Eroare la obținerea token-ului.',
        anaf_error:  tokenData,
      });
    }

    saveToken(tokenData);
    res.json({
      ok:         true,
      message:    'Token ANAF obținut și salvat cu succes.',
      expires_in: tokenData.expires_in,
      has_refresh: !!(tokenData.refresh_token),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/anaf/token/refresh ────────────────────────────────────────────
// Refresh access token using refresh_token

router.post('/token/refresh', async (req, res) => {
  try {
    const cfg   = getAppConfig(CONFIG_KEY);
    const token = loadToken();

    if (!cfg || !cfg.client_id || !cfg.client_secret) {
      return res.status(400).json({ error: 'Configurarea OAuth2 este incompletă.' });
    }

    if (!token || !token.refresh_token) {
      return res.status(400).json({ error: 'Nu există refresh_token salvat. Autorizați din nou.' });
    }

    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: token.refresh_token,
      client_id:     cfg.client_id,
      client_secret: cfg.client_secret,
    });

    const response = await fetch(ANAF_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });

    const text = await response.text();
    let tokenData;
    try {
      tokenData = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: 'Răspuns invalid de la serverul ANAF.',
        raw:   text.slice(0, 500),
      });
    }

    if (!response.ok || tokenData.error) {
      return res.status(response.status || 400).json({
        error:      tokenData.error_description || tokenData.error || 'Eroare la reîmprospătarea token-ului.',
        anaf_error: tokenData,
      });
    }

    saveToken(tokenData);
    res.json({
      ok:         true,
      message:    'Token ANAF reîmprospătat cu succes.',
      expires_in: tokenData.expires_in,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DELETE /api/anaf/token ───────────────────────────────────────────────────
// Clear stored token (logout)

router.delete('/token', (req, res) => {
  try {
    db.prepare("DELETE FROM app_config WHERE key = ?").run(TOKEN_STORE_KEY);
    res.json({ ok: true, message: 'Token ANAF șters.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/anaf/token/status ──────────────────────────────────────────────
// Check current token status

router.get('/token/status', (req, res) => {
  try {
    const token = loadToken();
    if (!token) {
      return res.json({ has_token: false, is_valid: false });
    }
    res.json({
      has_token:   true,
      is_valid:    isTokenValid(token),
      expires_at:  token.expires_at,
      has_refresh: !!(token.refresh_token),
      obtained_at: token.obtained_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Internal: get valid access token (auto-refresh if needed) ────────────────

async function getValidAccessToken() {
  const cfg   = getAppConfig(CONFIG_KEY);
  let token   = loadToken();

  if (!token || !token.access_token) {
    throw new Error('Nu există token ANAF. Autorizați aplicația mai întâi.');
  }

  if (isTokenValid(token)) {
    return token.access_token;
  }

  // Try refresh
  if (token.refresh_token && cfg && cfg.client_id && cfg.client_secret) {
    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: token.refresh_token,
      client_id:     cfg.client_id,
      client_secret: cfg.client_secret,
    });

    const response = await fetch(ANAF_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });

    const data = await response.json();
    if (response.ok && data.access_token) {
      saveToken(data);
      return data.access_token;
    }
  }

  throw new Error('Token-ul ANAF a expirat și reîmprospătarea a eșuat. Autorizați din nou.');
}

// ─── POST /api/anaf/upload ────────────────────────────────────────────────────
// Upload XML (UBL) invoice to ANAF SPV
// Body: { xml: string, cif?: string, environment?: 'test'|'prod' }

router.post('/upload', async (req, res) => {
  try {
    const cfg = getAppConfig(CONFIG_KEY);
    const { xml, cif: cifOverride, environment: envOverride } = req.body;

    if (!xml) {
      return res.status(400).json({ error: 'Parametrul "xml" (conținut XML UBL) lipsește.' });
    }

    const env = envOverride || cfg?.environment || 'test';
    const cif = cifOverride || cfg?.cif;

    if (!cif) {
      return res.status(400).json({ error: 'CIF-ul furnizorului este necesar pentru upload.' });
    }

    const accessToken = await getValidAccessToken();

    const params = new URLSearchParams({ standard: 'UBL', cif: String(cif) });
    const uploadUrl = `${ANAF_API_BASE[env]}/upload?${params.toString()}`;

    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Type':  'text/plain',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: xml,
    });

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = { raw: text };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error:      result.message || result.raw || 'Eroare la upload ANAF.',
        anaf_response: result,
        status_code: response.status,
      });
    }

    res.json({
      ok:          true,
      id_incarcare: result.index_incarcare,
      anaf_response: result,
      environment:  env,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/anaf/status/:id ─────────────────────────────────────────────────
// Check upload status by id_incarcare

router.get('/status/:id', async (req, res) => {
  try {
    const cfg = getAppConfig(CONFIG_KEY);
    const env = req.query.environment || cfg?.environment || 'test';
    const { id } = req.params;

    const accessToken = await getValidAccessToken();

    const params = new URLSearchParams({ id_incarcare: id });
    const url = `${ANAF_API_BASE[env]}/stareMesaj?${params.toString()}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = { raw: text };
    }

    res.status(response.ok ? 200 : response.status).json({
      status_code:   response.status,
      anaf_response: result,
      environment:   env,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/anaf/messages ───────────────────────────────────────────────────
// List received/sent messages from SPV
// Query: ?zile=7&tip=E&cif=...

router.get('/messages', async (req, res) => {
  try {
    const cfg = getAppConfig(CONFIG_KEY);
    const env = req.query.environment || cfg?.environment || 'test';
    const zile = req.query.zile || '7';
    const tip  = req.query.tip  || 'E'; // E = emise, P = primite, T = toate
    const cif  = req.query.cif  || cfg?.cif;

    if (!cif) {
      return res.status(400).json({ error: 'CIF-ul este necesar.' });
    }

    const accessToken = await getValidAccessToken();

    const params = new URLSearchParams({ zile: String(zile), cif: String(cif), tip });
    const url = `${ANAF_API_BASE[env]}/listaMesajeFactura?${params.toString()}`;

    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      result = { raw: text };
    }

    res.status(response.ok ? 200 : response.status).json({
      status_code:   response.status,
      anaf_response: result,
      environment:   env,
      messages:      result.mesaje || result.messages || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

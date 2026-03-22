/**
 * E-Factura SPV-V2 – Modul nou, construit de la zero
 * ====================================================
 * Autentificare OAuth2 ANAF (cu mTLS obligatoriu pentru token exchange)
 * și încărcare/gestiune facturi în SPV ANAF.
 *
 * Lecții aplicate din test-spv1, test-spv2, test-spv3 și documentația ANAF:
 *   - Content-Type: text/plain pentru upload (nu application/xml) – per test-spv2
 *   - token_content_type=jwt obligatoriu la authorize – tokenele opace returnează 401
 *   - Tokenele non-JWT sunt respinse explicit (nu doar avertizate)
 *   - Toate apelurile ANAF prin Node.js https (nu fetch) pentru control mai bun
 *   - mTLS configurat via ANAF_CERT_PATH / ANAF_KEY_PATH în .env
 *   - Retry cu backoff exponențial pentru erori 5xx ANAF
 *
 * URL-uri ANAF:
 *   Authorize: https://logincert.anaf.ro/anaf-oauth2/v1/authorize
 *   Token:     https://logincert.anaf.ro/anaf-oauth2/v1/token
 *   Test API:  https://api.anaf.ro/test/FCTEL/rest/
 *   Prod API:  https://api.anaf.ro/prod/FCTEL/rest/
 *
 * Rute (prefix /api/efactura-v2):
 *   GET  /settings
 *   PUT  /settings
 *   GET  /oauth/authorize
 *   GET  /oauth/callback
 *   POST /oauth/refresh
 *   POST /oauth/token-import
 *   GET  /oauth/diagnostic
 *   GET  /status
 *   GET  /action-log
 *   POST /upload/:invoiceId
 *   GET  /check-status/:invoiceId
 *   GET  /download/:invoiceId
 *   GET  /xml/:invoiceId
 *   GET  /messages
 *   GET  /download-message/:id
 *   GET  /local-messages
 *   POST /upload-batch
 *   POST /check-status-batch
 */

'use strict';

const express    = require('express');
const router     = express.Router();
const crypto     = require('crypto');
const https      = require('https');
const http       = require('http');
const fs         = require('fs');
const db         = require('../database');
const rateLimit  = require('express-rate-limit');

// ── Constante ANAF ────────────────────────────────────────────────────────────

const ANAF_AUTH_URL   = 'https://logincert.anaf.ro/anaf-oauth2/v1/authorize';
const ANAF_TOKEN_URL  = 'https://logincert.anaf.ro/anaf-oauth2/v1/token';
const ANAF_TEST_BASE  = 'https://api.anaf.ro/test/FCTEL/rest';
const ANAF_PROD_BASE  = 'https://api.anaf.ro/prod/FCTEL/rest';
const FRONTEND_URL    = (process.env.FRONTEND_URL || '').replace(/\/$/, '');

const UPLOAD_DELAY_MS      = 300;  // ms între uploaduri consecutive (batch)
const STATUS_DELAY_MS      = 200;  // ms între verificări status consecutive (batch)
const MAX_RETRY            = 3;    // număr maxim reîncercări la erori 5xx ANAF
const RETRY_BASE_MS        = 1000; // baza pentru backoff exponențial (ms)

// ── Rate limiting ─────────────────────────────────────────────────────────────

router.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Prea multe cereri. Încercați din nou după 15 minute.' },
}));

// ── mTLS – certificat digital calificat ANAF ──────────────────────────────────
//
// ANAF impune prezentarea certificatului client (Mutual TLS) la:
//   POST /token      – obținere access_token din authorization_code
//   POST /token      – reînnoire token cu refresh_token
//
// Configurare în server/.env:
//   ANAF_CERT_PATH       – cale absolută spre fișierul certificat (PEM)
//   ANAF_KEY_PATH        – cale absolută spre fișierul cheie privată (PEM)
//   ANAF_CERT_PASSPHRASE – (opțional) parola cheii private criptate

let _mtlsAgent = null;
let _mtlsWarnedOnce = false;

/**
 * Returnează https.Agent configurat cu certificatul mTLS ANAF.
 * Lazy-initialized, cached. Returnează null dacă nu e configurat.
 */
const getMtlsAgent = () => {
  if (_mtlsAgent) return _mtlsAgent;

  const certPath   = process.env.ANAF_CERT_PATH;
  const keyPath    = process.env.ANAF_KEY_PATH;
  const passphrase = process.env.ANAF_CERT_PASSPHRASE;

  if (!certPath || !keyPath) {
    if (!_mtlsWarnedOnce) {
      console.warn(
        '[SPV-V2] ⚠ mTLS NECONFIGURAT – ANAF_CERT_PATH / ANAF_KEY_PATH lipsesc din server/.env.\n' +
        '         Token exchange va eșua (HTTP 500) fără certificat digital calificat.\n' +
        '         Configurați:\n' +
        '           ANAF_CERT_PATH=/cale/cert.pem\n' +
        '           ANAF_KEY_PATH=/cale/key.pem\n' +
        '           ANAF_CERT_PASSPHRASE=parola_optionala'
      );
      _mtlsWarnedOnce = true;
    }
    return null;
  }

  try {
    const opts = {
      cert: fs.readFileSync(certPath),
      key:  fs.readFileSync(keyPath),
    };
    if (passphrase) opts.passphrase = passphrase;
    _mtlsAgent = new https.Agent(opts);
    console.log('[SPV-V2] ✓ Certificat mTLS ANAF încărcat cu succes.');
    return _mtlsAgent;
  } catch (err) {
    console.error(`[SPV-V2] ✗ Eroare la încărcarea certificatelor mTLS: ${err.message}`);
    return null;
  }
};

// ── HTTP helper – toate apelurile ANAF prin Node.js https ─────────────────────

/**
 * Efectuează un request HTTPS cu suport opțional mTLS.
 * Returnează { status, ok, headers, text(), json() }
 *
 * @param {string} url
 * @param {{ method?, headers?, body?, useMtls? }} opts
 */
const anafRequest = (url, opts = {}) =>
  new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const agent  = opts.useMtls ? getMtlsAgent() : null;

    // Pregătim body-ul și calculăm Content-Length pentru a evita chunked transfer
    const bodyBuf = opts.body != null
      ? (Buffer.isBuffer(opts.body) ? opts.body : Buffer.from(String(opts.body), 'utf8'))
      : null;

    const headers = { ...(opts.headers || {}) };
    if (bodyBuf) headers['Content-Length'] = bodyBuf.length;

    const reqOpts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ''),
      method:   opts.method || 'GET',
      headers,
      ...(agent ? { agent } : {}),
    };

    const req = https.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          ok:     res.statusCode >= 200 && res.statusCode < 300,
          headers: res.headers,
          text:   () => Promise.resolve(raw),
          json:   () => {
            try   { return Promise.resolve(JSON.parse(raw)); }
            catch { return Promise.reject(new SyntaxError(`ANAF non-JSON: ${raw.substring(0, 200)}`)); }
          },
          _raw: raw,
        });
      });
    });

    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });

/**
 * Apel ANAF cu retry exponențial pentru erori 5xx.
 * @param {Function} fn – funcție async care returnează promisiunea anafRequest
 */
const withRetry = async (fn, label = 'ANAF') => {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      const res = await fn();
      if (res.status >= 500 && attempt < MAX_RETRY) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.warn(`[SPV-V2] ${label} – HTTP ${res.status}, retry ${attempt}/${MAX_RETRY} după ${delay}ms`);
        await sleep(delay);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRY) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.warn(`[SPV-V2] ${label} – eroare rețea, retry ${attempt}/${MAX_RETRY} după ${delay}ms:`, err.message);
        await sleep(delay);
      }
    }
  }
  throw lastErr || new Error(`${label} – toate tentativele au eșuat`);
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Validare token JWT ────────────────────────────────────────────────────────

/**
 * Verifică dacă un token este JWT (3 segmente base64url separate prin punct).
 * ANAF API (upload/mesaje) NECESITĂ token JWT.
 * Tokenele opace (hex/alfanumerice fără puncte) returnează 401 invalid_token.
 */
const isJwt = (token) => {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
};

// ── DB helpers ────────────────────────────────────────────────────────────────

const getSettings = () =>
  db.prepare('SELECT * FROM spv_v2_settings WHERE id = 1').get() || {};

const getBaseUrl = (s) =>
  s.environment === 'prod' ? ANAF_PROD_BASE : ANAF_TEST_BASE;

const bearerHeader = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/json',
});

const isTokenExpired = (s) => {
  if (!s.token_expires_at) return false;
  return new Date(s.token_expires_at).getTime() - 60_000 <= Date.now();
};

const resolveRedirectUri = (s) => {
  if (s.redirect_uri) return s.redirect_uri;
  if (s.public_callback_url) {
    return `${s.public_callback_url.replace(/\/$/, '')}/api/efactura-v2/oauth/callback`;
  }
  return '';
};

/**
 * Înregistrează acțiune în jurnal audit.
 */
const log = (action, details = null, success = true, err = null) => {
  try {
    db.prepare(
      `INSERT INTO spv_v2_action_log (action, details, success, error_message, created_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(
      action,
      details != null ? JSON.stringify(details) : null,
      success ? 1 : 0,
      err || null,
    );
    db.prepare(
      `UPDATE spv_v2_settings SET last_action = ?, last_action_at = CURRENT_TIMESTAMP WHERE id = 1`
    ).run(action);
  } catch (_) { /* nu blocăm funcționalitatea principală */ }
};

// ── Middleware: verificare token valid ────────────────────────────────────────

const requireToken = (req, res, next) => {
  const s = getSettings();
  if (!s.oauth_token) {
    return res.status(401).json({
      error: 'Token OAuth2 lipsă. Autorizați aplicația sau importați un token JWT valid.',
      code: 'NO_TOKEN',
    });
  }
  if (isTokenExpired(s)) {
    return res.status(401).json({
      error: 'Token OAuth2 expirat. Reînnoriți cu POST /oauth/refresh sau obțineți unul nou.',
      code: 'TOKEN_EXPIRED',
      expiresAt: s.token_expires_at,
    });
  }
  req.spvSettings = s;
  next();
};

// ── Parsare răspuns XML ANAF (upload) ─────────────────────────────────────────

/**
 * Parsează răspunsul XML de la ANAF upload.
 * Referință: UBLUploadResponse.php din test-spv1, uploadUBIAnaf din test-spv2.
 */
const parseUploadXml = (xml) => {
  // Attribute names used here are fixed internal literals – escape for safety
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attr   = (name) => { const m = xml.match(new RegExp(`${escRe(name)}="([^"]*)"`,'i')); return m ? m[1] : null; };
  const errs  = [];
  let m;
  const re = /errorMessage="([^"]*)"/gi;
  while ((m = re.exec(xml)) !== null) if (m[1]) errs.push(m[1]);
  return {
    index_incarcare: attr('index_incarcare'),
    ExecutionStatus: attr('ExecutionStatus'),
    dateResponse:    attr('dateResponse'),
    errors: errs,
  };
};

/** Elimină xsi:schemaLocation din XML (poate cauza erori ANAF). */
const stripSchemaLocation = (xml) =>
  xml.includes('schemaLocation')
    ? xml.replace(/xsi:schemaLocation\s*=\s*"[^"]*"/gi, '').replace(/\s{2,}/g, ' ')
    : xml;

// ── Generator XML UBL 2.1 (CIUS-RO) ──────────────────────────────────────────

/**
 * Generează XML UBL 2.1 CIUS-RO dintr-un rând billing_invoices.
 * Inspirat din CreateUBI() (test-spv2) și buildUBL (modul anterior).
 */
const buildUBL = (inv) => {
  const esc = (v) => String(v || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

  const snap   = (() => {
    try { return inv.raw_snapshot ? JSON.parse(inv.raw_snapshot) : {}; }
    catch { return {}; }
  })();

  // Date cumpărător din snapshot
  const cName    = snap.clientName      || inv.client_name              || inv.bt_44_buyer_name       || '';
  const cCIF     = snap.clientCIF       || inv.bt_48_buyer_vat_identifier || '';
  const cNrReg   = snap.clientNrRegCom  || inv.bt_47_buyer_legal_registration || '';
  const cStrada  = snap.clientStrada    || inv.bt_50_buyer_address      || '';
  const cCity    = snap.clientLocalitate || inv.bt_52_buyer_city        || '';
  const cRegion  = snap.clientJudet     || inv.bt_54_buyer_region       || '';
  const cCountry = snap.clientTara      || inv.bt_55_buyer_country      || 'RO';

  const lines     = snap.lines || snap.documentPositions || [];
  const issueDate = esc(inv.document_date || inv.bt_2_issue_date || '');
  const dueDate   = esc(inv.due_date      || inv.bt_9_due_date   || inv.document_date || '');

  // Grupare TVA
  const vatGroups = {};
  lines.forEach((item) => {
    const rate = item.vat != null ? Number(item.vat) : 19;
    const net  = Number(item.total || (Number(item.unitCount || item.quantity || 0) * Number(item.price || 0)));
    vatGroups[rate] = (vatGroups[rate] || 0) + net;
  });
  const totalNet = Object.values(vatGroups).reduce((s, v) => s + v, 0);
  const totalVat = Object.entries(vatGroups).reduce((s, [r, n]) => s + (n * Number(r)) / 100, 0);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1</cbc:CustomizationID>
  <cbc:ID>${esc(inv.invoice_code || inv.id)}</cbc:ID>
  <cbc:IssueDate>${issueDate}</cbc:IssueDate>
  <cbc:DueDate>${dueDate}</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>\n`;

  if (snap.nrComanda) {
    xml += `  <cac:OrderReference>\n    <cbc:ID>${esc(snap.nrComanda)}</cbc:ID>\n  </cac:OrderReference>\n`;
  }

  // Vânzător
  xml += `  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${esc(inv.bt_27_seller_name)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(inv.bt_35_seller_address)}</cbc:StreetName>
        <cbc:CityName>${esc(inv.bt_37_seller_city)}</cbc:CityName>
        <cbc:CountrySubentity>${esc(inv.bt_39_seller_region)}</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>${esc(inv.bt_40_seller_country || 'RO')}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(inv.bt_31_32_seller_vat_identifier || inv.bt_29_seller_identifier)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(inv.bt_27_seller_name)}</cbc:RegistrationName>
        <cbc:CompanyLegalForm>${esc(inv.bt_30_seller_legal_registration)}</cbc:CompanyLegalForm>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingSupplierParty>\n`;

  // Cumpărător
  xml += `  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyName><cbc:Name>${esc(cName)}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>${esc(cStrada)}</cbc:StreetName>
        <cbc:CityName>${esc(cCity)}</cbc:CityName>
        <cbc:CountrySubentity>${esc(cRegion)}</cbc:CountrySubentity>
        <cac:Country><cbc:IdentificationCode>${esc(cCountry)}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>${esc(cCIF)}</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyLegalEntity>
        <cbc:RegistrationName>${esc(cName)}</cbc:RegistrationName>
        <cbc:CompanyID>${esc(cNrReg)}</cbc:CompanyID>
      </cac:PartyLegalEntity>
    </cac:Party>
  </cac:AccountingCustomerParty>\n`;

  // Mijloc de plată (IBAN)
  if (inv.bt_84_payee_iban) {
    xml += `  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${esc(inv.bt_81_payment_means_code || '31')}</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(inv.bt_84_payee_iban)}</cbc:ID>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>\n`;
  }

  // TaxTotal
  xml += `  <cac:TaxTotal>\n    <cbc:TaxAmount currencyID="RON">${totalVat.toFixed(2)}</cbc:TaxAmount>\n`;
  Object.entries(vatGroups).forEach(([rate, net]) => {
    const vatAmt = (net * Number(rate)) / 100;
    const cat    = [19, 9, 5].includes(Number(rate)) ? 'S' : 'Z';
    xml += `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="RON">${net.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="RON">${vatAmt.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${cat}</cbc:ID>
        <cbc:Percent>${rate}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>\n`;
  });
  xml += `  </cac:TaxTotal>\n`;

  // Totaluri monetare
  xml += `  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="RON">${totalNet.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="RON">${totalNet.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="RON">${(totalNet + totalVat).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="RON">${(totalNet + totalVat).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>\n`;

  // Linii factură
  lines.forEach((item, idx) => {
    const rate    = item.vat != null ? Number(item.vat) : 19;
    const qty     = Number(item.unitCount || item.quantity || 0);
    const price   = Number(item.price || 0);
    const lineNet = Number(item.total || qty * price);
    const cat     = [19, 9, 5].includes(rate) ? 'S' : 'Z';
    xml += `  <cac:InvoiceLine>
    <cbc:ID>${idx + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="RON">${lineNet.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(item.name || item.descriere || '')}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${cat}</cbc:ID>
        <cbc:Percent>${rate}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price>
      <cbc:PriceAmount currencyID="RON">${price.toFixed(4)}</cbc:PriceAmount>
    </cac:Price>
  </cac:InvoiceLine>\n`;
  });

  xml += `</Invoice>\n`;
  return xml;
};

// ── Helper: efectuare token exchange / refresh ─────────────────────────────────

/**
 * Efectuează POST la ANAF /token cu mTLS.
 * Returnează { access_token, refresh_token, expires_in, ... }
 * Aruncă eroare dacă ANAF returnează eroare.
 */
const exchangeToken = async (params, label = 'token_exchange') => {
  const settings  = getSettings();
  const basicAuth = Buffer.from(`${settings.client_id}:${settings.client_secret}`).toString('base64');
  const body      = new URLSearchParams(params).toString();

  const res = await withRetry(
    () => anafRequest(ANAF_TOKEN_URL, {
      method:   'POST',
      useMtls:  true,
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
        'Accept':        'application/json',
      },
      body,
    }),
    label,
  );

  const raw  = res._raw;
  let data;
  try { data = JSON.parse(raw); } catch { data = {}; }

  if (!res.ok) {
    const msg = data.error_description || data.error
      || `ANAF HTTP ${res.status}${res.status >= 500 && !getMtlsAgent() ? ' – verificați configurarea mTLS (certificat digital)' : ''}`;
    throw Object.assign(new Error(msg), { status: res.status, anafData: data });
  }
  if (!data.access_token) {
    throw new Error('Răspuns invalid de la ANAF: lipsă access_token.');
  }
  return data;
};

/** Salvează token-urile în DB. */
const saveToken = (tokenData, keepRefreshIfMissing = false) => {
  const settings  = getSettings();
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
    : '';
  db.prepare(
    `UPDATE spv_v2_settings SET oauth_token=?, refresh_token=?, token_expires_at=?, updated_at=CURRENT_TIMESTAMP WHERE id=1`
  ).run(
    tokenData.access_token  || '',
    tokenData.refresh_token || (keepRefreshIfMissing ? settings.refresh_token : ''),
    expiresAt,
  );
  return expiresAt;
};

// ═════════════════════════════════════════════════════════════════════════════
// RUTE – SETĂRI
// ═════════════════════════════════════════════════════════════════════════════

/** GET /api/efactura-v2/settings */
router.get('/settings', (req, res) => {
  try {
    const s = getSettings();
    res.json({
      cif:              s.cif              || '',
      environment:      s.environment      || 'test',
      clientId:         s.client_id        || '',
      hasClientSecret:  !!(s.client_secret),
      redirectUri:      s.redirect_uri     || '',
      publicCallbackUrl: s.public_callback_url || '',
      token:            s.oauth_token      || '',
      tokenExpiresAt:   s.token_expires_at || '',
      hasRefreshToken:  !!(s.refresh_token),
      lastAction:       s.last_action      || '',
      lastActionAt:     s.last_action_at   || '',
      updatedAt:        s.updated_at       || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/efactura-v2/settings */
router.put('/settings', (req, res) => {
  try {
    const { cif, clientId, clientSecret, redirectUri, publicCallbackUrl, environment, token, tokenExpiresAt } = req.body;
    const cur = getSettings();
    db.prepare(
      `UPDATE spv_v2_settings SET cif=?,environment=?,client_id=?,client_secret=?,
       redirect_uri=?,public_callback_url=?,oauth_token=?,token_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`
    ).run(
      cif           ?? cur.cif           ?? '',
      environment   ?? cur.environment   ?? 'test',
      clientId      ?? cur.client_id     ?? '',
      clientSecret  || cur.client_secret || '',
      redirectUri   !== undefined ? redirectUri   : (cur.redirect_uri        || ''),
      publicCallbackUrl !== undefined ? publicCallbackUrl : (cur.public_callback_url || ''),
      token         !== undefined ? token         : (cur.oauth_token         || ''),
      tokenExpiresAt !== undefined ? tokenExpiresAt : (cur.token_expires_at  || ''),
    );
    log('settings_updated', { cif, environment, hasClientId: !!clientId });
    res.json({ success: true });
  } catch (err) {
    log('settings_update_failed', null, false, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// RUTE – OAUTH2
// ═════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/efactura-v2/oauth/authorize
 * Construiește URL-ul de autorizare ANAF cu token_content_type=jwt.
 * IMPORTANT: tokenul obținut TREBUIE să fie JWT, nu opac.
 */
router.get('/oauth/authorize', (req, res) => {
  try {
    const s = getSettings();
    if (!s.client_id) {
      return res.status(400).json({ error: 'client_id lipsă în setări.', code: 'MISSING_CLIENT_ID' });
    }
    const redirectUri = resolveRedirectUri(s);
    if (!redirectUri) {
      return res.status(400).json({
        error: 'redirect_uri lipsă. Configurați redirect_uri sau public_callback_url în setări.',
        code: 'MISSING_REDIRECT_URI',
      });
    }

    const state = crypto.randomBytes(32).toString('hex');
    db.prepare(
      `UPDATE spv_v2_settings SET oauth_state=?, oauth_redirect_uri_used=?, updated_at=CURRENT_TIMESTAMP WHERE id=1`
    ).run(state, redirectUri);

    // token_content_type=jwt este OBLIGATORIU – fără el ANAF returnează token opac
    // care va fi respins cu 401 invalid_token la orice apel API!
    const params = new URLSearchParams({
      response_type:      'code',
      client_id:          s.client_id,
      redirect_uri:       redirectUri,
      token_content_type: 'jwt',          // CRITIC: asigură token JWT
      scope:              'offline_access', // necesar pentru refresh_token
      state,
    });
    const authUrl = `${ANAF_AUTH_URL}?${params.toString()}`;

    log('oauth_authorize_initiated', { redirectUri, environment: s.environment });
    console.log('[SPV-V2] OAuth2 authorize URL:', authUrl);

    res.json({ authUrl, state, redirectUri });
  } catch (err) {
    log('oauth_authorize_failed', null, false, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/oauth/callback
 * Callback public – ANAF redirecționează aici cu ?code=...&state=...
 * Schimbă codul de autorizare cu access_token (necesită mTLS).
 */
router.get('/oauth/callback', async (req, res) => {
  // The OAuth2 Authorization Code flow (RFC 6749 §4.1.2) requires receiving the
  // authorization code via GET query string. The code is single-use, short-lived (~60s),
  // immediately exchanged server-side for tokens, and never logged in full.
  // nosemgrep: javascript.lang.security.audit.cookie.cookie-session.cookie-session
  const { code, state, error: oauthError, error_description } = req.query; // lgtm[js/sensitive-get-query]

  if (oauthError) {
    const msg = error_description || oauthError || 'Autorizare refuzată de ANAF.';
    log('oauth_callback_error', { error: oauthError }, false, msg);
    return res.redirect(`${FRONTEND_URL}/?oauth_error=${encodeURIComponent(msg)}&module=spv-v2#efactura-spv`);
  }

  if (!code) {
    const msg = 'Cod de autorizare lipsă.';
    log('oauth_callback_no_code', null, false, msg);
    return res.redirect(`${FRONTEND_URL}/?oauth_error=${encodeURIComponent(msg)}&module=spv-v2#efactura-spv`);
  }

  try {
    const s = getSettings();

    // Verificare state (CSRF)
    if (!state || !s.oauth_state || state !== s.oauth_state) {
      const msg = 'Parametru state invalid – posibil atac CSRF. Reîncercați autorizarea.';
      log('oauth_callback_state_mismatch', { received: state }, false, msg);
      return res.redirect(`${FRONTEND_URL}/?oauth_error=${encodeURIComponent(msg)}&module=spv-v2#efactura-spv`);
    }
    db.prepare(`UPDATE spv_v2_settings SET oauth_state='' WHERE id=1`).run();

    const redirectUri = resolveRedirectUri(s);
    if (!redirectUri || !s.client_id || !s.client_secret) {
      const msg = 'Configurare incompletă (redirect_uri / client_id / client_secret).';
      log('oauth_callback_config_missing', null, false, msg);
      return res.redirect(`${FRONTEND_URL}/?oauth_error=${encodeURIComponent(msg)}&module=spv-v2#efactura-spv`);
    }

    console.log('[SPV-V2] Schimb authorization_code → access_token...', {
      code_prefix: code.substring(0, 8) + '…',
      redirectUri,
      mtls: !!getMtlsAgent(),
    });

    const tokenData = await exchangeToken({
      grant_type:   'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id:    s.client_id,
      client_secret: s.client_secret,
    }, 'token_exchange');

    const expiresAt = saveToken(tokenData);
    log('oauth_token_obtained', { expiresAt, hasRefreshToken: !!tokenData.refresh_token });
    console.log('[SPV-V2] ✓ Token JWT obținut cu succes. Expiră:', expiresAt);

    return res.redirect(`${FRONTEND_URL}/?oauth_success=1&module=spv-v2#efactura-spv`);
  } catch (err) {
    console.error('[SPV-V2] OAuth callback error:', err.message);
    const mtlsHint = (!getMtlsAgent() && (err.status || 0) >= 500) ? '&mtls_required=1' : '';
    log('oauth_callback_failed', null, false, err.message);
    return res.redirect(
      `${FRONTEND_URL}/?oauth_error=${encodeURIComponent(err.message)}&module=spv-v2${mtlsHint}#efactura-spv`
    );
  }
});

/**
 * POST /api/efactura-v2/oauth/refresh
 * Reînnoiește access_token cu refresh_token.
 */
router.post('/oauth/refresh', async (req, res) => {
  try {
    const s = getSettings();
    if (!s.refresh_token) {
      return res.status(400).json({ error: 'Nu există refresh_token salvat. Autorizați din nou.', code: 'NO_REFRESH_TOKEN' });
    }
    if (!s.client_id || !s.client_secret) {
      return res.status(400).json({ error: 'client_id / client_secret lipsă.', code: 'MISSING_CREDENTIALS' });
    }

    const tokenData = await exchangeToken({
      grant_type:    'refresh_token',
      refresh_token: s.refresh_token,
      client_id:     s.client_id,
      client_secret: s.client_secret,
    }, 'token_refresh');

    const expiresAt = saveToken(tokenData, true);
    log('oauth_token_refreshed', { expiresAt });
    res.json({ success: true, expiresAt, hasRefreshToken: !!tokenData.refresh_token });
  } catch (err) {
    log('oauth_refresh_failed', null, false, err.message);
    res.status(502).json({ error: err.message });
  }
});

/**
 * POST /api/efactura-v2/oauth/token-import
 * Importă token obținut extern (Postman, curl, token hardware USB).
 *
 * IMPORTANT: ANAF API necesită token JWT (format: header.payload.signature).
 * Tokenele opace (hex de 64+ caractere fără puncte) returnează 401 invalid_token.
 *
 * Cum să obții token JWT în Postman:
 *   1. Authorization → OAuth 2.0
 *   2. Auth URL: https://logincert.anaf.ro/anaf-oauth2/v1/authorize
 *   3. Access Token URL: https://logincert.anaf.ro/anaf-oauth2/v1/token
 *   4. Advanced → adăugați param: token_content_type = jwt
 *   5. Click "Get New Access Token" → autentificați cu certificatul digital
 *   6. Copiați access_token (trebuie să aibă 3 segmente separate prin punct)
 *
 * Body JSON: { access_token, refresh_token?, expires_in?, token_type? }
 */
router.post('/oauth/token-import', (req, res) => {
  try {
    const { access_token, refresh_token, expires_in, token_type } = req.body || {};

    if (!access_token || typeof access_token !== 'string' || !access_token.trim()) {
      return res.status(400).json({ error: 'access_token lipsă sau invalid.', code: 'MISSING_ACCESS_TOKEN' });
    }

    // Eliminăm prefixul "Bearer " dacă utilizatorul l-a copiat accidental
    let token = access_token.trim().replace(/^bearer\s+/i, '');

    if (/\s/.test(token)) {
      return res.status(400).json({ error: 'Token invalid: conține spații.', code: 'INVALID_TOKEN_FORMAT' });
    }

    // VERIFICARE CRITICĂ: token-ul TREBUIE să fie JWT
    if (!isJwt(token)) {
      const msg = [
        'Tokenul importat NU este JWT și va fi respins de ANAF cu 401 invalid_token.',
        'Tokenele opace (hex fără puncte, ex: f7584c01...) sunt valide doar pentru sesiuni browser,',
        'NU pentru apeluri API (upload, mesaje SPV).',
        '',
        'Cum obții token JWT în Postman:',
        '  1. Authorization → OAuth 2.0',
        '  2. Auth URL: https://logincert.anaf.ro/anaf-oauth2/v1/authorize',
        '  3. Access Token URL: https://logincert.anaf.ro/anaf-oauth2/v1/token',
        '  4. Advanced → adaugă parametru: token_content_type = jwt',
        '  5. Get New Access Token → autentifică cu certificat digital',
        '  6. Tokenul JWT are forma: xxxxx.yyyyy.zzzzz (3 segmente separate prin ".")',
      ].join('\n');
      return res.status(400).json({
        error: 'Token non-JWT respins.',
        code:  'NOT_JWT_TOKEN',
        details: msg,
        fix: 'Adăugați parametrul Advanced "token_content_type=jwt" în Postman și obțineți un token nou.',
      });
    }

    const expiresAt = expires_in && Number(expires_in) > 0
      ? new Date(Date.now() + Number(expires_in) * 1000).toISOString()
      : '';

    db.prepare(
      `UPDATE spv_v2_settings SET oauth_token=?,refresh_token=?,token_expires_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=1`
    ).run(token, refresh_token ? String(refresh_token).trim() : '', expiresAt);

    log('oauth_token_imported', { tokenType: token_type || 'Bearer', hasRefreshToken: !!refresh_token, expiresAt });
    console.log('[SPV-V2] ✓ Token JWT importat cu succes. Expiră:', expiresAt || 'necunoscut');

    res.json({
      success: true,
      tokenIsJwt: true,
      expiresAt: expiresAt || null,
      hasRefreshToken: !!refresh_token,
      message: 'Token JWT importat cu succes. Puteți acum transmite facturi.',
    });
  } catch (err) {
    log('oauth_token_import_error', null, false, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/oauth/diagnostic
 * Verifică configurarea OAuth2 și raportează probleme detectate.
 */
router.get('/oauth/diagnostic', (req, res) => {
  const s = getSettings();
  const redirectUri = resolveRedirectUri(s);
  const token = s.oauth_token || '';
  const issues = [];

  if (!s.client_id)     issues.push('❌ client_id lipsă');
  if (!s.client_secret) issues.push('❌ client_secret lipsă');
  if (!redirectUri)     issues.push('❌ redirect_uri lipsă – configurați redirect_uri sau public_callback_url');
  if (redirectUri && !redirectUri.startsWith('https://')) issues.push('⚠ redirect_uri nu folosește HTTPS');
  if (!getMtlsAgent())  issues.push('⚠ mTLS neconfigurat – token exchange va eșua fără certificat digital');
  if (token && !isJwt(token)) issues.push('❌ Token stocat NU este JWT – va fi respins la upload cu 401');
  if (!s.cif)           issues.push('⚠ CIF furnizor lipsă – necesar pentru upload');

  const ready = issues.filter(i => i.startsWith('❌')).length === 0;
  res.json({
    ready,
    issues,
    config: {
      environment:   s.environment  || 'test',
      hasCif:        !!s.cif,
      hasClientId:   !!s.client_id,
      hasClientSecret: !!s.client_secret,
      redirectUri,
      mtlsConfigured: !!getMtlsAgent(),
      hasToken:       !!token,
      tokenIsJwt:     isJwt(token),
      tokenExpired:   isTokenExpired(s),
      tokenExpiresAt: s.token_expires_at || null,
    },
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// RUTE – STATUS & LOG
// ═════════════════════════════════════════════════════════════════════════════

/** GET /api/efactura-v2/status */
router.get('/status', (req, res) => {
  try {
    const s = getSettings();
    const tokenExpired = isTokenExpired(s);
    const tokenIsJwt   = isJwt(s.oauth_token);
    res.json({
      module:     'E-factura SPV-V2',
      ready:      !!s.oauth_token && !tokenExpired && !!s.cif && tokenIsJwt,
      tokenValid: !!s.oauth_token && !tokenExpired,
      tokenIsJwt,
      tokenExpired,
      environment: s.environment || 'test',
      hasCif:      !!s.cif,
      mtlsEnabled: !!getMtlsAgent(),
      lastAction:  s.last_action || null,
      lastActionAt: s.last_action_at || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/efactura-v2/action-log?limit=50 */
router.get('/action-log', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    res.json(db.prepare('SELECT * FROM spv_v2_action_log ORDER BY created_at DESC LIMIT ?').all(limit));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// RUTE – UPLOAD / STATUS / DOWNLOAD
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/efactura-v2/upload/:invoiceId
 * Încarcă factura XML în SPV ANAF.
 *
 * Referință: uploadUBIAnaf() din test-spv2 – Content-Type: text/plain
 * ANAF acceptă atât text/plain cât și application/xml, dar text/plain
 * este standardul utilizat în exemplele oficiale PHP.
 */
router.post('/upload/:invoiceId', requireToken, async (req, res) => {
  const { invoiceId } = req.params;
  try {
    const s = req.spvSettings;
    if (!s.cif) return res.status(400).json({ error: 'CIF furnizor lipsă în setări.', code: 'MISSING_CIF' });

    const inv = db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(invoiceId);
    if (!inv) return res.status(404).json({ error: 'Factura nu a fost găsită.' });

    // Generare + curățare XML
    let xml;
    try {
      xml = stripSchemaLocation(buildUBL(inv));
    } catch (xmlErr) {
      log('upload_xml_error', { invoiceId }, false, xmlErr.message);
      return res.status(500).json({ error: `Eroare generare XML: ${xmlErr.message}` });
    }

    const baseUrl   = getBaseUrl(s);
    const uploadUrl = `${baseUrl}/upload?standard=UBL&cif=${encodeURIComponent(s.cif)}`;

    db.prepare(`UPDATE billing_invoices SET spv_status='uploading', spv_uploaded_at=CURRENT_TIMESTAMP WHERE id=?`).run(inv.id);

    let anafRes;
    try {
      anafRes = await withRetry(
        () => anafRequest(uploadUrl, {
          method: 'POST',
          headers: {
            // Content-Type: text/plain – conform exemplelor PHP din test-spv2
            // (ANAF acceptă și application/xml, dar text/plain e standardul)
            'Content-Type':  'text/plain',
            'Authorization': `Bearer ${s.oauth_token}`,
            'Accept':        'application/json',
          },
          body: xml,
        }),
        'upload',
      );
    } catch (netErr) {
      db.prepare(`UPDATE billing_invoices SET spv_status='error' WHERE id=?`).run(inv.id);
      log('upload_network_error', { invoiceId }, false, netErr.message);
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${netErr.message}` });
    }

    const rawText = anafRes._raw;

    // ANAF returnează JSON la erori (401, 400 etc.) și XML la upload procesat.
    let anafBody, uploadId = null, execStatus = null;
    let isJsonError = false;

    try {
      anafBody      = JSON.parse(rawText);
      isJsonError   = true; // JSON = eroare de la ANAF (nu XML de succes)
      execStatus    = anafBody?.ExecutionStatus != null ? String(anafBody.ExecutionStatus) : null;
    } catch {
      // Nu e JSON → XML ANAF (succes sau eroare validare)
      const parsed  = parseUploadXml(rawText);
      uploadId      = parsed.index_incarcare;
      execStatus    = parsed.ExecutionStatus;
      anafBody      = { ...parsed, _rawXml: rawText.substring(0, 500) };
    }

    if (!uploadId && anafBody?.index_incarcare) uploadId = anafBody.index_incarcare;

    const execStatusStr = execStatus != null ? String(execStatus) : null;
    const isAnafError   = execStatusStr !== null && execStatusStr !== '0';
    const newStatus     = (!anafRes.ok || isAnafError) ? 'error' : 'uploaded';

    db.prepare(
      `UPDATE billing_invoices SET spv_upload_id=?,spv_status=?,spv_response=?,spv_uploaded_at=CURRENT_TIMESTAMP WHERE id=?`
    ).run(uploadId, newStatus, JSON.stringify(anafBody), inv.id);

    log('upload', { invoiceId, uploadId, status: newStatus, httpStatus: anafRes.status });

    if (!anafRes.ok || isAnafError) {
      let errorDetail = 'Eroare la upload în SPV ANAF.';

      if (anafRes.status === 401) {
        const errCode = typeof anafBody === 'object' ? anafBody?.error : null;
        if (errCode === 'invalid_token' || (anafBody?.message || '').toLowerCase().includes('unauthorized')) {
          errorDetail = [
            'ANAF a respins tokenul (401 Unauthorized / invalid_token).',
            'Cel mai frecvent motiv: tokenul NU este JWT.',
            'Soluție: importați un token JWT (are forma xxxxx.yyyyy.zzzzz cu 3 segmente separate prin ".").',
            'În Postman, activați Advanced param "token_content_type=jwt" și obțineți token nou.',
          ].join(' ');
        } else {
          errorDetail = 'Token invalid sau expirat (ANAF 401). Reimportați tokenul.';
        }
      } else if (anafRes.status === 403) {
        errorDetail = 'Acces refuzat de ANAF (403). Verificați că CIF-ul și tokenul corespund.';
      } else if (anafRes.status === 415) {
        errorDetail = 'Format neacceptat de ANAF (415 Unsupported Media Type).';
      } else if (anafRes.status >= 500) {
        errorDetail = `Eroare server ANAF (${anafRes.status}). Încercați din nou.`;
      } else if (isAnafError && anafBody?.errors?.length) {
        errorDetail = `ANAF a respins factura: ${anafBody.errors.join('; ')}`;
      }

      console.error('[SPV-V2] ✗ Upload eșuat:', { invoiceId, httpStatus: anafRes.status, errorDetail, anafBody });
      return res.status(anafRes.ok ? 422 : anafRes.status).json({
        error: errorDetail,
        anafHttpStatus: anafRes.status,
        uploadId,
        status: newStatus,
        anafResponse: anafBody,
      });
    }

    console.log('[SPV-V2] ✓ Upload reușit:', { invoiceId, uploadId });
    res.json({ uploadId, status: newStatus, anafResponse: anafBody });
  } catch (err) {
    console.error('[SPV-V2] Upload unexpected error:', err);
    log('upload_unexpected_error', { invoiceId }, false, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/check-status/:invoiceId
 * Verifică starea unui mesaj SPV. Stări ANAF: ok, nok, in prelucrare.
 */
router.get('/check-status/:invoiceId', requireToken, async (req, res) => {
  const { invoiceId } = req.params;
  try {
    const s = req.spvSettings;
    const inv = db.prepare('SELECT id,spv_upload_id,spv_status FROM billing_invoices WHERE id=?').get(invoiceId);
    if (!inv) return res.status(404).json({ error: 'Factura nu a fost găsită.' });
    if (!inv.spv_upload_id) return res.status(400).json({ error: 'Factura nu are ID de upload SPV.' });

    const statusUrl = `${getBaseUrl(s)}/stareMesaj?id_incarcare=${encodeURIComponent(inv.spv_upload_id)}`;
    let anafRes;
    try {
      anafRes = await anafRequest(statusUrl, { headers: bearerHeader(s.oauth_token) });
    } catch (netErr) {
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${netErr.message}` });
    }

    let anafBody;
    try { anafBody = JSON.parse(anafRes._raw); } catch { anafBody = { _raw: anafRes._raw }; }

    if (!anafRes.ok) {
      return res.status(anafRes.status).json({ error: `ANAF ${anafRes.status}`, anafResponse: anafBody });
    }

    const stare      = anafBody?.stare || '';
    const statusMap  = { 'ok': 'validated', 'nok': 'rejected', 'in prelucrare': 'processing' };
    const newStatus  = statusMap[stare] || (stare.toLowerCase().includes('erori') ? 'error' : inv.spv_status);
    const downloadId = anafBody?.id_descarcare || null;

    db.prepare(
      `UPDATE billing_invoices SET spv_status=?,spv_response=?,spv_download_id=? WHERE id=?`
    ).run(newStatus, JSON.stringify(anafBody), downloadId, inv.id);

    log('check_status', { invoiceId, stare, newStatus });
    res.json({ uploadId: inv.spv_upload_id, anafStatus: stare, localStatus: newStatus, downloadId, anafResponse: anafBody });
  } catch (err) {
    console.error('[SPV-V2] Check status error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/download/:invoiceId
 * Descarcă răspunsul ZIP de la ANAF pentru o factură.
 */
router.get('/download/:invoiceId', requireToken, async (req, res) => {
  try {
    const s = req.spvSettings;
    const inv = db.prepare('SELECT * FROM billing_invoices WHERE id=?').get(req.params.invoiceId);
    if (!inv) return res.status(404).json({ error: 'Factura nu a fost găsită.' });
    if (!inv.spv_download_id) return res.status(400).json({ error: 'Nu există ID de descărcare (ANAF nu a procesat încă factura).' });

    const dlUrl = `${getBaseUrl(s)}/descarcare?id=${encodeURIComponent(inv.spv_download_id)}`;
    let anafRes;
    try {
      anafRes = await anafRequest(dlUrl, { headers: bearerHeader(s.oauth_token) });
    } catch (netErr) {
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${netErr.message}` });
    }

    if (!anafRes.ok) {
      return res.status(anafRes.status).json({ error: `ANAF ${anafRes.status}: ${anafRes._raw.substring(0, 200)}` });
    }

    log('download', { invoiceId: inv.id, downloadId: inv.spv_download_id });
    const buf = Buffer.from(anafRes._raw, 'binary');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="anaf_${inv.spv_download_id}.zip"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/xml/:invoiceId
 * Previzualizare XML UBL generat pentru o factură.
 */
router.get('/xml/:invoiceId', (req, res) => {
  try {
    const inv = db.prepare('SELECT * FROM billing_invoices WHERE id=?').get(req.params.invoiceId);
    if (!inv) return res.status(404).json({ error: 'Factura nu a fost găsită.' });
    const xml = stripSchemaLocation(buildUBL(inv));
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/messages?zile=30
 * Lista mesajelor din SPV ANAF (facturi primite, trimise, notificări).
 */
router.get('/messages', requireToken, async (req, res) => {
  try {
    const s    = req.spvSettings;
    const zile = Math.min(Number(req.query.zile) || 30, 60);
    if (!s.cif) return res.status(400).json({ error: 'CIF lipsă în setări.' });

    const baseUrl  = getBaseUrl(s);
    const msgUrl   = `${baseUrl}/listaMesajeFactura?zile=${zile}&cif=${encodeURIComponent(s.cif)}`;

    let anafRes;
    try {
      anafRes = await anafRequest(msgUrl, { headers: bearerHeader(s.oauth_token) });
    } catch (netErr) {
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${netErr.message}` });
    }

    let anafBody;
    try { anafBody = JSON.parse(anafRes._raw); } catch { anafBody = { _raw: anafRes._raw }; }

    if (!anafRes.ok) {
      return res.status(anafRes.status).json({ error: `ANAF ${anafRes.status}`, anafResponse: anafBody });
    }

    // Cachează mesajele local
    const mesaje = anafBody?.mesaje || [];
    mesaje.forEach((m) => {
      try {
        db.prepare(
          `INSERT OR IGNORE INTO spv_messages (anaf_message_id, id_descarcare, id_solicitant, cif, data_creare, detalii, tip)
           VALUES (?,?,?,?,?,?,?)`
        ).run(m.id, m.id_descarcare || m.id, m.id_solicitare, m.cif, m.data_creare, m.detalii, m.tip);
      } catch (_) {}
    });

    log('messages_fetched', { count: mesaje.length, zile });
    res.json(anafBody);
  } catch (err) {
    console.error('[SPV-V2] Messages error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/download-message/:id
 * Descarcă un mesaj specific din SPV (factură primită, notificare etc.).
 */
router.get('/download-message/:id', requireToken, async (req, res) => {
  try {
    const s  = req.spvSettings;
    const id = req.params.id;
    const dlUrl = `${getBaseUrl(s)}/descarcare?id=${encodeURIComponent(id)}`;

    let anafRes;
    try {
      anafRes = await anafRequest(dlUrl, { headers: bearerHeader(s.oauth_token) });
    } catch (netErr) {
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${netErr.message}` });
    }

    if (!anafRes.ok) {
      return res.status(anafRes.status).json({ error: `ANAF ${anafRes.status}` });
    }

    try {
      db.prepare(`UPDATE spv_messages SET downloaded_at=CURRENT_TIMESTAMP WHERE anaf_message_id=?`).run(id);
    } catch (_) {}

    log('download_message', { id });
    const buf = Buffer.from(anafRes._raw, 'binary');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="mesaj_anaf_${id}.zip"`);
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/local-messages
 * Returnează mesajele SPV cacheate local.
 */
router.get('/local-messages', (req, res) => {
  try {
    res.json(db.prepare('SELECT * FROM spv_messages ORDER BY data_creare DESC, created_at DESC').all());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// RUTE – OPERAȚIUNI BATCH
// ═════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/efactura-v2/upload-batch
 * Încarcă mai multe facturi în lot.
 * Body: { invoiceIds: ['id1', 'id2', ...] }
 */
router.post('/upload-batch', requireToken, async (req, res) => {
  try {
    const { invoiceIds = [] } = req.body;
    if (!Array.isArray(invoiceIds) || !invoiceIds.length) {
      return res.status(400).json({ error: 'invoiceIds array necesar și nevid.' });
    }
    const s = req.spvSettings;
    if (!s.cif) return res.status(400).json({ error: 'CIF lipsă în setări.' });

    const baseUrl = getBaseUrl(s);
    const results = [];

    for (const invoiceId of invoiceIds) {
      const inv = db.prepare('SELECT * FROM billing_invoices WHERE id=?').get(invoiceId);
      if (!inv) { results.push({ invoiceId, success: false, error: 'Factură negăsită.' }); continue; }

      try {
        const xml       = stripSchemaLocation(buildUBL(inv));
        const uploadUrl = `${baseUrl}/upload?standard=UBL&cif=${encodeURIComponent(s.cif)}`;

        db.prepare(`UPDATE billing_invoices SET spv_status='uploading', spv_uploaded_at=CURRENT_TIMESTAMP WHERE id=?`).run(inv.id);

        const anafRes = await withRetry(
          () => anafRequest(uploadUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain', 'Authorization': `Bearer ${s.oauth_token}`, 'Accept': 'application/json' },
            body: xml,
          }),
          `batch_upload_${invoiceId}`,
        );

        let anafBody, uploadId = null, execStatus = null;
        try {
          anafBody = JSON.parse(anafRes._raw);
          execStatus = anafBody?.ExecutionStatus != null ? String(anafBody.ExecutionStatus) : null;
        } catch {
          const p = parseUploadXml(anafRes._raw);
          uploadId = p.index_incarcare; execStatus = p.ExecutionStatus;
          anafBody = { ...p, _rawXml: anafRes._raw.substring(0, 300) };
        }
        if (!uploadId && anafBody?.index_incarcare) uploadId = anafBody.index_incarcare;
        const isErr = execStatus !== null && String(execStatus) !== '0';
        const status = (!anafRes.ok || isErr) ? 'error' : 'uploaded';

        db.prepare(`UPDATE billing_invoices SET spv_upload_id=?,spv_status=?,spv_response=?,spv_uploaded_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(uploadId, status, JSON.stringify(anafBody), inv.id);

        results.push({ invoiceId, success: anafRes.ok && !isErr, uploadId, status, anafResponse: anafBody });
      } catch (itemErr) {
        db.prepare(`UPDATE billing_invoices SET spv_status='error',spv_response=? WHERE id=?`)
          .run(JSON.stringify({ error: itemErr.message }), inv.id);
        results.push({ invoiceId, success: false, error: itemErr.message });
      }

      await sleep(UPLOAD_DELAY_MS);
    }

    const successCount = results.filter((r) => r.success).length;
    log('upload_batch', { total: invoiceIds.length, success: successCount });
    res.json({ results, total: results.length, success: successCount });
  } catch (err) {
    console.error('[SPV-V2] Batch upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/efactura-v2/check-status-batch
 * Verifică starea mai multor facturi.
 * Body: { invoiceIds: ['id1', 'id2', ...] }
 */
router.post('/check-status-batch', requireToken, async (req, res) => {
  try {
    const { invoiceIds = [] } = req.body;
    if (!Array.isArray(invoiceIds) || !invoiceIds.length) {
      return res.status(400).json({ error: 'invoiceIds array necesar și nevid.' });
    }
    const s = req.spvSettings;
    const baseUrl = getBaseUrl(s);
    const results = [];

    for (const invoiceId of invoiceIds) {
      const inv = db.prepare('SELECT id,spv_upload_id,spv_status FROM billing_invoices WHERE id=?').get(invoiceId);
      if (!inv || !inv.spv_upload_id) {
        results.push({ invoiceId, skipped: true, reason: !inv ? 'not_found' : 'no_upload_id' });
        continue;
      }
      try {
        const anafRes = await anafRequest(
          `${baseUrl}/stareMesaj?id_incarcare=${encodeURIComponent(inv.spv_upload_id)}`,
          { headers: bearerHeader(s.oauth_token) }
        );
        let anafBody;
        try { anafBody = JSON.parse(anafRes._raw); } catch { anafBody = {}; }

        const stare     = anafBody?.stare || '';
        const statusMap = { 'ok': 'validated', 'nok': 'rejected', 'in prelucrare': 'processing' };
        const newStatus = statusMap[stare] || (stare.toLowerCase().includes('erori') ? 'error' : inv.spv_status);
        const dlId      = anafBody?.id_descarcare || null;

        db.prepare(`UPDATE billing_invoices SET spv_status=?,spv_response=?,spv_download_id=? WHERE id=?`)
          .run(newStatus, JSON.stringify(anafBody), dlId, inv.id);
        results.push({ invoiceId, anafStatus: stare, localStatus: newStatus, downloadId: dlId });
      } catch (itemErr) {
        results.push({ invoiceId, error: itemErr.message });
      }
      await sleep(STATUS_DELAY_MS);
    }

    log('check_status_batch', { total: invoiceIds.length });
    res.json({ results });
  } catch (err) {
    console.error('[SPV-V2] Batch check-status error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

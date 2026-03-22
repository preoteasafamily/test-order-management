/**
 * E-Factura SPV-V2 – Modul complet separat pentru integrare ANAF pe IP extern
 * ============================================================================
 * Implementează fluxul OAuth2 complet conform documentației ANAF, cu suport
 * pentru IP extern / port-forwarding și gestiunea completă a token-urilor.
 *
 * Documentație oficială:
 *   https://mfinante.gov.ro/ro/web/efactura/informatii-tehnice
 *   https://logincert.anaf.ro/anaf-oauth2/v1/.well-known/openid-configuration
 *
 * URL-uri API ANAF:
 *   Test: https://api.anaf.ro/test/FCTEL/rest/
 *   Prod: https://api.anaf.ro/prod/FCTEL/rest/
 *
 * OAuth2 Endpoints:
 *   Authorize: https://logincert.anaf.ro/anaf-oauth2/v1/authorize
 *   Token:     https://logincert.anaf.ro/anaf-oauth2/v1/token
 *
 * Rute expuse (prefix /api/efactura-v2):
 *   GET  /settings              – citire setări
 *   PUT  /settings              – salvare setări
 *   GET  /oauth/authorize       – inițiere flux OAuth2 (returnează URL autorizare)
 *   GET  /oauth/callback        – callback public pentru redirect ANAF
 *   POST /oauth/refresh         – reînnoire access_token cu refresh_token
 *   GET  /oauth/diagnostic      – diagnosticare configurare OAuth2
 *   GET  /oauth/mtls-status     – verificare stare Mutual TLS (certificat server)
 *   POST /oauth/token-import    – import token obținut extern (Postman/curl/USB token)
 *   GET  /status                – stare token și modul
 *   GET  /action-log            – jurnalul de acțiuni
 *   POST /upload/:invoiceId     – încărcare factură XML în SPV
 *   GET  /check-status/:invoiceId – verificare stare mesaj SPV
 *   GET  /download/:invoiceId   – descărcare răspuns ZIP de la ANAF
 *   GET  /xml/:invoiceId        – previzualizare XML UBL generat
 *   GET  /messages              – lista mesajelor din SPV (primite/emise)
 *   GET  /download-message/:id  – descărcare mesaj specific din SPV
 *   GET  /local-messages        – mesaje cacheate local
 *   POST /upload-batch          – încărcare facturilor în lot
 *   POST /check-status-batch    – verificare stare în lot
 */

'use strict';

const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const https   = require('https');
const fs      = require('fs');
const db      = require('../database');
const rateLimit = require('express-rate-limit');

// ─── Constante ANAF ───────────────────────────────────────────────────────────

const ANAF_TEST_BASE = 'https://api.anaf.ro/test/FCTEL/rest';
const ANAF_PROD_BASE = 'https://api.anaf.ro/prod/FCTEL/rest';

/** Endpoint de autorizare OAuth2 ANAF (certificat digital / token) */
const ANAF_AUTH_URL  = 'https://logincert.anaf.ro/anaf-oauth2/v1/authorize';
/** Endpoint de schimb/reînnoire token OAuth2 ANAF */
const ANAF_TOKEN_URL = 'https://logincert.anaf.ro/anaf-oauth2/v1/token';

/**
 * Durata minimă (ms) între apeluri consecutive la ANAF pentru a evita
 * rate-limiting-ul serverelor lor.
 */
const UPLOAD_DELAY_MS = 300;
const STATUS_DELAY_MS = 200;

/**
 * URL frontend (fără slash final) – unde se redirectează utilizatorul
 * după finalizarea fluxului OAuth2.
 * Configurat prin variabila de mediu FRONTEND_URL.
 * Dacă e gol, redirect-ul va fi relativ (corect pentru producție când
 * Express servește și frontend-ul din același domeniu).
 */
const FRONTEND_URL = (process.env.FRONTEND_URL || '').replace(/\/$/, '');

// ─── Rate limiting ────────────────────────────────────────────────────────────

const efacturaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Prea multe cereri. Încercați din nou după 15 minute.' },
});

router.use(efacturaLimiter);

// ─── Mutual TLS (mTLS) – Certificat digital calificat ANAF ───────────────────
//
// Serverul ANAF logincert.anaf.ro impune prezentarea certificatului digital
// calificat (Mutual TLS) la apelurile POST /token și POST /token (refresh).
// Fără certificat client, ANAF returnează HTTP 500 "Internal server error".
//
// Configurare prin variabile de mediu în server/.env:
//   ANAF_CERT_PATH       – calea absolută spre fișierul certificat (PEM)
//   ANAF_KEY_PATH        – calea absolută spre fișierul cheie privată (PEM)
//   ANAF_CERT_PASSPHRASE – (opțional) parola pentru cheia privată criptată

let _mtlsAgent = null;
let _mtlsWarningShown = false;

/**
 * Returnează un https.Agent configurat cu certificatul digital calificat ANAF.
 * Crearea agentului este lazy (la primul apel) și cacheată.
 *
 * Dacă variabilele de mediu ANAF_CERT_PATH / ANAF_KEY_PATH lipsesc sau
 * fișierele nu pot fi citite, returnează null și afișează un avertisment clar.
 *
 * @returns {https.Agent|null}
 */
const getMtlsAgent = () => {
  if (_mtlsAgent) return _mtlsAgent;

  const certPath   = process.env.ANAF_CERT_PATH;
  const keyPath    = process.env.ANAF_KEY_PATH;
  const passphrase = process.env.ANAF_CERT_PASSPHRASE;

  if (!certPath || !keyPath) {
    if (!_mtlsWarningShown) {
      console.warn(
        '[SPV-V2] ⚠️  MUTUAL TLS NECONFIGURAT – variabilele ANAF_CERT_PATH și ANAF_KEY_PATH lipsesc din server/.env.\n' +
        '          Serverul ANAF (logincert.anaf.ro) impune prezentarea certificatului digital calificat\n' +
        '          la apelul POST /token. Fără mTLS, ANAF va returna HTTP 500 "Internal server error".\n' +
        '          Adăugați în server/.env:\n' +
        '            ANAF_CERT_PATH=/cale/absoluta/certificat.pem\n' +
        '            ANAF_KEY_PATH=/cale/absoluta/cheie_privata.pem\n' +
        '            ANAF_CERT_PASSPHRASE=parola_optionala\n' +
        '          Vezi secțiunea "Mutual TLS" din README-EFACTURA-V2.md pentru instrucțiuni complete.'
      );
      _mtlsWarningShown = true;
    }
    return null;
  }

  try {
    const agentOptions = {
      cert: fs.readFileSync(certPath),
      key:  fs.readFileSync(keyPath),
    };
    if (passphrase) agentOptions.passphrase = passphrase;

    _mtlsAgent = new https.Agent(agentOptions);
    console.log('[SPV-V2] ✅ Certificat digital mTLS încărcat cu succes pentru autentificarea la ANAF.');
    return _mtlsAgent;
  } catch (err) {
    console.error(
      `[SPV-V2] ❌ Eroare la încărcarea certificatelor mTLS pentru ANAF: ${err.message}\n` +
      `          Verificați că fișierele există și sunt accesibile:\n` +
      `            ANAF_CERT_PATH=${certPath}\n` +
      `            ANAF_KEY_PATH=${keyPath}`
    );
    return null;
  }
};

/**
 * Efectuează un request HTTPS POST cu suport Mutual TLS (certificat client).
 * Înlocuiește `fetch` pentru endpoint-urile ANAF ce impun autentificarea
 * cu certificat digital calificat (ex: logincert.anaf.ro/anaf-oauth2/v1/token).
 *
 * Returnează un obiect cu aceeași interfață ca răspunsul `fetch`:
 *   { status, statusText, ok, headers, text() }
 *
 * @param {string} url     – URL-ul complet al endpoint-ului
 * @param {object} options – { method, headers, body }
 * @returns {Promise<object>}
 */
const fetchMtls = (url, options = {}) => {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mtlsAgent = getMtlsAgent();

    // Calculăm Content-Length din body pentru a evita Transfer-Encoding: chunked.
    // ANAF returnează 400 "grant_type missing" când primește body chunked
    // deoarece serverul lor nu parsează corect form-data în modul chunked.
    const headers = { ...(options.headers || {}) };
    if (options.body != null) {
      const bodyStr = Buffer.isBuffer(options.body)
        ? options.body
        : (typeof options.body === 'string'
            ? Buffer.from(options.body, 'utf8')
            : Buffer.from(String(options.body), 'utf8'));
      headers['Content-Length'] = bodyStr.length;
    }

    const reqOptions = {
      hostname: parsed.hostname,
      port:     parsed.port || 443,
      path:     parsed.pathname + (parsed.search || ''),
      method:   options.method || 'GET',
      headers,
      // Attach the mTLS agent when available; omit when null so Node uses the default agent
      ...(mtlsAgent ? { agent: mtlsAgent } : {}),
    };

    const req = https.request(reqOptions, (res) => {
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        resolve({
          status:     res.statusCode,
          statusText: res.statusMessage || '',
          ok:         res.statusCode >= 200 && res.statusCode < 300,
          headers:    {
            forEach: (fn) => {
              Object.entries(res.headers).forEach(([name, value]) => fn(value, name));
            },
            get: (name) => res.headers[name.toLowerCase()],
          },
          text: () => Promise.resolve(rawData),
          json: () => {
            try {
              return Promise.resolve(JSON.parse(rawData));
            } catch (e) {
              return Promise.reject(new SyntaxError(`Failed to parse ANAF response as JSON: ${e.message}. Raw body: ${rawData.substring(0, 200)}`));
            }
          },
        });
      });
    });

    req.on('error', reject);

    if (options.body) req.write(options.body);
    req.end();
  });
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parsează răspunsul XML simplu de la ANAF (upload UBL).
 *
 * ANAF returnează XML la upload reușit sau cu erori de validare, de forma:
 *   <header xmlns="mfinante.ro" dateResponse="20231015T1200"
 *           ExecutionStatus="0" index_incarcare="12345"/>
 * La eroare (ex: token invalid) returnează JSON.
 *
 * Logica din referința PHP (UBLUploadResponse.php):
 *   - JSON → eroare ANAF
 *   - XML cu ExecutionStatus="0" → succes, extrage index_incarcare
 *   - XML cu ExecutionStatus≠"0" → eroare ANAF, extrage mesaj din Errors
 *
 * @param {string} xmlStr – răspunsul text brut de la ANAF
 * @returns {{ index_incarcare: string|null, ExecutionStatus: string|null, dateResponse: string|null, errors: string[] }}
 */
const parseAnafUploadXml = (xmlStr) => {
  const getAttr = (name) => {
    // Escape special regex chars; attribute names used here are fixed literals (safe)
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = xmlStr.match(new RegExp(`${escaped}="([^"]*)"`, 'i'));
    return m ? m[1] : null;
  };

  const index_incarcare = getAttr('index_incarcare');
  const ExecutionStatus = getAttr('ExecutionStatus');
  const dateResponse    = getAttr('dateResponse');

  // Extrage mesajele de eroare din <Errors errorMessage="..."/>
  const errors = [];
  const errRegex = /errorMessage="([^"]*)"/gi;
  let errMatch;
  while ((errMatch = errRegex.exec(xmlStr)) !== null) {
    if (errMatch[1]) errors.push(errMatch[1]);
  }

  return { index_incarcare, ExecutionStatus, dateResponse, errors };
};

/**
 * Elimină atributul xsi:schemaLocation din XML-ul UBL înainte de upload.
 * ANAF poate returna erori de validare dacă XML-ul conține schemaLocation.
 * (Implementat după RemoveSchemaLocationAttribute din referința PHP ANAFAPIClient.php)
 *
 * @param {string} xmlStr – XML-ul UBL generat
 * @returns {string} XML fără atributul schemaLocation
 */
const removeSchemaLocation = (xmlStr) => {
  if (!xmlStr.includes('schemaLocation')) return xmlStr;
  return xmlStr
    .replace(/xsi:schemaLocation\s*=\s*"[^"]*"/gi, '')
    .replace(/\s{2,}/g, ' ');
};

/**
 * Verifică dacă un token arată ca JWT (3 segmente base64 separate prin punct).
 * Tokenurile opace (hexazecimale/alfanumerice fără puncte) NU sunt JWT și vor fi
 * respinse de ANAF API cu 401 invalid_token.
 *
 * @param {string} token
 * @returns {boolean}
 */
const isJwtToken = (token) => {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
};

/**
 * Citește setările SPV-V2 din baza de date.
 * @returns {object} Rândul din spv_v2_settings (sau {} dacă lipsă)
 */
const getSettings = () =>
  db.prepare('SELECT * FROM spv_v2_settings WHERE id = 1').get() || {};

/**
 * Selectează URL-ul de bază ANAF în funcție de mediu (test/prod).
 * @param {object} settings – setările SPV-V2
 * @returns {string} URL de bază ANAF
 */
const getBaseUrl = (settings) =>
  settings.environment === 'prod' ? ANAF_PROD_BASE : ANAF_TEST_BASE;

/**
 * Construiește headerul de autorizare Bearer pentru API ANAF.
 * @param {string} token – access_token OAuth2
 * @returns {object} Headerele HTTP
 */
const bearerHeader = (token) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/json',
});

/**
 * Verifică dacă token-ul curent a expirat (cu o marjă de 60 secunde).
 * @param {object} settings – setările SPV-V2
 * @returns {boolean}
 */
const isTokenExpired = (settings) => {
  if (!settings.token_expires_at) return false; // fără dată de expirare → presupunem valid (nu blocat)
  const expiresAt = new Date(settings.token_expires_at);
  const margin = 60 * 1000; // 60 secunde marjă
  return expiresAt.getTime() - margin <= Date.now();
};

/**
 * Înregistrează o acțiune în jurnalul de audit spv_v2_action_log.
 * @param {string} action      – denumire scurtă a acțiunii
 * @param {object|string} details – detalii suplimentare (obiect JSON sau string)
 * @param {boolean} success    – true = succes, false = eșec
 * @param {string} [errorMsg]  – mesaj de eroare (dacă success=false)
 */
const logAction = (action, details = null, success = true, errorMsg = null) => {
  try {
    db.prepare(`
      INSERT INTO spv_v2_action_log (action, details, success, error_message, created_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      action,
      details != null ? (typeof details === 'string' ? details : JSON.stringify(details)) : null,
      success ? 1 : 0,
      errorMsg || null,
    );
    // Actualizează câmpul last_action în settings pentru acces rapid
    db.prepare(
      `UPDATE spv_v2_settings SET last_action = ?, last_action_at = CURRENT_TIMESTAMP WHERE id = 1`
    ).run(action);
  } catch (_) {
    // Log-ul nu trebuie să blocheze funcționalitatea principală
  }
};

/**
 * Returnează redirect_uri efectiv care va fi folosit la ANAF.
 * Prioritate:
 *   1. settings.redirect_uri (configurat explicit de utilizator)
 *   2. settings.public_callback_url + '/api/efactura-v2/oauth/callback'
 *   3. Fallback gol (va produce eroare la authorize)
 *
 * NOTĂ: Când serverul este în spatele unui port-forwarding sau NAT,
 * redirect_uri trebuie să fie URL-ul EXTERN accesibil de pe internet,
 * nu adresa IP locală. Configurați-l în setări sau prin PUBLIC_CALLBACK_URL.
 *
 * @param {object} settings – setările SPV-V2
 * @returns {string} redirect_uri complet
 */
const resolveRedirectUri = (settings) => {
  if (settings.redirect_uri) return settings.redirect_uri;
  if (settings.public_callback_url) {
    const base = settings.public_callback_url.replace(/\/$/, '');
    return `${base}/api/efactura-v2/oauth/callback`;
  }
  return '';
};

/**
 * Analizează un redirect_uri și returnează lista de probleme detectate.
 * Verifică: HTTPS obligatoriu, IP privat, trailing slash.
 *
 * @param {string} uri – redirect_uri de verificat
 * @returns {string[]} Lista de avertismente/probleme detectate
 */
const auditRedirectUri = (uri) => {
  if (!uri) return ['redirect_uri este gol – nu poate fi folosit'];
  const issues = [];
  if (!uri.startsWith('https://')) {
    issues.push(
      `⚠️ redirect_uri folosește "${uri.startsWith('http://') ? 'HTTP' : 'protocol necunoscut'}" în loc de HTTPS. ` +
      'ANAF impune HTTPS pentru redirect_uri înregistrată în portal.'
    );
  }
  const privateIpPattern = /https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost)/i;
  if (privateIpPattern.test(uri)) {
    issues.push(
      '⚠️ redirect_uri conține IP privat sau localhost. ' +
      'ANAF nu poate accesa adrese private din internet. ' +
      'Configurați IP-ul extern (public) în câmpul public_callback_url sau redirect_uri din setări.'
    );
  }
  if (uri.endsWith('/')) {
    issues.push(
      '⚠️ redirect_uri are trailing slash (/) la final. ' +
      'Dacă în portalul ANAF redirect_uri este înregistrată FĂRĂ slash final, ' +
      'aceasta va genera access_denied. Eliminați slash-ul final sau asigurați-vă că și în ANAF există.'
    );
  }
  return issues;
};

/**
 * Compară două redirect_uri și returnează lista de neconcordanțe detectate.
 * Verifică: schema (http/https), host, port, cale (path), trailing slash.
 *
 * @param {string} uriA – primul URI (de obicei cel salvat/configurat)
 * @param {string} uriB – al doilea URI (de obicei cel rezolvat/curent)
 * @returns {string[]} Lista de neconcordanțe
 */
const compareRedirectUris = (uriA, uriB) => {
  if (!uriA || !uriB) return [];
  if (uriA === uriB) return [];
  const mismatches = [];
  try {
    const a = new URL(uriA);
    const b = new URL(uriB);
    if (a.protocol !== b.protocol) {
      mismatches.push(
        `⚠️ MISMATCH schema: "${a.protocol}" vs "${b.protocol}" – ` +
        'ANAF verifică schema exact (http:// vs https://). Aceasta va genera access_denied!'
      );
    }
    if (a.hostname !== b.hostname) {
      mismatches.push(
        `⚠️ MISMATCH host: "${a.hostname}" vs "${b.hostname}" – ` +
        'Hostname-ul din redirect_uri nu coincide! Aceasta va genera access_denied la ANAF.'
      );
    }
    if (a.port !== b.port) {
      mismatches.push(
        `⚠️ MISMATCH port: "${a.port || '(implicit)'}" vs "${b.port || '(implicit)'}" – ` +
        'Portul din redirect_uri nu coincide! Verificați că portul din setări coincide cu cel din ANAF.'
      );
    }
    if (a.pathname !== b.pathname) {
      mismatches.push(
        `⚠️ MISMATCH cale (path): "${a.pathname}" vs "${b.pathname}" – ` +
        'Calea URL din redirect_uri nu coincide! Aceasta va genera access_denied la ANAF.'
      );
    }
    // Trailing slash diferit în pathname
    const aPath = a.pathname.replace(/\/$/, '');
    const bPath = b.pathname.replace(/\/$/, '');
    if (aPath === bPath && a.pathname !== b.pathname) {
      mismatches.push(
        '⚠️ MISMATCH trailing slash: un URI are "/" la final, celălalt nu. ' +
        'ANAF face comparație caracter cu caracter. Asigurați-vă că ambele (setare și portal ANAF) ' +
        'au exact același format (cu sau fără slash final).'
      );
    }
  } catch (_) {
    mismatches.push(
      `⚠️ Unul sau ambele redirect_uri nu sunt URL-uri valide: "${uriA}" vs "${uriB}". ` +
      'Verificați că URI-urile includ protocolul (https://) și sunt formate corect.'
    );
  }
  return mismatches;
};

/**
 * Calculează intervalul de așteptare pentru retry cu backoff exponențial.
 * @param {number} baseMs   – Intervalul de bază în milisecunde
 * @param {number} attempt  – Numărul tentativei curente (1-based)
 * @returns {number} Milisecunde de așteptat
 */
const calcBackoff = (baseMs, attempt) => baseMs * Math.pow(2, attempt - 1);

/**
 * Middleware care verifică prezența și expirarea token-ului OAuth2.
 * Dacă token-ul lipsește sau e expirat, returnează 401.
 * Atașează `req.spvSettings` pentru utilizare ulterioară în handler.
 */
const requireToken = (req, res, next) => {
  const settings = getSettings();
  if (!settings.oauth_token) {
    return res.status(401).json({
      error: 'Token OAuth2 ANAF lipsă. Autorizați aplicația mai întâi.',
      code: 'NO_TOKEN',
    });
  }
  if (isTokenExpired(settings)) {
    return res.status(401).json({
      error: 'Token OAuth2 ANAF a expirat. Reînnoriți token-ul sau autorizați din nou.',
      code: 'TOKEN_EXPIRED',
      expiresAt: settings.token_expires_at,
      hint: 'Folosiți POST /api/efactura-v2/oauth/refresh pentru reînnoire automată.',
    });
  }
  req.spvSettings = settings;
  next();
};

// ─── Helper: generare XML UBL din factura locală ──────────────────────────────

/**
 * Generează XML UBL 2.1 (CIUS-RO) din rândul billing_invoices + linii asociate.
 * Suportă mai multe rate TVA în aceeași factură.
 *
 * @param {object} inv – rândul din billing_invoices (inclusiv snapshot)
 * @returns {string} XML-ul UBL generat
 */
const buildUBL = (inv) => {
  // Funcție ajutătoare pentru escapare entități XML
  const esc = (v) =>
    String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

  // Parsare snapshot JSON (conține datele din comandă/factură locală)
  const snap =
    inv.raw_snapshot && typeof inv.raw_snapshot === 'string'
      ? JSON.parse(inv.raw_snapshot)
      : inv.raw_snapshot || {};

  // Date cumpărător (buyer)
  const cName    = snap.clientName     || inv.client_name              || inv.bt_44_buyer_name       || '';
  const cCIF     = snap.clientCIF      || inv.bt_48_buyer_vat_identifier || '';
  const cNrReg   = snap.clientNrRegCom || inv.bt_47_buyer_legal_registration || '';
  const cStrada  = snap.clientStrada   || inv.bt_50_buyer_address      || '';
  const cCity    = snap.clientLocalitate || inv.bt_52_buyer_city        || '';
  const cRegion  = snap.clientJudet    || inv.bt_54_buyer_region       || '';
  const cCountry = snap.clientTara     || inv.bt_55_buyer_country      || 'RO';

  // Linii de factură
  const lines = snap.lines || snap.documentPositions || [];

  const issueDate = esc(inv.document_date || inv.bt_2_issue_date || '');
  const dueDate   = esc(inv.due_date      || inv.bt_9_due_date   || inv.document_date || '');

  // Calculare grupe TVA
  const vatGroups = {};
  lines.forEach((item) => {
    const rate     = item.vat != null ? Number(item.vat) : 19;
    const lineNet  = Number(
      item.total || (Number(item.unitCount || item.quantity || 0) * Number(item.price || 0))
    );
    vatGroups[rate] = (vatGroups[rate] || 0) + lineNet;
  });

  const totalNet = Object.values(vatGroups).reduce((s, v) => s + v, 0);
  const totalVat = Object.entries(vatGroups).reduce(
    (s, [rate, net]) => s + (net * Number(rate)) / 100,
    0
  );

  // ── Header XML ──
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

  // Referință comandă
  const nrComanda = snap.nrComanda || null;
  if (nrComanda) {
    xml += `  <cac:OrderReference>\n    <cbc:ID>${esc(nrComanda)}</cbc:ID>\n  </cac:OrderReference>\n`;
  }

  // ── Vânzător (Seller) ──
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

  // ── Cumpărător (Buyer) ──
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

  // ── Metode de plată (opțional) ──
  if (inv.bt_84_payee_iban) {
    const pmCode = inv.bt_81_payment_means_code || '31';
    xml += `  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${esc(pmCode)}</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(inv.bt_84_payee_iban)}</cbc:ID>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>\n`;
  }

  // ── Total TVA ──
  xml += `  <cac:TaxTotal>\n    <cbc:TaxAmount currencyID="RON">${totalVat.toFixed(2)}</cbc:TaxAmount>\n`;
  Object.entries(vatGroups).forEach(([rate, netAmt]) => {
    const vatAmt  = (netAmt * Number(rate)) / 100;
    const catCode = [19, 9, 5].includes(Number(rate)) ? 'S' : 'Z';
    xml += `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="RON">${netAmt.toFixed(2)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="RON">${vatAmt.toFixed(2)}</cbc:TaxAmount>
      <cac:TaxCategory>
        <cbc:ID>${catCode}</cbc:ID>
        <cbc:Percent>${rate}</cbc:Percent>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:TaxCategory>
    </cac:TaxSubtotal>\n`;
  });
  xml += `  </cac:TaxTotal>\n`;

  // ── Totaluri monetare ──
  xml += `  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="RON">${totalNet.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="RON">${totalNet.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="RON">${(totalNet + totalVat).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="RON">${(totalNet + totalVat).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>\n`;

  // ── Linii factură ──
  lines.forEach((item, idx) => {
    const rate    = item.vat != null ? Number(item.vat) : 19;
    const qty     = Number(item.unitCount || item.quantity || 0);
    const price   = Number(item.price || 0);
    const lineNet = Number(item.total || qty * price);
    const catCode = [19, 9, 5].includes(rate) ? 'S' : 'Z';
    xml += `  <cac:InvoiceLine>
    <cbc:ID>${idx + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">${qty}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="RON">${lineNet.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(item.name || item.descriere || '')}</cbc:Name>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>${catCode}</cbc:ID>
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

// ═══════════════════════════════════════════════════════════════════════════════
// RUTE – SETĂRI
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/efactura-v2/settings
 * Returnează setările curente SPV-V2 (fără câmpuri sensibile complete).
 */
router.get('/settings', (req, res) => {
  try {
    const s = getSettings();
    res.json({
      cif:              s.cif            || '',
      environment:      s.environment    || 'test',
      clientId:         s.client_id      || '',
      // Returnăm doar dacă există client_secret, nu valoarea efectivă
      hasClientSecret:  !!(s.client_secret),
      redirectUri:      s.redirect_uri   || '',
      publicCallbackUrl: s.public_callback_url || '',
      token:            s.oauth_token    || '',
      tokenExpiresAt:   s.token_expires_at || '',
      hasRefreshToken:  !!(s.refresh_token),
      lastAction:       s.last_action    || '',
      lastActionAt:     s.last_action_at || '',
      updatedAt:        s.updated_at     || '',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/efactura-v2/settings
 * Salvează setările SPV-V2.
 *
 * Body JSON acceptat:
 *   cif, clientId, clientSecret, redirectUri, publicCallbackUrl,
 *   environment, token, tokenExpiresAt
 *
 * NOTĂ: client_secret NU este suprascris dacă body-ul trimite șir gol
 * (protecție împotriva ștergerii accidentale).
 */
router.put('/settings', (req, res) => {
  try {
    const {
      cif, clientId, clientSecret, redirectUri, publicCallbackUrl,
      environment, token, tokenExpiresAt,
    } = req.body;

    const current = getSettings();

    // Nu suprascrie secretul dacă nu a fost trimis unul nou
    const newSecret = clientSecret || current.client_secret || '';

    db.prepare(`
      UPDATE spv_v2_settings SET
        cif = ?, environment = ?, client_id = ?, client_secret = ?,
        redirect_uri = ?, public_callback_url = ?,
        oauth_token = ?, token_expires_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(
      cif           || current.cif           || '',
      environment   || current.environment   || 'test',
      clientId      || current.client_id     || '',
      newSecret,
      redirectUri   !== undefined ? redirectUri   : (current.redirect_uri   || ''),
      publicCallbackUrl !== undefined ? publicCallbackUrl : (current.public_callback_url || ''),
      token         !== undefined ? token         : (current.oauth_token    || ''),
      tokenExpiresAt !== undefined ? tokenExpiresAt : (current.token_expires_at || ''),
    );

    logAction('settings_updated', { cif, environment, hasClientId: !!clientId });
    res.json({ success: true });
  } catch (err) {
    logAction('settings_update_failed', null, false, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// RUTE – OAUTH2 ANAF
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/efactura-v2/oauth/authorize
 * ──────────────────────────────────────
 * Construiește URL-ul de autorizare ANAF și îl returnează clientului.
 * Clientul trebuie să redirecționeze utilizatorul la acest URL pentru
 * autentificarea cu certificat digital/token ANAF.
 *
 * Flux corect OAuth2 (Authorization Code Grant):
 *   1. Client apelează această rută → primește authUrl
 *   2. Browser-ul utilizatorului se deschide la authUrl
 *   3. Utilizatorul se autentifică la ANAF cu certificat
 *   4. ANAF redirectează la redirect_uri cu parametrii ?code=...&state=...
 *   5. Serverul nostru (oauth/callback) schimbă code → access_token
 *
 * Parametri URL construiți conform specificației ANAF:
 *   response_type=code
 *   client_id=<client_id>
 *   redirect_uri=<redirect_uri_extern>
 *   token_content_type=jwt
 *   scope=offline_access
 *   state=<random_csrf_token>
 */
router.get('/oauth/authorize', (req, res) => {
  try {
    const settings = getSettings();

    // Validare configurare minimă
    if (!settings.client_id) {
      return res.status(400).json({
        error: 'client_id ANAF lipsă. Configurați credențialele OAuth2 în setări SPV-V2.',
        code: 'MISSING_CLIENT_ID',
      });
    }

    const redirectUri = resolveRedirectUri(settings);
    if (!redirectUri) {
      return res.status(400).json({
        error: 'redirect_uri lipsă. Configurați redirect_uri sau public_callback_url în setări SPV-V2.',
        code: 'MISSING_REDIRECT_URI',
        hint: 'Pentru port-forwarding, setați public_callback_url = URL-ul extern accesibil de pe internet (ex: https://myip:5000)',
      });
    }

    // Avertizare dacă redirect_uri folosește IP privat (ANAF nu poate accesa)
    const privateIpPattern = /https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|127\.|localhost)/i;
    if (privateIpPattern.test(redirectUri)) {
      console.warn('[SPV-V2] AVERTISMENT: redirect_uri conține adresă IP privată:', redirectUri);
      console.warn('[SPV-V2] ANAF nu poate accesa adrese private. Configurați IP-ul extern în setări.');
    }

    // ── Audit complet redirect_uri înainte de trimiterea la ANAF ──
    const redirectUriIssues = auditRedirectUri(redirectUri);
    if (redirectUriIssues.length > 0) {
      console.warn('[SPV-V2] *** AVERTISMENTE redirect_uri (pot genera access_denied) ***');
      redirectUriIssues.forEach((issue) => console.warn('[SPV-V2]  ', issue));
    } else {
      console.log('[SPV-V2] redirect_uri audit: OK (fără probleme detectate)');
    }

    // Generare state criptografic pentru protecție CSRF
    // ANAF impune prezența parametrului state
    const state = crypto.randomBytes(32).toString('hex');
    db.prepare(
      `UPDATE spv_v2_settings SET oauth_state = ?, oauth_redirect_uri_used = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`
    ).run(state, redirectUri);

    // Construire URL autorizare cu parametrii corecți
    const params = new URLSearchParams({
      response_type:      'code',
      client_id:          settings.client_id,
      redirect_uri:       redirectUri,
      token_content_type: 'jwt',        // ANAF acceptă 'jwt' sau 'opaque'
      scope:              'offline_access', // necesare pentru refresh_token
      state,
    });

    const authUrl = `${ANAF_AUTH_URL}?${params.toString()}`;

    logAction('oauth_authorize_initiated', {
      redirectUri,
      environment: settings.environment,
      redirectUriIssues,
      timestamp: new Date().toISOString(),
    });

    console.log('[SPV-V2] OAuth2 authorize URL generat:', authUrl);
    console.log('[SPV-V2] Parametri authorize:', {
      response_type: 'code',
      client_id:     settings.client_id,
      redirect_uri:  redirectUri,
      token_content_type: 'jwt',
      scope:         'offline_access',
      state_length:  state.length,
    });
    res.json({
      authUrl,
      state,        // Returnăm state pentru debug; clientul nu trebuie să îl stocheze
      redirectUri,  // Afișăm ce redirect_uri s-a folosit
      redirectUriIssues, // Avertismente despre redirect_uri (pot genera access_denied)
    });
  } catch (err) {
    logAction('oauth_authorize_failed', null, false, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/oauth/callback
 * ──────────────────────────────────────
 * Endpoint PUBLIC – ANAF redirectează utilizatorul la această adresă
 * după autentificarea cu certificatul digital.
 *
 * Parametri primiți de la ANAF:
 *   ?code=<authorization_code>&state=<state>
 *   sau
 *   ?error=<error_code>&error_description=<mesaj>
 *
 * Ce face:
 *   1. Verifică parametrul error (dacă ANAF a refuzat autorizarea)
 *   2. Verifică prezența code
 *   3. Validează state (protecție CSRF)
 *   4. Schimbă code → access_token printr-un POST la ANAF_TOKEN_URL
 *      – Content-Type: application/x-www-form-urlencoded (obligatoriu ANAF)
 *      – Parametri: grant_type, code, redirect_uri, client_id, client_secret
 *      – Header Authorization: Basic base64(client_id:client_secret)
 *   5. Persistă access_token, refresh_token și expiry în DB
 *   6. Redirectează browserul la frontend cu rezultatul
 *
 * IMPORTANT: Codul de autorizare este valid O SINGURĂ DATĂ și expiră rapid
 * (de obicei 60-120 secunde). Nu trebuie refolosit.
 */
router.get('/oauth/callback', async (req, res) => {
  // The 'code' query parameter is the OAuth2 authorization code received from ANAF.
  // Using it in a GET handler is required by the OAuth2 Authorization Code flow spec
  // (RFC 6749 §4.1.2). The code is short-lived, single-use, and immediately exchanged
  // for tokens server-side — it is never stored or logged in full.
  // nosemgrep: javascript.lang.security.audit.cookie.cookie-session.cookie-session
  const { code, state, error: oauthError, error_description } = req.query; // lgtm[js/sensitive-get-query]

  // ── Pas 1: Tratare erori returnate de ANAF ──
  if (oauthError) {
    const settings = getSettings();
    let msg = error_description || oauthError;

    // ANAF omite adesea error_description pentru access_denied
    if (oauthError === 'access_denied' && !error_description) {
      msg = [
        'Autorizarea a fost refuzată de ANAF.',
        'Cauze posibile:',
        '• Certificatul digital nu are rolul e-Factura activat în SPV',
        '• Aplicația nu este aprobată/activată în portalul ANAF OAuth2',
        '• redirect_uri nu coincide EXACT (caracter cu caracter) cu cel înregistrat la ANAF',
        '• IP-ul extern al serverului nu este accesibil de pe internet',
        '• Aplicația OAuth2 nu este asociată cu CIF-ul utilizat',
      ].join(' ');
    }

    const savedRedirectUri = settings.oauth_redirect_uri_used || '';
    const currentRedirectUri = resolveRedirectUri(settings);
    const redirectMismatches = savedRedirectUri
      ? compareRedirectUris(savedRedirectUri, currentRedirectUri)
      : auditRedirectUri(currentRedirectUri);

    console.error('[SPV-V2] *** OAuth2 callback access_denied de la ANAF ***', {
      error:              oauthError,
      error_description,
      redirect_uri_used_at_authorize: savedRedirectUri || '(neinițializat)',
      redirect_uri_in_settings:       currentRedirectUri,
      redirect_uri_mismatches:        redirectMismatches,
      client_id:          settings.client_id,
      environment:        settings.environment,
      timestamp:          new Date().toISOString(),
      debug_hint: [
        'Verificați că redirect_uri din setări coincide EXACT cu cel din portalul ANAF.',
        'Accesați GET /api/efactura-v2/oauth/diagnostic pentru detalii complete.',
      ].join(' '),
    });
    if (redirectMismatches.length > 0) {
      console.error('[SPV-V2] *** NECONCORDANȚE redirect_uri detectate ***');
      redirectMismatches.forEach((m) => console.error('[SPV-V2]  ', m));
    }

    logAction('oauth_callback_error', { error: oauthError, description: msg, redirectMismatches }, false, msg);
    return res.redirect(`${FRONTEND_URL}/?oauth_error=${encodeURIComponent(msg)}&module=spv-v2#efactura-spv`);
  }

  // ── Pas 2: Verificare prezență cod de autorizare ──
  if (!code) {
    const errMsg = 'Cod de autorizare lipsă în callback ANAF.';
    logAction('oauth_callback_no_code', null, false, errMsg);
    return res.redirect(`${FRONTEND_URL}/?oauth_error=${encodeURIComponent(errMsg)}&module=spv-v2#efactura-spv`);
  }

  try {
    const settings = getSettings();

    // ── Pas 3: Validare parametru state (protecție CSRF) ──
    if (!state || !settings.oauth_state || state !== settings.oauth_state) {
      const errMsg = 'Eroare de securitate: parametrul state este invalid. Reîncercați autorizarea.';
      console.error('[SPV-V2] OAuth2 state mismatch – posibil atac CSRF:', {
        received: state,
        expected: settings.oauth_state,
        timestamp: new Date().toISOString(),
      });
      logAction('oauth_callback_state_mismatch', { received: state }, false, errMsg);
      return res.redirect(`${FRONTEND_URL}/?oauth_error=${encodeURIComponent(errMsg)}&module=spv-v2#efactura-spv`);
    }

    // Invalidăm state-ul imediat după verificare (single-use)
    db.prepare(`UPDATE spv_v2_settings SET oauth_state = '' WHERE id = 1`).run();

    const redirectUri = resolveRedirectUri(settings);
    if (!redirectUri) {
      const errMsg = 'redirect_uri lipsă în configurare. Nu se poate finaliza schimbul de token.';
      logAction('oauth_callback_no_redirect_uri', null, false, errMsg);
      return res.redirect(`${FRONTEND_URL}/?oauth_error=${encodeURIComponent(errMsg)}&module=spv-v2#efactura-spv`);
    }

    // ── Verificare mismatch redirect_uri între authorize și callback ──
    // ANAF impune că redirect_uri din token exchange să fie IDENTIC cu cel din authorize.
    const savedRedirectUri = settings.oauth_redirect_uri_used || '';
    if (savedRedirectUri && savedRedirectUri !== redirectUri) {
      const mismatches = compareRedirectUris(savedRedirectUri, redirectUri);
      console.error(
        '[SPV-V2] *** AVERTISMENT CRITIC: redirect_uri diferă între authorize și callback! ***',
        {
          la_authorize:  savedRedirectUri,
          la_callback:   redirectUri,
          mismatches,
          timestamp:     new Date().toISOString(),
        }
      );
      logAction('oauth_callback_redirect_uri_mismatch', { savedRedirectUri, redirectUri, mismatches }, false,
        'redirect_uri diferă între authorize și callback – posibilă cauză access_denied ANAF');
    }

    // Audit complet redirect_uri folosit în token exchange
    const redirectUriIssues = auditRedirectUri(redirectUri);
    if (redirectUriIssues.length > 0) {
      console.warn('[SPV-V2] *** AVERTISMENTE redirect_uri la token exchange (pot genera erori ANAF) ***');
      redirectUriIssues.forEach((issue) => console.warn('[SPV-V2]  ', issue));
    }

    if (!settings.client_id || !settings.client_secret) {
      const errMsg = 'client_id sau client_secret lipsă. Configurați credențialele OAuth2.';
      logAction('oauth_callback_no_credentials', null, false, errMsg);
      return res.redirect(`${FRONTEND_URL}/?oauth_error=${encodeURIComponent(errMsg)}&module=spv-v2#efactura-spv`);
    }

    // ── Pas 4: Schimb authorization_code → access_token ──
    //
    // ANAF impune (conform documentației și testelor Postman):
    //   - Content-Type: application/x-www-form-urlencoded (NU application/json)
    //   - Toți parametrii OBLIGATORII în body: grant_type, code, redirect_uri,
    //     client_id, client_secret  (fără parametri suplimentari/redundanți)
    //   - Header Authorization: Basic base64(client_id:client_secret)
    //   - Accept: application/json
    //
    // Codul de autorizare este UNIC și expiră rapid (~60s) – nu poate fi refolosit.
    const tokenBody = new URLSearchParams({
      grant_type:    'authorization_code',
      code,                          // Codul unic primit de la ANAF
      redirect_uri:  redirectUri,    // Trebuie să coincidă EXACT cu cel din authorize
      client_id:     settings.client_id,
      client_secret: settings.client_secret,
    });

    // Autentificare HTTP Basic (cerință ANAF suplimentară față de body params)
    const basicAuth = Buffer.from(
      `${settings.client_id}:${settings.client_secret}`
    ).toString('base64');

    // ── TROUBLESHOOTING: Log explicit al body-ului trimis la ANAF ──
    // (client_secret este redactat pentru securitate, dar toți ceilalți parametri
    //  sunt afișați complet pentru a permite diagnosticarea HTTP 500 de la ANAF)
    console.log('[SPV-V2] Schimb token la ANAF – parametri body:', {
      url:          ANAF_TOKEN_URL,
      grant_type:   'authorization_code',
      code_prefix:  code.substring(0, 8) + '…',   // Primele 8 caractere din cod (diagnostic)
      code_length:  code.length,
      redirect_uri: redirectUri,
      client_id:    settings.client_id,
      client_secret_set: !!settings.client_secret, // Confirmă prezența, nu valoarea
      auth_header:  'Basic [REDACTED]',
      mtls_enabled: !!getMtlsAgent(),              // Confirmă dacă mTLS este configurat
      body_raw:     tokenBody.toString().replace(/client_secret=[^&]*/,
                      'client_secret=[REDACTED]'),  // Body complet cu secretul redactat
      timestamp:    new Date().toISOString(),
    });

    if (!getMtlsAgent()) {
      console.warn(
        '[SPV-V2] ⚠️  Token exchange fără certificat mTLS – ANAF poate returna HTTP 500.\n' +
        '          Configurați ANAF_CERT_PATH și ANAF_KEY_PATH în server/.env.'
      );
    }

    // ── Retry logic pentru erori 5xx de la serverul ANAF ──
    // ANAF poate returna HTTP 500 tranzitoriu. Reîncercăm de max. 3 ori
    // cu backoff exponențial (1s, 2s, 4s) DOAR pentru erori 5xx,
    // NU pentru 4xx (care sunt erori definitive de parametri/autorizare).
    const TOKEN_EXCHANGE_MAX_RETRIES = 3;
    const TOKEN_EXCHANGE_RETRY_BASE_MS = 1000; // 1 secundă

    let tokenRes;
    let rawBody = '';
    let tokenData = {};
    let lastFetchErr = null;

    for (let attempt = 1; attempt <= TOKEN_EXCHANGE_MAX_RETRIES; attempt++) {
      // Reset per-attempt state (estas variabiles sunt folosite și după buclă)
      rawBody = '';
      tokenData = {};
      lastFetchErr = null;

      try {
        // ── POST către ANAF /token cu Mutual TLS (certificat digital calificat) ──
        tokenRes = await fetchMtls(ANAF_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/x-www-form-urlencoded', // Obligatoriu ANAF
            'Authorization': `Basic ${basicAuth}`,
            'Accept':        'application/json',
          },
          body: tokenBody.toString(),
        });

        // Capturăm întâi textul brut pentru a-l putea loga integral
        // (ANAF poate returna HTML/XML la erori 5xx, nu doar JSON)
        rawBody = await tokenRes.text();

        // Răspuns complet pentru troubleshooting (logăm la orice status nenominal)
        if (!tokenRes.ok) {
          // Colectăm toate headerele răspunsului pentru diagnosticare
          const responseHeaders = {};
          tokenRes.headers.forEach((value, name) => { responseHeaders[name] = value; });

          console.error(`[SPV-V2] Token exchange tentativa ${attempt}/${TOKEN_EXCHANGE_MAX_RETRIES} – răspuns ANAF:`, {
            status:          tokenRes.status,
            statusText:      tokenRes.statusText,
            headers:         responseHeaders,
            body_raw:        rawBody.substring(0, 2000), // Primii 2000 chars (evităm flood log)
            redirect_uri:    redirectUri,
            client_id:       settings.client_id,
            timestamp:       new Date().toISOString(),
          });
        }

        // Parsare JSON din textul capturat
        try {
          tokenData = rawBody ? JSON.parse(rawBody) : {};
        } catch (_) {
          tokenData = {};
        }

        // Retry doar pe 5xx (erori server ANAF), nu pe 4xx (erori client)
        // ANAF returnează frecvent 500 tranzitorii sub 1-2s, iar codul de
        // autorizare expiră în ~60s, deci avem fereastră suficientă pentru
        // 2 reîncercări rapide (1s + 2s) înainte de expirarea codului.
        if (tokenRes.status >= 500 && attempt < TOKEN_EXCHANGE_MAX_RETRIES) {
          const delayMs = calcBackoff(TOKEN_EXCHANGE_RETRY_BASE_MS, attempt);
          console.warn(`[SPV-V2] ANAF server error ${tokenRes.status} – retry ${attempt}/${TOKEN_EXCHANGE_MAX_RETRIES} după ${delayMs}ms`);
          logAction('oauth_token_exchange_retry', {
            attempt,
            status: tokenRes.status,
            delayMs,
          }, false, `ANAF 5xx – retry ${attempt}`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        break; // Ieșim din buclă dacă avem răspuns non-5xx sau am epuizat retry-urile
      } catch (fetchErr) {
        lastFetchErr = fetchErr;
        if (attempt < TOKEN_EXCHANGE_MAX_RETRIES) {
          const delayMs = calcBackoff(TOKEN_EXCHANGE_RETRY_BASE_MS, attempt);
          console.warn(`[SPV-V2] Eroare rețea tentativa ${attempt}/${TOKEN_EXCHANGE_MAX_RETRIES} – retry după ${delayMs}ms:`, fetchErr.message);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
      }
    }

    // Dacă toate tentativele au eșuat cu eroare de rețea
    if (lastFetchErr && !tokenRes) {
      const errMsg = `Eroare conexiune la serverul ANAF după ${TOKEN_EXCHANGE_MAX_RETRIES} tentative: ${lastFetchErr.message}`;
      logAction('oauth_token_exchange_connection_error', null, false, errMsg);
      return res.redirect(`${FRONTEND_URL}/?oauth_error=${encodeURIComponent(errMsg)}&module=spv-v2#efactura-spv`);
    }

    // ── Verificare răspuns non-200 de la ANAF ──
    if (!tokenRes.ok) {
      const errMsg = tokenData.error_description
        || tokenData.error
        || `Eroare HTTP ${tokenRes.status} de la serverul ANAF`;

      // Log final consolidat după epuizarea retry-urilor
      console.error('[SPV-V2] Token exchange eșuat definitiv:', {
        status:      tokenRes.status,
        statusText:  tokenRes.statusText,
        tokenData,
        raw_body:    rawBody.substring(0, 500),
        redirect_uri: redirectUri,
        timestamp:   new Date().toISOString(),
      });
      logAction('oauth_token_exchange_failed', {
        status:      tokenRes.status,
        error:       tokenData.error,
        description: tokenData.error_description,
        raw_snippet: rawBody.substring(0, 200),
      }, false, errMsg);
      // Când ANAF returnează 500 și mTLS nu este configurat, adăugăm indicatorul
      // `mtls_required=1` în redirect pentru ca frontend-ul să afișeze ghidul
      // specific tokenelor hardware USB (Postman / import manual).
      const mtlsHint = (tokenRes.status >= 500 && !getMtlsAgent()) ? '&mtls_required=1' : '';
      return res.redirect(`${FRONTEND_URL}/?oauth_error=${encodeURIComponent(errMsg)}&module=spv-v2${mtlsHint}#efactura-spv`);
    }

    // Validare câmpuri obligatorii din răspuns
    if (!tokenData.access_token) {
      const errMsg = 'Răspuns invalid de la ANAF: lipsă access_token.';
      logAction('oauth_token_exchange_no_token', tokenData, false, errMsg);
      return res.redirect(`${FRONTEND_URL}/?oauth_error=${encodeURIComponent(errMsg)}&module=spv-v2#efactura-spv`);
    }

    // ── Pas 5: Persistare token în baza de date ──
    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
      : '';

    db.prepare(`
      UPDATE spv_v2_settings SET
        oauth_token = ?, refresh_token = ?, token_expires_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(
      tokenData.access_token  || '',
      tokenData.refresh_token || '',
      expiresAt,
    );

    console.log('[SPV-V2] Token OAuth2 obținut cu succes:', {
      expiresAt,
      hasRefreshToken: !!tokenData.refresh_token,
      timestamp: new Date().toISOString(),
    });

    logAction('oauth_token_obtained', {
      expiresAt,
      hasRefreshToken: !!tokenData.refresh_token,
      tokenType: tokenData.token_type,
    });

    // ── Pas 6: Redirect la frontend cu succes ──
    return res.redirect(`${FRONTEND_URL}/?oauth_success=1&module=spv-v2#efactura-spv`);

  } catch (err) {
    console.error('[SPV-V2] OAuth2 callback unexpected error:', err);
    logAction('oauth_callback_unexpected_error', null, false, err.message);
    return res.redirect(
      `${FRONTEND_URL}/?oauth_error=${encodeURIComponent(err.message)}&module=spv-v2#efactura-spv`
    );
  }
});

/**
 * POST /api/efactura-v2/oauth/refresh
 * ──────────────────────────────────────
 * Reînnoiește access_token folosind refresh_token stocat.
 * Util când token-ul a expirat fără a mai fi nevoie de reautorizare manuală.
 *
 * Returnează: { success: true, expiresAt: '...' }
 */
router.post('/oauth/refresh', async (req, res) => {
  try {
    const settings = getSettings();

    if (!settings.refresh_token) {
      return res.status(400).json({
        error: 'Nu există refresh_token salvat. Autorizați din nou aplicația.',
        code: 'NO_REFRESH_TOKEN',
      });
    }
    if (!settings.client_id || !settings.client_secret) {
      return res.status(400).json({
        error: 'client_id / client_secret lipsă. Configurați credențialele OAuth2.',
        code: 'MISSING_CREDENTIALS',
      });
    }

    const tokenBody = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: settings.refresh_token,
      client_id:     settings.client_id,
      client_secret: settings.client_secret,
    });

    const basicAuth = Buffer.from(
      `${settings.client_id}:${settings.client_secret}`
    ).toString('base64');

    // ── TROUBLESHOOTING: Log explicit al body-ului trimis la ANAF ──
    console.log('[SPV-V2] Reînnoire token la ANAF – parametri body:', {
      url:               ANAF_TOKEN_URL,
      grant_type:        'refresh_token',
      refresh_token_set: !!settings.refresh_token,
      client_id:         settings.client_id,
      client_secret_set: !!settings.client_secret,
      mtls_enabled:      !!getMtlsAgent(),
      body_raw:          tokenBody.toString().replace(/client_secret=[^&]*/,
                           'client_secret=[REDACTED]').replace(/refresh_token=[^&]*/,
                           'refresh_token=[REDACTED]'),
      timestamp:         new Date().toISOString(),
    });

    if (!getMtlsAgent()) {
      console.warn(
        '[SPV-V2] ⚠️  Refresh token fără certificat mTLS – ANAF poate returna HTTP 500.\n' +
        '          Configurați ANAF_CERT_PATH și ANAF_KEY_PATH în server/.env.'
      );
    }

    // ── Retry logic pentru erori 5xx de la serverul ANAF ──
    const REFRESH_MAX_RETRIES = 3;
    const REFRESH_RETRY_BASE_MS = 1000;

    let tokenRes;
    let rawBody = '';
    let tokenData = {};
    let lastFetchErr = null;

    for (let attempt = 1; attempt <= REFRESH_MAX_RETRIES; attempt++) {
      // Reset per-attempt state (aceste variabile sunt folosite și după buclă)
      rawBody = '';
      tokenData = {};
      lastFetchErr = null;

      try {
        tokenRes = await fetchMtls(ANAF_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type':  'application/x-www-form-urlencoded',
            'Authorization': `Basic ${basicAuth}`,
            'Accept':        'application/json',
          },
          body: tokenBody.toString(),
        });

        rawBody = await tokenRes.text();

        if (!tokenRes.ok) {
          const responseHeaders = {};
          tokenRes.headers.forEach((value, name) => { responseHeaders[name] = value; });
          console.error(`[SPV-V2] Refresh token tentativa ${attempt}/${REFRESH_MAX_RETRIES} – răspuns ANAF:`, {
            status:     tokenRes.status,
            statusText: tokenRes.statusText,
            headers:    responseHeaders,
            body_raw:   rawBody.substring(0, 2000),
            timestamp:  new Date().toISOString(),
          });
        }

        try { tokenData = rawBody ? JSON.parse(rawBody) : {}; } catch (_) { tokenData = {}; }

        if (tokenRes.status >= 500 && attempt < REFRESH_MAX_RETRIES) {
          const delayMs = calcBackoff(REFRESH_RETRY_BASE_MS, attempt);
          console.warn(`[SPV-V2] ANAF server error ${tokenRes.status} la refresh – retry ${attempt}/${REFRESH_MAX_RETRIES} după ${delayMs}ms`);
          logAction('oauth_refresh_retry', { attempt, status: tokenRes.status, delayMs }, false, `ANAF 5xx – retry ${attempt}`);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        break;
      } catch (fetchErr) {
        lastFetchErr = fetchErr;
        if (attempt < REFRESH_MAX_RETRIES) {
          const delayMs = calcBackoff(REFRESH_RETRY_BASE_MS, attempt);
          console.warn(`[SPV-V2] Eroare rețea refresh tentativa ${attempt}/${REFRESH_MAX_RETRIES} – retry după ${delayMs}ms:`, fetchErr.message);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
      }
    }

    if (lastFetchErr && !tokenRes) {
      logAction('oauth_refresh_connection_error', null, false, lastFetchErr.message);
      return res.status(502).json({ error: `Eroare conexiune ANAF după ${REFRESH_MAX_RETRIES} tentative: ${lastFetchErr.message}` });
    }

    if (!tokenRes.ok) {
      const errMsg = tokenData.error_description || tokenData.error || `Eroare HTTP ${tokenRes.status} de la serverul ANAF`;
      console.error('[SPV-V2] Refresh token eșuat definitiv:', {
        status:    tokenRes.status,
        tokenData,
        raw_body:  rawBody.substring(0, 500),
        timestamp: new Date().toISOString(),
      });
      logAction('oauth_refresh_failed', {
        status: tokenRes.status,
        error: tokenData.error,
        description: tokenData.error_description,
        raw_snippet: rawBody.substring(0, 200),
      }, false, errMsg);
      return res.status(tokenRes.status).json({ error: errMsg, anafResponse: tokenData });
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
      : '';

    db.prepare(`
      UPDATE spv_v2_settings SET
        oauth_token = ?, refresh_token = ?, token_expires_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(
      tokenData.access_token  || '',
      // Unii provideri OAuth2 returnează un nou refresh_token, alții nu.
      // Dacă ANAF nu returnează unul nou, păstrăm refresh_token-ul existent.
      tokenData.refresh_token || settings.refresh_token,
      expiresAt,
    );

    logAction('oauth_token_refreshed', { expiresAt });
    res.json({ success: true, expiresAt, tokenType: tokenData.token_type });
  } catch (err) {
    logAction('oauth_refresh_unexpected_error', null, false, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/oauth/diagnostic
 * ──────────────────────────────────────
 * Returnează starea completă a configurației OAuth2 V2, incluzând
 * verificări pentru probleme comune (IP privat în redirect_uri,
 * token expirat, credențiale lipsă, etc.).
 */
router.get('/oauth/diagnostic', (req, res) => {
  try {
    const settings = getSettings();
    const now = new Date();
    const tokenExpiresAt = settings.token_expires_at ? new Date(settings.token_expires_at) : null;
    const redirectUri = resolveRedirectUri(settings);

    // Verificare probleme comune cu redirect_uri
    const redirectIssues = auditRedirectUri(redirectUri);

    // Compară redirect_uri curentă cu cea folosită la ultima autorizare (dacă există)
    const savedRedirectUri = settings.oauth_redirect_uri_used || '';
    const redirectMismatches = savedRedirectUri
      ? compareRedirectUris(savedRedirectUri, redirectUri)
      : [];

    res.json({
      module:           'E-factura SPV-V2',
      environment:      settings.environment || 'test',
      hasCif:           !!settings.cif,
      hasClientId:      !!settings.client_id,
      hasClientSecret:  !!settings.client_secret,
      hasRedirectUri:   !!redirectUri,
      redirectUri,
      redirectUriSource: settings.redirect_uri
        ? 'settings.redirect_uri'
        : settings.public_callback_url
          ? 'settings.public_callback_url + /api/efactura-v2/oauth/callback'
          : 'none',
      redirectUriIssues: redirectIssues,
      redirectUriUsedAtLastAuthorize: savedRedirectUri || null,
      redirectUriMismatchWithLastAuthorize: redirectMismatches,
      hasToken:         !!settings.oauth_token,
      hasRefreshToken:  !!settings.refresh_token,
      tokenExpired:     tokenExpiresAt ? tokenExpiresAt < now : null,
      tokenExpiresAt:   settings.token_expires_at || null,
      tokenExpiresIn:   tokenExpiresAt
        ? Math.max(0, Math.round((tokenExpiresAt - now) / 1000)) + 's'
        : null,
      lastAction:       settings.last_action    || null,
      lastActionAt:     settings.last_action_at || null,
      checkedAt:        now.toISOString(),
      hints: [
        redirectIssues.length > 0 ? '⚠️ Probleme detectate cu redirect_uri (vezi redirectUriIssues)' : null,
        redirectMismatches.length > 0 ? '⚠️ Neconcordanță redirect_uri față de ultima autorizare (vezi redirectUriMismatchWithLastAuthorize)' : null,
        !settings.client_id     ? '⚠️ client_id lipsă – necesar pentru OAuth2' : null,
        !settings.client_secret ? '⚠️ client_secret lipsă – necesar pentru OAuth2' : null,
        !settings.cif           ? '⚠️ CIF lipsă – necesar pentru upload facturi' : null,
        tokenExpiresAt && tokenExpiresAt < now ? '⚠️ Token expirat – folosiți /oauth/refresh' : null,
        settings.refresh_token && tokenExpiresAt && tokenExpiresAt < now
          ? '✅ refresh_token disponibil – puteți reînnoi automat' : null,
        !savedRedirectUri ? 'ℹ️ Nu a fost inițiată nicio autorizare OAuth2 încă (redirect_uri_used gol)' : null,
      ].filter(Boolean),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/oauth/mtls-status
 * ────────────────────────────────────────
 * Returnează dacă Mutual TLS este configurat pentru schimbul de token ANAF.
 * Folosit de frontend pentru a afișa avertismente și ghidul pentru token USB.
 *
 * Returnează:
 *   { mtlsConfigured: bool, hint: string }
 */
router.get('/oauth/mtls-status', (req, res) => {
  const certPath = process.env.ANAF_CERT_PATH || null;
  const keyPath  = process.env.ANAF_KEY_PATH  || null;
  const mtlsConfigured = !!(certPath && keyPath);

  res.json({
    mtlsConfigured,
    certPathSet: !!certPath,
    keyPathSet:  !!keyPath,
    hint: mtlsConfigured
      ? 'mTLS configurat – schimbul de token se va efectua automat.'
      : [
          'mTLS neconfigurat. Dacă aveți certificatul ca fișier PEM/PFX, adăugați în server/.env:',
          '  ANAF_CERT_PATH=/cale/absoluta/certificat.pem',
          '  ANAF_KEY_PATH=/cale/absoluta/cheie_privata.pem',
          'Dacă certificatul este pe un token hardware USB, folosiți fluxul Postman sau importați',
          'tokenul manual din tab-ul "Token USB / Postman" din configurare.',
        ].join('\n'),
  });
});

/**
 * POST /api/efactura-v2/oauth/token-import
 * ──────────────────────────────────────────
 * Importă un token OAuth2 obținut extern (Postman, curl, alt tool) și îl salvează
 * în baza de date. Acesta este fluxul alternativ pentru utilizatorii cu certificate
 * pe token hardware USB care nu pot fi prezentate automat de backend.
 *
 * Body JSON:
 *   {
 *     access_token:  string  (obligatoriu)
 *     refresh_token: string  (opțional)
 *     expires_in:    number  (secunde, opțional – folosit pentru calculul expirării)
 *     token_type:    string  (opțional, default: "Bearer")
 *   }
 *
 * Returnează: { success: true, expiresAt: string|null }
 */
router.post('/oauth/token-import', (req, res) => {
  try {
    const { access_token, refresh_token, expires_in, token_type } = req.body || {};

    if (!access_token || typeof access_token !== 'string' || !access_token.trim()) {
      return res.status(400).json({
        error: 'access_token lipsă sau invalid. Furnizați un token Bearer valid.',
        code: 'MISSING_ACCESS_TOKEN',
      });
    }

    let trimmedToken = access_token.trim();

    // Dacă utilizatorul a copiat prefixul "Bearer " din Postman/curl, îl eliminăm automat
    if (/^bearer\s+/i.test(trimmedToken)) {
      trimmedToken = trimmedToken.replace(/^bearer\s+/i, '');
      console.log('[SPV-V2] ℹ️  Prefix "Bearer " detectat și eliminat automat din access_token importat.');
    }

    // Verificare minimă: tokenul nu trebuie să conțină spații (Bearer tokens sunt compacți)
    if (/\s/.test(trimmedToken)) {
      return res.status(400).json({
        error: 'access_token invalid: conține spații în interiorul valorii. Asigurați-vă că ați copiat doar valoarea tokenului fără caractere suplimentare.',
        code: 'INVALID_TOKEN_FORMAT',
      });
    }

    const expiresAt = expires_in && Number(expires_in) > 0
      ? new Date(Date.now() + Number(expires_in) * 1000).toISOString()
      : '';

    // Verificare tip token: ANAF API (upload/mesaje) necesită token JWT.
    // Tokenii opaci (hex fără puncte) sunt respinși cu 401 invalid_token.
    // Această verificare este informativă – nu blocăm importul, dar avertizăm.
    const tokenIsJwt = isJwtToken(trimmedToken);
    if (!tokenIsJwt) {
      console.warn(
        '[SPV-V2] ⚠️  Token importat NU arată ca JWT (lipsesc cele 3 segmente base64 separate prin ".").\n' +
        '          ANAF API (upload, mesaje SPV) necesită token JWT (obținut cu token_content_type=jwt în authorize URL).\n' +
        '          Un token opac (hexadecimal) va fi respins cu 401 invalid_token la orice apel API.\n' +
        '          Soluție: în Postman, la Authorization → OAuth 2.0, adăugați parametrul\n' +
        '            "token_content_type" = "jwt" în "Advanced Options", obțineți un token nou și reimportați-l.'
      );
    } else {
      console.log('[SPV-V2] ✅ Token importat este JWT (format corect pentru ANAF API).');
    }

    db.prepare(`
      UPDATE spv_v2_settings SET
        oauth_token = ?,
        refresh_token = ?,
        token_expires_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `).run(
      trimmedToken,
      refresh_token ? String(refresh_token).trim() : '',
      expiresAt,
    );

    logAction('oauth_token_imported', {
      source:          'manual_import',
      tokenType:       token_type || 'Bearer',
      tokenIsJwt,
      hasRefreshToken: !!refresh_token,
      expiresAt:       expiresAt || 'necunoscut',
    });

    console.log('[SPV-V2] ✅ Token importat manual cu succes:', {
      source:          'token-import endpoint',
      tokenIsJwt,
      hasRefreshToken: !!refresh_token,
      expiresAt:       expiresAt || 'necunoscut',
      timestamp:       new Date().toISOString(),
    });

    const jwtWarning = tokenIsJwt
      ? null
      : 'Atenție: tokenul importat NU este JWT. ANAF API necesită token JWT (obținut cu token_content_type=jwt). ' +
        'Uploadul și mesajele SPV vor eșua cu 401 invalid_token. ' +
        'Configurați Postman cu parametrul Advanced: token_content_type=jwt și obțineți un token nou.';

    res.json({
      success:         true,
      tokenIsJwt,
      expiresAt:       expiresAt || null,
      hasRefreshToken: !!refresh_token,
      message:         tokenIsJwt
        ? 'Token JWT importat cu succes. Puteți acum transmite facturi.'
        : 'Token importat (atenție: nu este JWT – vedeți câmpul warning).',
      warning:         jwtWarning,
    });
  } catch (err) {
    logAction('oauth_token_import_error', null, false, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/status
 * Stare rapidă a modulului (token valid, mediu, CIF).
 */
router.get('/status', (req, res) => {
  try {
    const settings = getSettings();
    const tokenExpired = isTokenExpired(settings);
    res.json({
      module:       'E-factura SPV-V2',
      ready:        !!settings.oauth_token && !tokenExpired && !!settings.cif,
      tokenValid:   !!settings.oauth_token && !tokenExpired,
      tokenExpired,
      environment:  settings.environment || 'test',
      hasCif:       !!settings.cif,
      lastAction:   settings.last_action || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/action-log?limit=50
 * Returnează ultimele N intrări din jurnalul de acțiuni.
 */
router.get('/action-log', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 500);
    const logs = db.prepare(
      'SELECT * FROM spv_v2_action_log ORDER BY created_at DESC LIMIT ?'
    ).all(limit);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// RUTE – ANAF E-FACTURA API (necesită token valid)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/efactura-v2/upload/:invoiceId
 * ──────────────────────────────────────────
 * Încarcă o factură în format UBL XML în SPV ANAF.
 * Actualizează billing_invoices cu ID-ul de upload și starea curentă.
 *
 * Parametri URL:
 *   invoiceId – ID-ul facturii din billing_invoices
 *
 * Returnează: { uploadId, status, anafResponse }
 */
router.post('/upload/:invoiceId', requireToken, async (req, res) => {
  try {
    const settings = req.spvSettings;
    if (!settings.cif) {
      return res.status(400).json({ error: 'CIF furnizor lipsă în setări SPV-V2.' });
    }

    const inv = db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(req.params.invoiceId);
    if (!inv) {
      return res.status(404).json({ error: 'Factura nu a fost găsită.' });
    }

    // Generare XML UBL și eliminare schemaLocation (ANAF poate respinge XML cu schemaLocation)
    let xml;
    try {
      xml = removeSchemaLocation(buildUBL(inv));
    } catch (xmlErr) {
      logAction('upload_xml_build_error', { invoiceId: inv.id }, false, xmlErr.message);
      return res.status(500).json({ error: `Eroare generare XML: ${xmlErr.message}` });
    }

    const baseUrl  = getBaseUrl(settings);
    const uploadUrl = `${baseUrl}/upload?standard=UBL&cif=${encodeURIComponent(settings.cif)}`;

    // Marcare ca 'uploading' în DB
    db.prepare(
      `UPDATE billing_invoices SET spv_status = 'uploading', spv_uploaded_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(inv.id);

    let anafRes, anafBody, anafRawText;
    let uploadId = null;
    let execStatus = null;
    try {
      anafRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          ...bearerHeader(settings.oauth_token),
          'Content-Type': 'application/xml',
        },
        body: Buffer.from(xml, 'utf8'),
      });
      anafRawText = await anafRes.text();

      // ANAF returnează JSON la erori (401, 400 etc.) și XML la upload procesat (succes/eroare validare).
      // Logica din referința PHP UBLUploadResponse.php:
      //   - JSON → eroare autentificare/request
      //   - XML cu ExecutionStatus="0" → upload acceptat, extrage index_incarcare
      //   - XML cu ExecutionStatus≠"0" → eroare de validare ANAF, extrage mesaj din Errors
      try {
        anafBody = JSON.parse(anafRawText);
        // JSON → eroare; uploadId rămâne null, execStatus se extrage dacă există
        execStatus = anafBody?.ExecutionStatus != null ? String(anafBody.ExecutionStatus) : null;
      } catch {
        // Nu e JSON → interpretăm ca XML ANAF
        const parsed = parseAnafUploadXml(anafRawText);
        uploadId    = parsed.index_incarcare;
        execStatus  = parsed.ExecutionStatus;
        // Construim un obiect normalizat pentru a fi consistent cu răspunsul JSON
        anafBody = {
          index_incarcare: parsed.index_incarcare,
          ExecutionStatus:  parsed.ExecutionStatus,
          dateResponse:     parsed.dateResponse,
          errors:           parsed.errors,
          _rawXml:          anafRawText.substring(0, 500),
        };
        console.log('[SPV-V2] ℹ️ Răspuns ANAF XML (upload):', {
          invoiceId:         inv.id,
          uploadId,
          execStatus,
          errors:            parsed.errors,
        });
      }
    } catch (fetchErr) {
      db.prepare(`UPDATE billing_invoices SET spv_status = 'error' WHERE id = ?`).run(inv.id);
      logAction('upload_connection_error', { invoiceId: inv.id }, false, fetchErr.message);
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${fetchErr.message}` });
    }

    // Analiză răspuns ANAF – logare explicită pentru depanare
    if (!anafRes.ok) {
      console.error('[SPV-V2] ❌ Upload factură eșuat – răspuns ANAF:', {
        invoiceId:  inv.id,
        httpStatus: anafRes.status,
        httpText:   anafRes.statusText,
        headers:    Object.fromEntries(anafRes.headers.entries()),
        body:       anafRawText,
        uploadUrl,
        timestamp:  new Date().toISOString(),
      });
    }

    // ExecutionStatus="0" = succes (referința PHP: "$success = ((string)$xml['ExecutionStatus'] === '0')")
    const execStatusStr = execStatus != null ? String(execStatus) : null;
    const isAnafError   = execStatusStr !== null && execStatusStr !== '0';
    const newStatus     = (!anafRes.ok || isAnafError) ? 'error' : 'uploaded';

    // uploadId din JSON (dacă ANAF a returnat JSON cu succes, rar dar posibil)
    if (!uploadId && typeof anafBody === 'object' && anafBody !== null) {
      uploadId = anafBody?.index_incarcare || anafBody?.IndexIncarcare || null;
    }

    db.prepare(`
      UPDATE billing_invoices SET
        spv_upload_id = ?, spv_status = ?, spv_response = ?, spv_uploaded_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(uploadId, newStatus, JSON.stringify(anafBody), inv.id);

    logAction('upload', { invoiceId: inv.id, uploadId, status: newStatus, anafHttpStatus: anafRes.status });

    if (!anafRes.ok || isAnafError) {
      const anafHttpStatus = anafRes.status;
      const anafErrorCode  = typeof anafBody === 'object' ? (anafBody?.error || null) : null;
      const anafXmlErrors  = Array.isArray(anafBody?.errors) && anafBody.errors.length > 0
        ? anafBody.errors.join('; ') : null;
      let errorDetail = 'Eroare la upload în SPV ANAF.';
      if (isAnafError && anafXmlErrors) {
        errorDetail = `ANAF a respins factura: ${anafXmlErrors}`;
      } else if (anafHttpStatus === 401) {
        if (anafErrorCode === 'invalid_token') {
          errorDetail =
            'ANAF a respins tokenul ca invalid (invalid_token). Cauze frecvente: ' +
            '(1) tokenul importat este opac (nu JWT) – obțineți token JWT cu token_content_type=jwt; ' +
            '(2) tokenul a fost obținut cu un Callback URL diferit față de redirect_uri-ul înregistrat la ANAF; ' +
            '(3) tokenul nu deține scope-urile necesare pentru operațiuni API (upload); ' +
            '(4) tokenul a expirat sau a fost revocat de ANAF. ' +
            'Soluție: în Postman, adăugați Advanced param token_content_type=jwt, setați Callback URL exact la ' +
            'valoarea redirect_uri a aplicației, obțineți un token nou și reimportați-l.';
          console.error('[SPV-V2] ⚠ invalid_token la upload – verificați că tokenul este JWT (nu opac/hex).');
        } else {
          errorDetail = 'Token invalid sau expirat (ANAF 401 Unauthorized). Reimportați tokenul din Postman.';
        }
      } else if (anafHttpStatus === 403) errorDetail = 'Acces refuzat de ANAF (403 Forbidden). Verificați că CIF-ul și tokenul corespund.';
      else if (anafHttpStatus === 415) errorDetail = 'Format XML neacceptat de ANAF (415 Unsupported Media Type).';
      else if (anafHttpStatus === 422) errorDetail = 'Date XML invalide respinse de ANAF (422 Unprocessable Entity).';
      else if (anafHttpStatus >= 500) errorDetail = `Eroare server ANAF (${anafHttpStatus}). Încercați din nou.`;
      return res.status(anafRes.ok ? 422 : anafRes.status).json({
        error: errorDetail,
        anafHttpStatus,
        anafError: anafErrorCode,
        anafXmlErrors,
        uploadId,
        status: newStatus,
        anafResponse: anafBody,
      });
    }

    res.json({ uploadId, status: newStatus, anafResponse: anafBody });
  } catch (err) {
    console.error('[SPV-V2] Upload error:', err);
    logAction('upload_unexpected_error', { invoiceId: req.params.invoiceId }, false, err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/check-status/:invoiceId
 * Verifică starea unui mesaj SPV folosind ID-ul de upload stocat.
 *
 * Stări posibile ANAF: 'ok', 'nok', 'in prelucrare', + variante cu erori.
 * Le mapăm la: 'validated', 'rejected', 'processing', 'error'.
 */
router.get('/check-status/:invoiceId', requireToken, async (req, res) => {
  try {
    const settings = req.spvSettings;
    const inv = db.prepare(
      'SELECT id, spv_upload_id, spv_status FROM billing_invoices WHERE id = ?'
    ).get(req.params.invoiceId);

    if (!inv) return res.status(404).json({ error: 'Factura nu a fost găsită.' });
    if (!inv.spv_upload_id) {
      return res.status(400).json({ error: 'Factura nu a fost încărcată în SPV (lipsă upload_id).' });
    }

    const baseUrl   = getBaseUrl(settings);
    const statusUrl = `${baseUrl}/stareMesaj?id_incarcare=${encodeURIComponent(inv.spv_upload_id)}`;

    let anafRes, anafBody;
    try {
      anafRes  = await fetch(statusUrl, { headers: bearerHeader(settings.oauth_token) });
      anafBody = await anafRes.json().catch(() => anafRes.text());
    } catch (fetchErr) {
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${fetchErr.message}` });
    }

    if (!anafRes.ok) {
      const anafErrCode = typeof anafBody === 'object' ? (anafBody?.error || null) : null;
      let errMsg;
      if (anafRes.status === 401 && anafErrCode === 'invalid_token') {
        errMsg =
          'ANAF a respins tokenul ca invalid (invalid_token) la verificarea stării. ' +
          'Reimportați tokenul cu Callback URL identic cu redirect_uri-ul aplicației.';
        console.error('[SPV-V2] ⚠ invalid_token la check-status – tokenul poate fi incompatibil cu aplicația.');
      } else {
        errMsg = typeof anafBody === 'string' ? anafBody : JSON.stringify(anafBody);
      }
      return res.status(anafRes.status).json({ error: errMsg, anafError: anafErrCode, anafResponse: anafBody });
    }
    const anafStare = anafBody?.stare || '';
    let newStatus = inv.spv_status;
    if (anafStare === 'ok')                              newStatus = 'validated';
    else if (anafStare === 'nok')                        newStatus = 'rejected';
    else if (anafStare === 'in prelucrare')              newStatus = 'processing';
    else if (anafStare?.toLowerCase().includes('erori')) newStatus = 'error';

    const downloadId = anafBody?.id_descarcare || null;
    db.prepare(`
      UPDATE billing_invoices SET spv_status = ?, spv_response = ?, spv_download_id = ?
      WHERE id = ?
    `).run(newStatus, JSON.stringify(anafBody), downloadId, inv.id);

    logAction('check_status', { invoiceId: inv.id, anafStare, newStatus });
    res.json({ uploadId: inv.spv_upload_id, anafStatus: anafStare, localStatus: newStatus, downloadId, anafResponse: anafBody });
  } catch (err) {
    console.error('[SPV-V2] Check status error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/download/:invoiceId
 * Descarcă răspunsul ZIP de la ANAF pentru o factură validată/respinsă.
 * Necesită ca factura să fi primit un spv_download_id de la ANAF.
 */
router.get('/download/:invoiceId', requireToken, async (req, res) => {
  try {
    const settings = req.spvSettings;
    const inv = db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(req.params.invoiceId);
    if (!inv)              return res.status(404).json({ error: 'Factura nu a fost găsită.' });
    if (!inv.spv_download_id) return res.status(400).json({ error: 'Nu există ID descărcare pentru această factură.' });

    const baseUrl = getBaseUrl(settings);
    const dlUrl   = `${baseUrl}/descarcare?id=${encodeURIComponent(inv.spv_download_id)}`;

    let anafRes;
    try {
      anafRes = await fetch(dlUrl, { headers: bearerHeader(settings.oauth_token) });
    } catch (fetchErr) {
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${fetchErr.message}` });
    }

    if (!anafRes.ok) {
      const body = await anafRes.text();
      return res.status(anafRes.status).json({ error: body });
    }

    const buffer = Buffer.from(await anafRes.arrayBuffer());
    logAction('download', { invoiceId: inv.id, downloadId: inv.spv_download_id });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="raspuns_anaf_${inv.invoice_code || inv.id}.zip"`);
    res.send(buffer);
  } catch (err) {
    console.error('[SPV-V2] Download error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/xml/:invoiceId
 * Returnează XML-ul UBL generat pentru o factură (pentru previzualizare/debug).
 */
router.get('/xml/:invoiceId', (req, res) => {
  try {
    const inv = db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(req.params.invoiceId);
    if (!inv) return res.status(404).json({ error: 'Factura nu a fost găsită.' });

    let xml;
    try {
      xml = buildUBL(inv);
    } catch (xmlErr) {
      return res.status(500).json({ error: `Eroare generare XML: ${xmlErr.message}` });
    }

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="factura-${inv.invoice_code || inv.id}.xml"`);
    res.send(xml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/messages?zile=60&filtru=T
 * Listează mesajele din SPV ANAF (primite/emise/erori/toate).
 *
 * Query params:
 *   zile   – număr de zile în urmă (max 60, conform ANAF)
 *   filtru – E=erori, T=trimise (emise de noi), P=primite, R=în aprobare; omis = toate
 *
 * Notă: parametrul ANAF este "filtru" (nu "tip"). Valorile acceptate de ANAF: E, T, P, R.
 * Referință: ANAFAPIClient.php ValidateFilter() – ["E", "T", "P", "R"]
 */
router.get('/messages', requireToken, async (req, res) => {
  try {
    const settings = req.spvSettings;
    if (!settings.cif) {
      return res.status(400).json({ error: 'CIF furnizor lipsă în setări SPV-V2.' });
    }

    const zile   = Math.min(Number(req.query.zile) || 60, 60); // ANAF limitează la 60 zile
    // Acceptăm și parametrul legacy "tip" pentru compatibilitate cu versiunile anterioare ale UI
    const filtruRaw = req.query.filtru || req.query.tip || '';
    const filtru    = ['E', 'T', 'P', 'R'].includes(filtruRaw.toUpperCase())
      ? filtruRaw.toUpperCase() : null;

    const baseUrl = getBaseUrl(settings);
    let listUrl = `${baseUrl}/listaMesajeFactura?zile=${zile}&cif=${encodeURIComponent(settings.cif)}`;
    if (filtru) listUrl += `&filtru=${filtru}`;

    let anafRes, anafBody;
    try {
      anafRes  = await fetch(listUrl, { headers: bearerHeader(settings.oauth_token) });
      anafBody = await anafRes.json().catch(async () => await anafRes.text());
    } catch (fetchErr) {
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${fetchErr.message}` });
    }

    if (!anafRes.ok) {
      const anafErrCode = typeof anafBody === 'object' ? (anafBody?.error || null) : null;
      let errMsg;
      if (anafRes.status === 401 && anafErrCode === 'invalid_token') {
        errMsg =
          'ANAF a respins tokenul ca invalid (invalid_token) la citirea mesajelor SPV. ' +
          'Cauze frecvente: (1) tokenul importat este opac (nu JWT) – obțineți token JWT cu token_content_type=jwt; ' +
          '(2) tokenul a fost obținut cu Callback URL diferit față de redirect_uri-ul aplicației; ' +
          '(3) tokenul are scope-uri insuficiente sau a expirat. ' +
          'Soluție: în Postman, adăugați Advanced param token_content_type=jwt și reimportați.';
        console.error('[SPV-V2] ⚠ invalid_token la listare mesaje SPV – verificați că tokenul este JWT (nu opac/hex).');
      } else if (anafRes.status === 401) {
        errMsg = 'Token invalid sau expirat (ANAF 401). Reimportați tokenul.';
      } else {
        errMsg = typeof anafBody === 'string' ? anafBody : JSON.stringify(anafBody);
      }
      return res.status(anafRes.status).json({ error: errMsg, anafError: anafErrCode, anafResponse: anafBody });
    }

    // Cache local al mesajelor pentru acces offline
    const messages = anafBody?.mesaje || [];
    if (messages.length > 0) {
      const upsert = db.prepare(`
        INSERT OR REPLACE INTO spv_messages
          (anaf_message_id, tip, data_creare, cif, id_solicitant, detalii, id_descarcare, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `);
      for (const m of messages) {
        upsert.run(
          String(m.id || ''),
          m.tip       || '',
          m.data_creare || '',
          String(m.cif || ''),
          String(m.id_solicitant || ''),
          m.detalii   || '',
          String(m.id_descarcare || ''),
        );
      }
    }

    logAction('list_messages', { count: messages.length, zile, filtru });
    res.json({ messages, total: messages.length, raw: anafBody });
  } catch (err) {
    console.error('[SPV-V2] Messages error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/messages-paged?startTime=...&endTime=...&cif=...&pagina=1&filtru=T
 * Listează mesajele din SPV ANAF folosind endpoint-ul paginat.
 * Util când lista depășește limita ANAF pentru /listaMesajeFactura.
 *
 * Query params:
 *   startTime – timestamp Unix (secunde) start interval
 *   endTime   – timestamp Unix (secunde) end interval (max = now - 5 min, ANAF)
 *   pagina    – numărul paginii (1-based)
 *   filtru    – E/T/P/R (opțional)
 *
 * Notă: ANAF /listaMesajePaginatieFactura necesită startTime/endTime în milisecunde!
 */
router.get('/messages-paged', requireToken, async (req, res) => {
  try {
    const settings = req.spvSettings;
    if (!settings.cif) {
      return res.status(400).json({ error: 'CIF furnizor lipsă în setări SPV-V2.' });
    }

    const now         = Math.floor(Date.now() / 1000);
    const offsetSec   = 5 * 60; // ANAF: end date trebuie să fie cu cel puțin 5 minute în trecut
    const DEFAULT_DAYS_BACK = 60; // Intervalul implicit de 60 de zile (limita ANAF)
    const startTime   = Number(req.query.startTime) || (now - DEFAULT_DAYS_BACK * 24 * 3600);
    const endTime     = Math.min(Number(req.query.endTime) || now, now - offsetSec);
    const pagina      = Math.max(1, Number(req.query.pagina) || 1);
    const filtruRaw   = req.query.filtru || '';
    const filtru      = ['E', 'T', 'P', 'R'].includes(filtruRaw.toUpperCase())
      ? filtruRaw.toUpperCase() : null;

    const baseUrl = getBaseUrl(settings);
    // ANAF necesită timestamps în milisecunde
    let pagedUrl = `${baseUrl}/listaMesajePaginatieFactura?startTime=${startTime * 1000}&endTime=${endTime * 1000}&cif=${encodeURIComponent(settings.cif)}&pagina=${pagina}`;
    if (filtru) pagedUrl += `&filtru=${filtru}`;

    let anafRes, anafBody;
    try {
      anafRes  = await fetch(pagedUrl, { headers: bearerHeader(settings.oauth_token) });
      anafBody = await anafRes.json().catch(async () => await anafRes.text());
    } catch (fetchErr) {
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${fetchErr.message}` });
    }

    if (!anafRes.ok) {
      const errMsg = typeof anafBody === 'object' ? JSON.stringify(anafBody) : String(anafBody);
      return res.status(anafRes.status).json({ error: errMsg, anafResponse: anafBody });
    }

    const messages = anafBody?.mesaje || [];
    logAction('list_messages_paged', { count: messages.length, pagina, filtru });
    res.json({ messages, total: messages.length, pagina, raw: anafBody });
  } catch (err) {
    console.error('[SPV-V2] Messages-paged error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/download-message/:id_descarcare
 * Descarcă un mesaj specific din SPV ANAF ca fișier ZIP.
 *
 * Notă: ANAF folosește același endpoint /descarcare?id=... pentru descărcarea
 * atât a răspunsurilor la facturi încărcate cât și a mesajelor din lista SPV.
 * (Referință: ANAFAPIClient.php DownloadAnswer() – /{prod|test}/FCTEL/rest/descarcare?id=...)
 */
router.get('/download-message/:id_descarcare', requireToken, async (req, res) => {
  try {
    const settings         = req.spvSettings;
    const { id_descarcare } = req.params;

    const baseUrl = getBaseUrl(settings);
    // Endpoint corect ANAF: /descarcare?id=... (nu /descarcareMesaj)
    const dlUrl   = `${baseUrl}/descarcare?id=${encodeURIComponent(id_descarcare)}`;

    let anafRes;
    try {
      anafRes = await fetch(dlUrl, { headers: bearerHeader(settings.oauth_token) });
    } catch (fetchErr) {
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${fetchErr.message}` });
    }

    if (!anafRes.ok) {
      const body = await anafRes.text();
      return res.status(anafRes.status).json({ error: body });
    }

    // Actualizare cache local
    db.prepare(
      'UPDATE spv_messages SET downloaded_at = CURRENT_TIMESTAMP WHERE id_descarcare = ?'
    ).run(id_descarcare);

    const buffer = Buffer.from(await anafRes.arrayBuffer());
    logAction('download_message', { id_descarcare });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="mesaj_anaf_${id_descarcare}.zip"`);
    res.send(buffer);
  } catch (err) {
    console.error('[SPV-V2] Download message error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/efactura-v2/local-messages
 * Returnează mesajele SPV cacheate local (fără apel la ANAF).
 */
router.get('/local-messages', (req, res) => {
  try {
    const msgs = db.prepare(
      'SELECT * FROM spv_messages ORDER BY data_creare DESC, created_at DESC'
    ).all();
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/efactura-v2/upload-batch
 * Încarcă mai multe facturi în lot în SPV ANAF.
 *
 * Body: { invoiceIds: ['id1', 'id2', ...] }
 * Returnează: { results, total, success }
 */
router.post('/upload-batch', requireToken, async (req, res) => {
  try {
    const { invoiceIds = [] } = req.body;
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({ error: 'invoiceIds array necesar și nevid.' });
    }

    const settings = req.spvSettings;
    if (!settings.cif) {
      return res.status(400).json({ error: 'CIF furnizor lipsă în setări SPV-V2.' });
    }

    const baseUrl = getBaseUrl(settings);
    const results = [];

    for (const invoiceId of invoiceIds) {
      const inv = db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(invoiceId);
      if (!inv) {
        results.push({ invoiceId, success: false, error: 'Factura nu a fost găsită.' });
        continue;
      }

      try {
        const xml       = removeSchemaLocation(buildUBL(inv));
        const uploadUrl = `${baseUrl}/upload?standard=UBL&cif=${encodeURIComponent(settings.cif)}`;

        db.prepare(
          `UPDATE billing_invoices SET spv_status = 'uploading', spv_uploaded_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(inv.id);

        const anafRes  = await fetch(uploadUrl, {
          method: 'POST',
          headers: {
            ...bearerHeader(settings.oauth_token),
            'Content-Type': 'application/xml',
          },
          body: Buffer.from(xml, 'utf8'),
        });
        const anafRawText = await anafRes.text();

        let anafBody;
        let uploadId   = null;
        let execStatus = null;
        try {
          anafBody = JSON.parse(anafRawText);
          execStatus = anafBody?.ExecutionStatus != null ? String(anafBody.ExecutionStatus) : null;
        } catch {
          const parsed = parseAnafUploadXml(anafRawText);
          uploadId   = parsed.index_incarcare;
          execStatus = parsed.ExecutionStatus;
          anafBody   = {
            index_incarcare: parsed.index_incarcare,
            ExecutionStatus:  parsed.ExecutionStatus,
            dateResponse:     parsed.dateResponse,
            errors:           parsed.errors,
            _rawXml:          anafRawText.substring(0, 500),
          };
        }
        if (!uploadId && typeof anafBody === 'object' && anafBody !== null) {
          uploadId = anafBody?.index_incarcare || anafBody?.IndexIncarcare || null;
        }
        const isAnafError = execStatus != null && String(execStatus) !== '0';
        const newStatus   = (!anafRes.ok || isAnafError) ? 'error' : 'uploaded';

        db.prepare(`
          UPDATE billing_invoices SET
            spv_upload_id = ?, spv_status = ?, spv_response = ?, spv_uploaded_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(uploadId, newStatus, JSON.stringify(anafBody), inv.id);

        results.push({
          invoiceId,
          success:      anafRes.ok && !isAnafError,
          uploadId,
          status:       newStatus,
          anafResponse: anafBody,
        });
      } catch (itemErr) {
        db.prepare(`
          UPDATE billing_invoices SET spv_status = 'error', spv_response = ? WHERE id = ?
        `).run(JSON.stringify({ error: itemErr.message }), inv.id);
        results.push({ invoiceId, success: false, error: itemErr.message });
      }

      // Pauză între cereri pentru a evita rate-limiting ANAF
      await new Promise(r => setTimeout(r, UPLOAD_DELAY_MS));
    }

    const successCount = results.filter(r => r.success).length;
    logAction('upload_batch', { total: invoiceIds.length, success: successCount });
    res.json({ results, total: results.length, success: successCount });
  } catch (err) {
    console.error('[SPV-V2] Batch upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/efactura-v2/check-status-batch
 * Verifică starea mai multor facturi încărcate în lot.
 *
 * Body: { invoiceIds: ['id1', 'id2', ...] }
 * Returnează: { results }
 */
router.post('/check-status-batch', requireToken, async (req, res) => {
  try {
    const { invoiceIds = [] } = req.body;
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({ error: 'invoiceIds array necesar și nevid.' });
    }

    const settings = req.spvSettings;
    const baseUrl  = getBaseUrl(settings);
    const results  = [];

    for (const invoiceId of invoiceIds) {
      const inv = db.prepare(
        'SELECT id, spv_upload_id, spv_status FROM billing_invoices WHERE id = ?'
      ).get(invoiceId);

      if (!inv || !inv.spv_upload_id) {
        results.push({ invoiceId, skipped: true, reason: !inv ? 'not_found' : 'no_upload_id' });
        continue;
      }

      try {
        const statusUrl = `${baseUrl}/stareMesaj?id_incarcare=${encodeURIComponent(inv.spv_upload_id)}`;
        const anafRes   = await fetch(statusUrl, { headers: bearerHeader(settings.oauth_token) });
        const anafBody  = await anafRes.json().catch(() => anafRes.text());

        const anafStare = anafBody?.stare || '';
        let newStatus = inv.spv_status;
        if (anafStare === 'ok')                              newStatus = 'validated';
        else if (anafStare === 'nok')                        newStatus = 'rejected';
        else if (anafStare === 'in prelucrare')              newStatus = 'processing';
        else if (anafStare?.toLowerCase().includes('erori')) newStatus = 'error';

        const downloadId = anafBody?.id_descarcare || null;
        db.prepare(`
          UPDATE billing_invoices SET spv_status = ?, spv_response = ?, spv_download_id = ?
          WHERE id = ?
        `).run(newStatus, JSON.stringify(anafBody), downloadId, inv.id);

        results.push({ invoiceId, anafStatus: anafStare, localStatus: newStatus, downloadId });
      } catch (itemErr) {
        results.push({ invoiceId, error: itemErr.message });
      }

      await new Promise(r => setTimeout(r, STATUS_DELAY_MS));
    }

    logAction('check_status_batch', { total: invoiceIds.length });
    res.json({ results });
  } catch (err) {
    console.error('[SPV-V2] Batch status check error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

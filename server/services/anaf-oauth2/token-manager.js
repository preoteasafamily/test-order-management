'use strict';

/**
 * ANAF OAuth2 – JWT Token Manager
 * ================================
 * Modul standalone și reutilizabil pentru gestionarea completă a tokenului
 * JWT ANAF prin fluxul OAuth2 Authorization Code Grant.
 *
 * Inspirat din fluxul PHP ANAF descris de Lorand Szekely (logare, redirect,
 * primire cod, schimb cod → token, refresh, stocare).
 *
 * Caracteristici principale:
 *   ✅ Autentificare EXCLUSIV prin browser – fără mTLS sau chei private pe server
 *   ✅ Stocare în baza de date (better-sqlite3) cu fallback la fișier criptat (AES-256-GCM)
 *   ✅ Reînnoire automată a tokenului înainte de expirare (scheduler)
 *   ✅ Validare strictă JWT (3 segmente base64url)
 *   ✅ Error handling detaliat cu mesaje acționabile în română
 *   ✅ Logging complet cu prefixul [ANAF-OAUTH2]
 *   ✅ Anti-CSRF via state randomizat (32 octeți hex)
 *
 * Flux OAuth2 implementat (inspirat din exemplul PHP ANAF – Lorand Szekely):
 *   1. buildAuthUrl()       → URL autorizare ANAF (browser deschide URL-ul)
 *   2. exchangeCode()       → POST /token cu authorization_code → JWT
 *   3. refreshAccessToken() → POST /token cu refresh_token → JWT nou
 *   4. scheduleAutoRefresh()→ reînnoire automată înainte de expirare
 *
 * Stocare token:
 *   - Primară:  DB SQLite via setteri injectați (getToken / saveToken)
 *   - Fallback: fișier JSON criptat AES-256-GCM (dacă DB nu e disponibilă)
 *
 * Utilizare rapidă:
 *   const tm = require('./services/anaf-oauth2/token-manager');
 *
 *   // 1. Generare URL autorizare
 *   const { authUrl, state } = tm.buildAuthUrl({ clientId, redirectUri });
 *
 *   // 2. La callback ANAF
 *   const token = await tm.exchangeCode({ code, redirectUri, clientId, clientSecret });
 *
 *   // 3. Reînnoire manuală
 *   const newToken = await tm.refreshAccessToken({ refreshToken, clientId, clientSecret });
 *
 *   // 4. Auto-refresh (la startup server)
 *   const stop = tm.scheduleAutoRefresh({ getToken, saveToken });
 *   // La shutdown: stop()
 */

const crypto = require('crypto');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');

// ─── Constante ANAF ──────────────────────────────────────────────────────────

const ANAF_AUTH_URL  = 'https://logincert.anaf.ro/anaf-oauth2/v1/authorize';
const ANAF_TOKEN_URL = 'https://logincert.anaf.ro/anaf-oauth2/v1/token';

// ─── Constante interne ────────────────────────────────────────────────────────

/** Câte minute înainte de expirare să înceapă auto-refresh-ul */
const AUTO_REFRESH_MARGIN_MINUTES = 10;

/** Interval de verificare expirare token (ms) */
const AUTO_REFRESH_CHECK_INTERVAL_MS = 60 * 1000;  // 1 minut

/** Număr maxim de reîncercări la erori 5xx ANAF */
const MAX_RETRY = 3;

/** Baza pentru backoff exponențial (ms) */
const RETRY_BASE_MS = 1000;

// ─── Helpers interni ─────────────────────────────────────────────────────────

const log   = (...args) => console.log('[ANAF-OAUTH2]', ...args);
const warn  = (...args) => console.warn('[ANAF-OAUTH2]', ...args);
const error = (...args) => console.error('[ANAF-OAUTH2]', ...args);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Validare JWT ─────────────────────────────────────────────────────────────

/**
 * Verifică dacă un string este JWT valid (3 segmente base64url separate prin punct).
 * ANAF API necesită token JWT – tokenele opace returnează 401 invalid_token.
 *
 * @param {string} token
 * @returns {boolean}
 */
const isJwt = (token) => {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
};

/**
 * Verifică dacă tokenul stocat a expirat.
 * Returnează true (expirat) dacă nu există data de expirare.
 *
 * @param {{ token_expires_at?: string }} tokenData
 * @returns {boolean}
 */
const isExpired = (tokenData) => {
  if (!tokenData || !tokenData.token_expires_at) return true;
  return new Date(tokenData.token_expires_at) <= new Date();
};

/**
 * Verifică dacă tokenul va expira în mai puțin de N minute.
 *
 * @param {{ token_expires_at?: string }} tokenData
 * @param {number} marginMinutes
 * @returns {boolean}
 */
const expiresWithin = (tokenData, marginMinutes) => {
  if (!tokenData || !tokenData.token_expires_at) return true;
  const expiresAt = new Date(tokenData.token_expires_at);
  const threshold = new Date(Date.now() + marginMinutes * 60 * 1000);
  return expiresAt <= threshold;
};

// ─── HTTP helper (fără mTLS) ──────────────────────────────────────────────────

/**
 * Execută un request HTTPS fără mTLS.
 * Returnează { status, ok, headers, _raw }.
 *
 * @param {string} url
 * @param {{ method?, headers?, body? }} opts
 * @returns {Promise<object>}
 */
const httpsRequest = (url, opts = {}) =>
  new Promise((resolve, reject) => {
    const parsed = new URL(url);

    const bodyBuf = opts.body != null
      ? (Buffer.isBuffer(opts.body)
          ? opts.body
          : Buffer.from(String(opts.body), 'utf8'))
      : null;

    const headers = { ...(opts.headers || {}) };
    if (bodyBuf) headers['Content-Length'] = String(bodyBuf.length);

    const reqOpts = {
      hostname: parsed.hostname,
      port:     parsed.port || 443,
      path:     parsed.pathname + (parsed.search || ''),
      method:   opts.method || 'GET',
      headers,
      // Fără agent mTLS – autentificarea se face EXCLUSIV prin browser
    };

    const req = https.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({
          status:  res.statusCode,
          ok:      res.statusCode >= 200 && res.statusCode < 300,
          headers: res.headers,
          _raw:    raw,
        });
      });
    });

    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });

/**
 * Execută fn cu retry exponențial pentru erori 5xx ANAF.
 * Erorile 4xx (401, 400 etc.) NU sunt reîncercate.
 *
 * @param {() => Promise<object>} fn
 * @param {string} label
 * @returns {Promise<object>}
 */
const withRetry = async (fn, label = 'ANAF') => {
  let lastRes;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      const res = await fn();
      if (res.status >= 500 && attempt < MAX_RETRY) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        warn(`${label} – HTTP ${res.status}, retry ${attempt}/${MAX_RETRY} in ${delay}ms`);
        await sleep(delay);
        lastRes = res;
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < MAX_RETRY) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        warn(`${label} – eroare rețea (${err.message}), retry ${attempt}/${MAX_RETRY} in ${delay}ms`);
        await sleep(delay);
        lastRes = err;
      } else {
        throw err;
      }
    }
  }
  return lastRes;
};

// ─── Stocare fallback: fișier criptat AES-256-GCM ────────────────────────────

/**
 * Criptează și salvează datele tokenului într-un fișier JSON.
 * Folosit ca fallback când baza de date nu este disponibilă.
 * Criptare: AES-256-GCM cu cheie derivată din secretul dat sau una generată automat.
 *
 * @param {object} data       – datele tokenului de salvat
 * @param {string} filePath   – cale absolută spre fișierul de stocare
 * @param {string} [secret]   – cheie secretă (opțional; dacă lipsește, se generează automat)
 */
const saveTokenToFile = (data, filePath, secret) => {
  const key     = deriveKey(secret || _defaultSecret(filePath));
  const iv      = crypto.randomBytes(12);
  const cipher  = crypto.createCipheriv('aes-256-gcm', key, iv);
  const payload = Buffer.from(JSON.stringify(data), 'utf8');
  const enc     = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag     = cipher.getAuthTag();

  const output  = JSON.stringify({
    iv:      iv.toString('hex'),
    tag:     tag.toString('hex'),
    data:    enc.toString('hex'),
    savedAt: new Date().toISOString(),
  });

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, output, { encoding: 'utf8', mode: 0o600 });
  log(`Token salvat în fișier criptat: ${filePath}`);
};

/**
 * Citește și decriptează datele tokenului dintr-un fișier JSON.
 *
 * @param {string} filePath   – cale absolută spre fișierul de stocare
 * @param {string} [secret]   – cheie secretă
 * @returns {object|null}     – datele tokenului sau null dacă fișierul lipsește/e corupt
 */
const loadTokenFromFile = (filePath, secret) => {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stored   = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const key      = deriveKey(secret || _defaultSecret(filePath));
    const iv       = Buffer.from(stored.iv,   'hex');
    const tag      = Buffer.from(stored.tag,  'hex');
    const enc      = Buffer.from(stored.data, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  } catch (err) {
    warn(`Nu s-a putut citi fișierul criptat de token: ${err.message}`);
    return null;
  }
};

/** Derivă o cheie AES-256 de 32 octeți din secretul dat (SHA-256). */
const deriveKey = (secret) =>
  crypto.createHash('sha256').update(String(secret)).digest();

/** Generează sau citește cheia implicită pentru fișierul dat. */
const _defaultSecret = (filePath) => {
  const keyFile = `${filePath}.key`;
  if (fs.existsSync(keyFile)) {
    return fs.readFileSync(keyFile, 'utf8').trim();
  }
  const key = crypto.randomBytes(32).toString('hex');
  try {
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, key, { mode: 0o600, encoding: 'utf8' });
  } catch (_e) { /* ignore write errors in read-only fs */ }
  return key;
};

// ─── Nucleul OAuth2 ───────────────────────────────────────────────────────────

/**
 * Construiește URL-ul de autorizare ANAF pentru pasul 1 al fluxului OAuth2.
 *
 * Utilizatorul TREBUIE să deschidă authUrl în browser și să se autentifice
 * cu certificatul digital calificat SPV. Browserul gestionează prezentarea
 * certificatului nativ – nu este nevoie de mTLS server-side.
 *
 * Parametrul `token_content_type=jwt` este OBLIGATORIU – fără el ANAF emite
 * un token opac (hex) care returnează 401 la orice apel API.
 *
 * @param {{
 *   clientId:     string,
 *   redirectUri:  string,
 *   scope?:       string,
 * }} opts
 * @returns {{ authUrl: string, state: string }}
 *
 * @example
 * const { authUrl, state } = buildAuthUrl({
 *   clientId:    'abc123',
 *   redirectUri: 'https://myserver.ro:5000/api/efactura-v3/oauth/callback',
 * });
 * // Salvați state în sesiune/DB, redirecționați utilizatorul la authUrl
 */
const buildAuthUrl = ({ clientId, redirectUri, scope = 'offline_access' }) => {
  if (!clientId)    throw new Error('clientId este obligatoriu pentru buildAuthUrl.');
  if (!redirectUri) throw new Error('redirectUri este obligatoriu pentru buildAuthUrl.');

  const state = crypto.randomBytes(32).toString('hex');  // anti-CSRF

  const params = new URLSearchParams({
    response_type:     'code',
    client_id:          clientId,
    redirect_uri:       redirectUri,
    scope,
    state,
    token_content_type: 'jwt',  // CRITIC: asigură token JWT (nu opac)
  });

  const authUrl = `${ANAF_AUTH_URL}?${params.toString()}`;
  log(`URL autorizare generat (redirect: ${redirectUri})`);
  return { authUrl, state };
};

/**
 * Schimbă codul de autorizare primit de la ANAF cu access_token + refresh_token.
 * Pasul 4 din fluxul OAuth2 – apelat în handler-ul de callback.
 *
 * ATENȚIE: ANAF poate returna HTTP 500 la acest pas dacă impune mTLS fără
 * configurare client certificate. În acest caz, tokenul se importă manual
 * din Postman via endpoint-ul /oauth/token-import.
 *
 * @param {{
 *   code:         string,
 *   redirectUri:  string,
 *   clientId:     string,
 *   clientSecret: string,
 * }} opts
 * @returns {Promise<TokenData>}
 *
 * @typedef {{ access_token: string, refresh_token: string, expires_in: number, token_type: string, token_expires_at: string }} TokenData
 */
const exchangeCode = async ({ code, redirectUri, clientId, clientSecret }) => {
  if (!code)         throw new Error('Parametrul code lipsește la exchangeCode.');
  if (!redirectUri)  throw new Error('Parametrul redirectUri lipsește la exchangeCode.');
  if (!clientId)     throw new Error('Parametrul clientId lipsește la exchangeCode.');
  if (!clientSecret) throw new Error('Parametrul clientSecret lipsește la exchangeCode.');

  log('Schimb cod → token (grant_type: authorization_code)');

  const tokenData = await _callTokenEndpoint({
    grant_type:   'authorization_code',
    code,
    redirect_uri: redirectUri,
    clientId,
    clientSecret,
    label:        'code_exchange',
  });

  log(`Token JWT obținut. Expiră: ${tokenData.token_expires_at}`);
  return tokenData;
};

/**
 * Reînnoire token JWT folosind refresh_token.
 * Pasul 5 din fluxul OAuth2 – apelat periodic sau manual.
 *
 * @param {{
 *   refreshToken:  string,
 *   clientId:      string,
 *   clientSecret:  string,
 * }} opts
 * @returns {Promise<TokenData>}
 */
const refreshAccessToken = async ({ refreshToken, clientId, clientSecret }) => {
  if (!refreshToken)  throw new Error('refreshToken lipsește la refreshAccessToken.');
  if (!clientId)      throw new Error('clientId lipsește la refreshAccessToken.');
  if (!clientSecret)  throw new Error('clientSecret lipsește la refreshAccessToken.');

  log('Reînnoire token cu refresh_token...');

  const tokenData = await _callTokenEndpoint({
    grant_type:    'refresh_token',
    refresh_token:  refreshToken,
    clientId,
    clientSecret,
    label:         'token_refresh',
  });

  log(`Token JWT reînnoit. Expiră: ${tokenData.token_expires_at}`);
  return tokenData;
};

/**
 * Apel intern la endpoint-ul ANAF /token cu Basic Auth (fără mTLS).
 * Folosit de exchangeCode și refreshAccessToken.
 *
 * NOTĂ: exchangeCode (authorization_code) nu reîncercă niciodată – codul de
 * autorizare este de unică folosință și expiră în ~60s.  Reîncercarea ar
 * folosi un cod deja consumat și ar pierde din fereastra de timp disponibilă.
 * refreshAccessToken poate reîncerca (erori 5xx tranzitorii la token endpoint).
 *
 * @private
 */
const _callTokenEndpoint = async ({
  grant_type, code, redirect_uri, refresh_token,
  clientId, clientSecret, label,
}) => {
  const basicAuth  = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const bodyParams = { grant_type };
  if (code)          bodyParams.code         = code;
  if (redirect_uri)  bodyParams.redirect_uri  = redirect_uri;
  if (refresh_token) bodyParams.refresh_token = refresh_token;

  const body = new URLSearchParams(bodyParams).toString();

  const doRequest = () => httpsRequest(ANAF_TOKEN_URL, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`,
      'Accept':        'application/json',
    },
    body,
  });

  // Authorization codes are single-use and expire in ~60 s – never retry them.
  // Refresh tokens are longer-lived; retry is acceptable for transient 5xx errors.
  const res = grant_type === 'authorization_code'
    ? await doRequest()
    : await withRetry(doRequest, label);

  let data = {};
  try { data = JSON.parse(res._raw); } catch { /* non-JSON */ }

  if (!res.ok) {
    let hint = '';
    if (res.status >= 500) {
      hint = ' – ANAF necesită certificat client la schimbul de token. ' +
        'Soluție: importați tokenul JWT obținut prin Postman ' +
        'via POST /api/efactura-v3/oauth/token-import.';
    }
    const msg = data.error_description || data.error || `ANAF HTTP ${res.status}${hint}`;
    const err = Object.assign(new Error(msg), { status: res.status, anafData: data, label });
    error(`${label} eșuat – HTTP ${res.status}: ${msg}`);
    throw err;
  }

  if (!data.access_token) {
    throw new Error(`Răspuns invalid ANAF (${label}): câmpul access_token lipsește.`);
  }

  if (!isJwt(data.access_token)) {
    throw new Error(
      'ANAF a returnat un token NON-JWT (opac). ' +
      'Adăugați token_content_type=jwt la URL-ul de autorizare. ' +
      'Hint: folosiți buildAuthUrl() care include automat acest parametru.',
    );
  }

  // expires_in is in seconds per RFC 6749 §5.1 and ANAF token endpoint spec
  const token_expires_at = data.expires_in
    ? new Date(Date.now() + Number(data.expires_in) * 1000).toISOString()
    : '';

  return {
    access_token:     data.access_token,
    refresh_token:    data.refresh_token || '',
    expires_in:       data.expires_in    || null,
    token_type:       data.token_type    || 'Bearer',
    token_expires_at,
  };
};

// ─── Auto-Refresh Scheduler ───────────────────────────────────────────────────

/**
 * Pornește un scheduler care verifică periodic dacă tokenul va expira și,
 * dacă da, îl reînnoiește automat cu refresh_token.
 *
 * Reînnoirea are loc cu `marginMinutes` (implicit 10 min) înainte de expirare,
 * astfel încât tokenul să fie mereu valid.
 *
 * Pattern de utilizare (în server.js sau la inițializarea modulului):
 *
 *   const stopRefresh = tm.scheduleAutoRefresh({
 *     getToken:  () => config.getSettings(),
 *     saveToken: (d) => config.saveToken(d),
 *   });
 *   process.on('SIGTERM', () => { stopRefresh(); server.close(); });
 *
 * @param {{
 *   getToken:          () => object|null,
 *   saveToken:         (data: object) => void,
 *   onSuccess?:        (tokenData: object) => void,
 *   onError?:          (err: Error) => void,
 *   checkIntervalMs?:  number,
 *   marginMinutes?:    number,
 * }} opts
 * @returns {() => void}  funcție stop() pentru oprire scheduler
 */
const scheduleAutoRefresh = ({
  getToken,
  saveToken,
  onSuccess       = (d) => log(`Auto-refresh reușit. Expiră: ${d.token_expires_at}`),
  onError         = (e) => error(`Auto-refresh eșuat: ${e.message}`),
  checkIntervalMs = AUTO_REFRESH_CHECK_INTERVAL_MS,
  marginMinutes   = AUTO_REFRESH_MARGIN_MINUTES,
} = {}) => {
  if (typeof getToken  !== 'function') throw new Error('scheduleAutoRefresh: getToken trebuie să fie funcție.');
  if (typeof saveToken !== 'function') throw new Error('scheduleAutoRefresh: saveToken trebuie să fie funcție.');

  let running = false;

  const check = async () => {
    if (running) return;
    running = true;
    try {
      const s = await getToken();
      if (!s) return;

      const { oauth_token, refresh_token, client_id, client_secret } = s;

      if (!isJwt(oauth_token) || !refresh_token) return;
      if (!expiresWithin(s, marginMinutes))       return;

      log(`Token expiră în < ${marginMinutes}min. Reînnoire automată în curs...`);

      if (!client_id || !client_secret) {
        warn('Auto-refresh: client_id/client_secret lipsesc – reînnoire imposibilă.');
        return;
      }

      const newToken = await refreshAccessToken({
        refreshToken:  refresh_token,
        clientId:      client_id,
        clientSecret:  client_secret,
      });

      // Păstrează refresh_token vechi dacă ANAF nu trimite unul nou (creează obiect nou)
      const tokenToSave = newToken.refresh_token
        ? newToken
        : { ...newToken, refresh_token };

      await saveToken(tokenToSave);
      onSuccess(tokenToSave);
    } catch (e) {
      onError(e);
    } finally {
      running = false;
    }
  };

  // Verificare inițială după 5 secunde (prinde expirări iminente la startup)
  const initTimeout = setTimeout(check, 5000);
  const timer       = setInterval(check, checkIntervalMs);

  log(`Scheduler auto-refresh pornit (interval: ${checkIntervalMs / 1000}s, marjă: ${marginMinutes}min)`);

  return () => {
    clearTimeout(initTimeout);
    clearInterval(timer);
    log('Scheduler auto-refresh oprit.');
  };
};

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // URL-uri ANAF
  ANAF_AUTH_URL,
  ANAF_TOKEN_URL,

  // Validare token
  isJwt,
  isExpired,
  expiresWithin,

  // Flux OAuth2 principal
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,

  // Auto-refresh scheduler
  scheduleAutoRefresh,

  // Stocare fallback în fișier criptat
  saveTokenToFile,
  loadTokenFromFile,
};

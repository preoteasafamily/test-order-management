'use strict';

/**
 * SPV v3 – ANAF HTTP Client
 * ==========================
 * Wraps Node.js `https` module so we have full control over:
 *   - mTLS (Mutual TLS) – required by ANAF logincert.anaf.ro for token exchange
 *   - Retry with exponential backoff for transient 5xx errors
 *   - Consistent response shape { status, ok, headers, text(), json(), _raw }
 *
 * Environment variables:
 *   ANAF_CERT_PATH        – absolute path to client certificate (PEM)
 *   ANAF_KEY_PATH         – absolute path to private key (PEM)
 *   ANAF_CERT_PASSPHRASE  – optional passphrase for encrypted key
 */

const https = require('https');
const fs    = require('fs');

const MAX_RETRY     = 3;
const RETRY_BASE_MS = 1000;

// ─── mTLS Agent (lazy, cached) ────────────────────────────────────────────────

let _mtlsAgent      = null;
let _mtlsWarnLogged = false;

/**
 * Returns an https.Agent configured with ANAF client certificate for mTLS.
 * Lazy-initialised and cached across calls.
 * Returns null if ANAF_CERT_PATH / ANAF_KEY_PATH are not set.
 */
const getMtlsAgent = () => {
  if (_mtlsAgent !== null) return _mtlsAgent;

  const certPath   = process.env.ANAF_CERT_PATH;
  const keyPath    = process.env.ANAF_KEY_PATH;
  const passphrase = process.env.ANAF_CERT_PASSPHRASE || undefined;

  if (!certPath || !keyPath) {
    if (!_mtlsWarnLogged) {
      console.warn(
        '[SPV-V3] ⚠ mTLS not configured – ANAF_CERT_PATH / ANAF_KEY_PATH missing.\n' +
        '         Token exchange will fail (HTTP 500) without a qualified digital certificate.\n' +
        '         Add to server/.env:\n' +
        '           ANAF_CERT_PATH=/absolute/path/to/cert.pem\n' +
        '           ANAF_KEY_PATH=/absolute/path/to/key.pem',
      );
      _mtlsWarnLogged = true;
    }
    return null;
  }

  try {
    const agentOpts = {
      cert: fs.readFileSync(certPath),
      key:  fs.readFileSync(keyPath),
    };
    if (passphrase) agentOpts.passphrase = passphrase;
    _mtlsAgent = new https.Agent(agentOpts);
    console.log('[SPV-V3] ✓ mTLS certificate loaded successfully.');
  } catch (err) {
    console.error(`[SPV-V3] ✗ Failed to load mTLS certificates: ${err.message}`);
    _mtlsAgent = null;
  }

  return _mtlsAgent;
};

/** True if mTLS is configured (certificates exist and are readable). */
const isMtlsConfigured = () => {
  const certPath = process.env.ANAF_CERT_PATH;
  const keyPath  = process.env.ANAF_KEY_PATH;
  if (!certPath || !keyPath) return false;
  try {
    fs.accessSync(certPath, fs.constants.R_OK);
    fs.accessSync(keyPath,  fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

// ─── Core HTTP helper ─────────────────────────────────────────────────────────

/**
 * Execute an HTTPS request.
 * Returns a Promise that resolves to { status, ok, headers, text(), json(), _raw }.
 *
 * @param {string} url
 * @param {{ method?, headers?, body?, useMtls? }} opts
 * @returns {Promise<object>}
 */
const request = (url, opts = {}) =>
  new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const agent  = opts.useMtls ? getMtlsAgent() : undefined;

    // Buffer the body and set Content-Length to avoid chunked transfer encoding.
    const bodyBuf = opts.body != null
      ? (Buffer.isBuffer(opts.body)
          ? opts.body
          : Buffer.from(String(opts.body), 'utf8'))
      : null;

    const headers = { ...(opts.headers || {}) };
    if (bodyBuf) headers['Content-Length'] = String(bodyBuf.length);

    const reqOpts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ''),
      method:   opts.method || 'GET',
      headers,
      agent,
    };

    const req = https.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve({
          status:  res.statusCode,
          ok:      res.statusCode >= 200 && res.statusCode < 300,
          headers: res.headers,
          _raw:    raw,
          text:    () => Promise.resolve(raw),
          json:    () => {
            try   { return Promise.resolve(JSON.parse(raw)); }
            catch (_e) { return Promise.reject(new SyntaxError(`Non-JSON from ANAF: ${raw.substring(0, 200)}`)); }
          },
        });
      });
    });

    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });

// ─── Retry wrapper ────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Execute `fn` (async, returns a request Promise) with exponential-backoff
 * retry on transient 5xx errors.  4xx errors are NOT retried.
 *
 * @param {() => Promise<object>} fn
 * @param {string} label – for logging
 * @returns {Promise<object>}
 */
const withRetry = async (fn, label = 'ANAF') => {
  let lastErr;
  for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
    try {
      const res = await fn();
      if (res.status >= 500 && attempt < MAX_RETRY) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.warn(`[SPV-V3] ${label} – HTTP ${res.status}, retry ${attempt}/${MAX_RETRY} in ${delay}ms`);
        await sleep(delay);
        lastErr = res;
        continue;
      }
      return res;
    } catch (err) {
      if (attempt < MAX_RETRY) {
        const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1);
        console.warn(`[SPV-V3] ${label} – network error (${err.message}), retry ${attempt}/${MAX_RETRY} in ${delay}ms`);
        await sleep(delay);
        lastErr = err;
      } else {
        throw err;
      }
    }
  }
  return lastErr;
};

module.exports = { request, withRetry, getMtlsAgent, isMtlsConfigured, sleep };

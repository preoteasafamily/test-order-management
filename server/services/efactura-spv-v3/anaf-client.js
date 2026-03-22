'use strict';

/**
 * SPV v3 – ANAF HTTP Client
 * ==========================
 * Wraps Node.js `https` module so we have full control over:
 *   - Retry with exponential backoff for transient 5xx errors
 *   - Consistent response shape { status, ok, headers, text(), json(), _raw }
 *
 * Authentication is performed exclusively via browser OAuth2 flow.
 * mTLS is NOT used – the private key from a USB token cannot be extracted
 * and must never be configured server-side.
 */

const https = require('https');

const MAX_RETRY     = 3;
const RETRY_BASE_MS = 1000;

// ─── Core HTTP helper ─────────────────────────────────────────────────────────

/**
 * Execute an HTTPS request.
 * Returns a Promise that resolves to { status, ok, headers, text(), json(), _raw }.
 *
 * @param {string} url
 * @param {{ method?, headers?, body? }} opts
 * @returns {Promise<object>}
 */
const request = (url, opts = {}) =>
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
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + (parsed.search || ''),
      method:   opts.method || 'GET',
      headers,
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

module.exports = { request, withRetry, sleep };

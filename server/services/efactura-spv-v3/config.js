'use strict';

/**
 * SPV v3 – Configuration Service
 * ================================
 * Reads / writes SPV v3 settings from the database (spv_v3_settings table).
 * Single-row table (id = 1). All helpers here are synchronous (better-sqlite3).
 */

const db = require('../../database');

// ─── Readers ─────────────────────────────────────────────────────────────────

/**
 * Return the single-row settings record.
 * @returns {object}
 */
const getSettings = () =>
  db.prepare('SELECT * FROM spv_v3_settings WHERE id = 1').get();

/**
 * Determine the ANAF API base URL from current environment setting.
 * @param {object} s – settings row
 * @returns {string}
 */
const getApiBase = (s) =>
  s.environment === 'prod'
    ? 'https://api.anaf.ro/prod/FCTEL/rest'
    : 'https://api.anaf.ro/test/FCTEL/rest';

/**
 * Build the OAuth2 redirect_uri to use.
 * Prefers public_callback_url if set; falls back to redirect_uri field.
 * Appends /api/efactura-v3/oauth/callback.
 * @param {object} s – settings row
 * @returns {string}
 */
const getRedirectUri = (s) => {
  const base = (s.public_callback_url || s.redirect_uri || '').replace(/\/$/, '');
  if (!base) return '';
  return `${base}/api/efactura-v3/oauth/callback`;
};

/**
 * True if the stored token looks like a JWT (3 base64 segments separated by dots).
 * @param {string} token
 * @returns {boolean}
 */
const isJwt = (token) => {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
};

/**
 * True if the token expiry stored in settings is in the past.
 * Returns true (expired) if no expiry recorded.
 * @param {object} s – settings row
 * @returns {boolean}
 */
const isTokenExpired = (s) => {
  if (!s.token_expires_at) return true;
  return new Date(s.token_expires_at) <= new Date();
};

/**
 * True if the module has a valid, non-expired JWT token.
 * @returns {boolean}
 */
const hasValidToken = () => {
  const s = getSettings();
  return isJwt(s.oauth_token) && !isTokenExpired(s);
};

// ─── Writers ─────────────────────────────────────────────────────────────────

/**
 * Save configuration fields to the settings row.
 * Only the supplied fields are updated; unrecognised keys are ignored.
 * @param {object} fields
 */
const updateSettings = (fields) => {
  const allowed = [
    'cif', 'environment', 'client_id', 'client_secret',
    'redirect_uri', 'public_callback_url',
    'oauth_token', 'refresh_token', 'token_expires_at',
    'oauth_state', 'oauth_redirect_uri_used',
    'last_action', 'last_action_at',
  ];
  const updates = Object.entries(fields)
    .filter(([k]) => allowed.includes(k))
    .map(([k]) => `${k} = @${k}`)
    .join(', ');
  if (!updates) return;
  db.prepare(
    `UPDATE spv_v3_settings SET ${updates}, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
  ).run(fields);
};

/**
 * Persist a received token payload (from ANAF /token response).
 * @param {{ access_token, refresh_token?, expires_in? }} tokenData
 * @param {boolean} keepRefreshIfMissing – keep old refresh_token when new one absent
 */
const saveToken = (tokenData, keepRefreshIfMissing = false) => {
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
    : '';

  const s = getSettings();
  updateSettings({
    oauth_token:      tokenData.access_token || '',
    refresh_token:    tokenData.refresh_token
      || (keepRefreshIfMissing ? s.refresh_token : ''),
    token_expires_at: expiresAt,
    last_action:      'token_saved',
    last_action_at:   new Date().toISOString(),
  });
};

// ─── Action Log ──────────────────────────────────────────────────────────────

/**
 * Append an entry to spv_v3_action_log.
 * @param {string} action
 * @param {object|null} details – JSON-serialisable
 * @param {boolean} success
 * @param {Error|string|null} err
 */
const logAction = (action, details = null, success = true, err = null) => {
  try {
    db.prepare(
      `INSERT INTO spv_v3_action_log (action, details, success, error_message)
       VALUES (@action, @details, @success, @error_message)`,
    ).run({
      action,
      details: details ? JSON.stringify(details) : null,
      success: success ? 1 : 0,
      error_message: err
        ? (err instanceof Error ? err.message : String(err))
        : null,
    });
  } catch (logErr) {
    console.error('[SPV-V3] Failed to write action log:', logErr.message);
  }
};

module.exports = {
  getSettings,
  getApiBase,
  getRedirectUri,
  isJwt,
  isTokenExpired,
  hasValidToken,
  updateSettings,
  saveToken,
  logAction,
};

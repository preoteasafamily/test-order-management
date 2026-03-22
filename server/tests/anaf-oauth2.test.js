'use strict';

/**
 * ANAF OAuth2 Token Manager – Unit Tests
 * =======================================
 * Teste pentru services/anaf-oauth2/token-manager.js
 *
 * Rulare: node server/tests/anaf-oauth2.test.js
 *         (sau via: npm run test:oauth2)
 */

const assert = require('assert');
const path   = require('path');
const os     = require('os');
const fs     = require('fs');

const tm = require('../services/anaf-oauth2/token-manager');

// ─── Test utilities ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

// ─── Exports check ────────────────────────────────────────────────────────────

console.log('\n═══ token-manager exports ══════════════════════════════════');

test('module exports ANAF_AUTH_URL', () => {
  assert.ok(tm.ANAF_AUTH_URL.includes('logincert.anaf.ro'), 'ANAF_AUTH_URL invalid');
});

test('module exports ANAF_TOKEN_URL', () => {
  assert.ok(tm.ANAF_TOKEN_URL.includes('logincert.anaf.ro'), 'ANAF_TOKEN_URL invalid');
});

test('module exports isJwt function', () => {
  assert.strictEqual(typeof tm.isJwt, 'function');
});

test('module exports isExpired function', () => {
  assert.strictEqual(typeof tm.isExpired, 'function');
});

test('module exports expiresWithin function', () => {
  assert.strictEqual(typeof tm.expiresWithin, 'function');
});

test('module exports buildAuthUrl function', () => {
  assert.strictEqual(typeof tm.buildAuthUrl, 'function');
});

test('module exports exchangeCode function', () => {
  assert.strictEqual(typeof tm.exchangeCode, 'function');
});

test('module exports refreshAccessToken function', () => {
  assert.strictEqual(typeof tm.refreshAccessToken, 'function');
});

test('module exports scheduleAutoRefresh function', () => {
  assert.strictEqual(typeof tm.scheduleAutoRefresh, 'function');
});

test('module exports saveTokenToFile function', () => {
  assert.strictEqual(typeof tm.saveTokenToFile, 'function');
});

test('module exports loadTokenFromFile function', () => {
  assert.strictEqual(typeof tm.loadTokenFromFile, 'function');
});

test('module does NOT export mTLS functions', () => {
  assert.strictEqual(tm.getMtlsAgent,    undefined, 'getMtlsAgent must not be exported');
  assert.strictEqual(tm.isMtlsConfigured, undefined, 'isMtlsConfigured must not be exported');
  assert.strictEqual(tm.mtlsAgent,       undefined, 'mtlsAgent must not be exported');
});

// ─── isJwt tests ─────────────────────────────────────────────────────────────

console.log('\n═══ isJwt ══════════════════════════════════════════════════');

test('isJwt – valid JWT returns true', () => {
  assert.strictEqual(tm.isJwt('eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.SflKx'), true);
});

test('isJwt – opaque hex token returns false', () => {
  assert.strictEqual(tm.isJwt('f7584c01843b44ef373abe83855c53b15357d3bd'), false);
});

test('isJwt – empty string returns false', () => {
  assert.strictEqual(tm.isJwt(''), false);
});

test('isJwt – null returns false', () => {
  assert.strictEqual(tm.isJwt(null), false);
});

test('isJwt – undefined returns false', () => {
  assert.strictEqual(tm.isJwt(undefined), false);
});

test('isJwt – 2-segment string returns false', () => {
  assert.strictEqual(tm.isJwt('header.payload'), false);
});

test('isJwt – 4-segment string returns false', () => {
  assert.strictEqual(tm.isJwt('a.b.c.d'), false);
});

test('isJwt – aaa.bbb.ccc returns true', () => {
  assert.strictEqual(tm.isJwt('aaa.bbb.ccc'), true);
});

// ─── isExpired tests ──────────────────────────────────────────────────────────

console.log('\n═══ isExpired ══════════════════════════════════════════════');

test('isExpired – null tokenData returns true', () => {
  assert.strictEqual(tm.isExpired(null), true);
});

test('isExpired – missing token_expires_at returns true', () => {
  assert.strictEqual(tm.isExpired({}), true);
  assert.strictEqual(tm.isExpired({ token_expires_at: '' }), true);
});

test('isExpired – past date returns true', () => {
  assert.strictEqual(tm.isExpired({ token_expires_at: '2020-01-01T00:00:00.000Z' }), true);
});

test('isExpired – future date returns false', () => {
  const future = new Date(Date.now() + 3600 * 1000).toISOString();
  assert.strictEqual(tm.isExpired({ token_expires_at: future }), false);
});

// ─── expiresWithin tests ──────────────────────────────────────────────────────

console.log('\n═══ expiresWithin ══════════════════════════════════════════');

test('expiresWithin – null returns true', () => {
  assert.strictEqual(tm.expiresWithin(null, 10), true);
});

test('expiresWithin – token expiring in 5 min, margin 10 min → true', () => {
  const soonExpiry = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  assert.strictEqual(tm.expiresWithin({ token_expires_at: soonExpiry }, 10), true);
});

test('expiresWithin – token expiring in 20 min, margin 10 min → false', () => {
  const laterExpiry = new Date(Date.now() + 20 * 60 * 1000).toISOString();
  assert.strictEqual(tm.expiresWithin({ token_expires_at: laterExpiry }, 10), false);
});

test('expiresWithin – expired token (past) returns true', () => {
  assert.strictEqual(tm.expiresWithin({ token_expires_at: '2020-01-01T00:00:00.000Z' }, 10), true);
});

// ─── buildAuthUrl tests ───────────────────────────────────────────────────────

console.log('\n═══ buildAuthUrl ════════════════════════════════════════════');

test('buildAuthUrl – returns authUrl and state', () => {
  const { authUrl, state } = tm.buildAuthUrl({
    clientId:    'test-client-id',
    redirectUri: 'https://myserver.ro:5000/api/efactura-v3/oauth/callback',
  });
  assert.ok(typeof authUrl === 'string', 'authUrl should be string');
  assert.ok(typeof state  === 'string', 'state should be string');
  assert.ok(state.length >= 64,          'state should be 32+ hex chars');
});

test('buildAuthUrl – includes token_content_type=jwt', () => {
  const { authUrl } = tm.buildAuthUrl({
    clientId:    'test-id',
    redirectUri: 'https://server.ro/callback',
  });
  assert.ok(authUrl.includes('token_content_type=jwt'), 'token_content_type=jwt must be present');
});

test('buildAuthUrl – includes client_id', () => {
  const { authUrl } = tm.buildAuthUrl({
    clientId:    'my-client-123',
    redirectUri: 'https://server.ro/callback',
  });
  assert.ok(authUrl.includes('client_id=my-client-123'), 'client_id must be in URL');
});

test('buildAuthUrl – includes response_type=code', () => {
  const { authUrl } = tm.buildAuthUrl({
    clientId:    'test',
    redirectUri: 'https://server.ro/callback',
  });
  assert.ok(authUrl.includes('response_type=code'), 'response_type=code must be present');
});

test('buildAuthUrl – includes scope=offline_access by default', () => {
  const { authUrl } = tm.buildAuthUrl({
    clientId:    'test',
    redirectUri: 'https://server.ro/callback',
  });
  assert.ok(authUrl.includes('scope=offline_access'), 'scope=offline_access must be present');
});

test('buildAuthUrl – includes state in URL', () => {
  const { authUrl, state } = tm.buildAuthUrl({
    clientId:    'test',
    redirectUri: 'https://server.ro/callback',
  });
  assert.ok(authUrl.includes(`state=${state}`), 'state must be in URL');
});

test('buildAuthUrl – URL starts with ANAF auth URL', () => {
  const { authUrl } = tm.buildAuthUrl({
    clientId:    'test',
    redirectUri: 'https://server.ro/callback',
  });
  assert.ok(authUrl.startsWith(tm.ANAF_AUTH_URL), 'authUrl should start with ANAF auth URL');
});

test('buildAuthUrl – throws if clientId missing', () => {
  assert.throws(
    () => tm.buildAuthUrl({ redirectUri: 'https://server.ro/callback' }),
    /clientId/,
  );
});

test('buildAuthUrl – throws if redirectUri missing', () => {
  assert.throws(
    () => tm.buildAuthUrl({ clientId: 'test' }),
    /redirectUri/,
  );
});

test('buildAuthUrl – each call generates unique state', () => {
  const { state: s1 } = tm.buildAuthUrl({ clientId: 'c', redirectUri: 'https://r.ro' });
  const { state: s2 } = tm.buildAuthUrl({ clientId: 'c', redirectUri: 'https://r.ro' });
  assert.notStrictEqual(s1, s2, 'Each call should generate unique state');
});

// ─── exchangeCode / refreshAccessToken – parameter validation ─────────────────

console.log('\n═══ exchangeCode parameter validation ═══════════════════════');

testAsync('exchangeCode – throws if code missing', async () => {
  await assert.rejects(
    () => tm.exchangeCode({ redirectUri: 'https://r.ro', clientId: 'c', clientSecret: 's' }),
    /code/,
  );
});

testAsync('exchangeCode – throws if redirectUri missing', async () => {
  await assert.rejects(
    () => tm.exchangeCode({ code: 'abc', clientId: 'c', clientSecret: 's' }),
    /redirectUri/,
  );
});

testAsync('exchangeCode – throws if clientId missing', async () => {
  await assert.rejects(
    () => tm.exchangeCode({ code: 'abc', redirectUri: 'https://r.ro', clientSecret: 's' }),
    /clientId/,
  );
});

testAsync('exchangeCode – throws if clientSecret missing', async () => {
  await assert.rejects(
    () => tm.exchangeCode({ code: 'abc', redirectUri: 'https://r.ro', clientId: 'c' }),
    /clientSecret/,
  );
});

testAsync('refreshAccessToken – throws if refreshToken missing', async () => {
  await assert.rejects(
    () => tm.refreshAccessToken({ clientId: 'c', clientSecret: 's' }),
    /refreshToken/,
  );
});

testAsync('refreshAccessToken – throws if clientId missing', async () => {
  await assert.rejects(
    () => tm.refreshAccessToken({ refreshToken: 'rt', clientSecret: 's' }),
    /clientId/,
  );
});

testAsync('refreshAccessToken – throws if clientSecret missing', async () => {
  await assert.rejects(
    () => tm.refreshAccessToken({ refreshToken: 'rt', clientId: 'c' }),
    /clientSecret/,
  );
});

// ─── scheduleAutoRefresh validation ──────────────────────────────────────────

console.log('\n═══ scheduleAutoRefresh ════════════════════════════════════');

test('scheduleAutoRefresh – throws if getToken is not a function', () => {
  assert.throws(
    () => tm.scheduleAutoRefresh({ getToken: 'not-a-fn', saveToken: () => {} }),
    /getToken/,
  );
});

test('scheduleAutoRefresh – throws if saveToken is not a function', () => {
  assert.throws(
    () => tm.scheduleAutoRefresh({ getToken: () => {}, saveToken: 'not-a-fn' }),
    /saveToken/,
  );
});

test('scheduleAutoRefresh – returns stop function', () => {
  const stop = tm.scheduleAutoRefresh({
    getToken:  () => null,
    saveToken: () => {},
  });
  assert.strictEqual(typeof stop, 'function', 'stop should be a function');
  stop();  // cleanup
});

test('scheduleAutoRefresh – stop function can be called multiple times', () => {
  const stop = tm.scheduleAutoRefresh({
    getToken:  () => null,
    saveToken: () => {},
  });
  assert.doesNotThrow(() => {
    stop();
    stop();
  });
});

// ─── Encrypted file storage ───────────────────────────────────────────────────

console.log('\n═══ saveTokenToFile / loadTokenFromFile ═════════════════════');

test('saveTokenToFile + loadTokenFromFile – roundtrip works', () => {
  const tmpFile = path.join(os.tmpdir(), `anaf-token-test-${Date.now()}.json`);
  const secret  = 'test-secret-key-12345678901234567890';

  const originalData = {
    access_token:     'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.SflKx',
    refresh_token:    'refresh-token-value',
    token_expires_at: '2026-01-01T12:00:00.000Z',
    expires_in:       3600,
  };

  tm.saveTokenToFile(originalData, tmpFile, secret);
  assert.ok(fs.existsSync(tmpFile), 'File should be created');

  const loaded = tm.loadTokenFromFile(tmpFile, secret);
  assert.deepStrictEqual(loaded, originalData, 'Loaded data should match original');

  fs.unlinkSync(tmpFile);
  try { fs.unlinkSync(`${tmpFile}.key`); } catch (_) {}
});

test('loadTokenFromFile – returns null for nonexistent file', () => {
  const result = tm.loadTokenFromFile('/tmp/nonexistent-anaf-token-xyz.json', 'secret');
  assert.strictEqual(result, null);
});

test('saveTokenToFile – creates file with mode 0o600', () => {
  const tmpFile = path.join(os.tmpdir(), `anaf-token-mode-test-${Date.now()}.json`);
  const secret  = 'test-secret';
  tm.saveTokenToFile({ access_token: 'aaa.bbb.ccc', refresh_token: 'rt' }, tmpFile, secret);

  const stats = fs.statSync(tmpFile);
  // On non-Windows, check permissions
  if (process.platform !== 'win32') {
    const mode = stats.mode & 0o777;
    assert.strictEqual(mode, 0o600, `File mode should be 0o600, got 0o${mode.toString(8)}`);
  }

  fs.unlinkSync(tmpFile);
  try { fs.unlinkSync(`${tmpFile}.key`); } catch (_) {}
});

test('loadTokenFromFile – wrong secret returns null (auth tag mismatch)', () => {
  const tmpFile = path.join(os.tmpdir(), `anaf-token-wrong-secret-${Date.now()}.json`);
  tm.saveTokenToFile({ access_token: 'aaa.bbb.ccc' }, tmpFile, 'correct-secret');
  const result = tm.loadTokenFromFile(tmpFile, 'wrong-secret');
  assert.strictEqual(result, null, 'Wrong secret should return null');

  fs.unlinkSync(tmpFile);
  try { fs.unlinkSync(`${tmpFile}.key`); } catch (_) {}
});

// ─── Summary ─────────────────────────────────────────────────────────────────

(async () => {
  // Wait for all async tests to complete
  await new Promise((r) => setTimeout(r, 100));

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('✅ All tests passed!\n');
  }
})();

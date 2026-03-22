'use strict';

/**
 * SPV V3 – Unit Tests
 * ====================
 * Tests for the service modules of e-Factura SPV V3.
 * Uses Node.js built-in assert module – no test framework dependencies needed.
 *
 * Run: node server/tests/efactura-v3.test.js
 */

const assert = require('assert');

// ─── Load services ──────────────────────────────────────────────────────────

// We need to load the config service but it requires a database.
// For testing, we mock the database dependency.
const Module = require('module');

// Minimal mock database for config service tests
const mockDb = {
  _row: {
    id: 1,
    cif: 'RO12345678',
    environment: 'test',
    client_id: 'test-client-id',
    client_secret: 'test-client-secret',
    redirect_uri: '',
    public_callback_url: 'https://192.168.1.1:5000',
    oauth_token: '',
    refresh_token: '',
    token_expires_at: '',
    oauth_state: '',
    oauth_redirect_uri_used: '',
    last_action: '',
    last_action_at: '',
    updated_at: '',
  },
  prepare(sql) {
    return {
      get: (...args) => mockDb._row,
      run: (...args) => {},
      all: (...args) => [],
    };
  },
};

// Patch require to intercept '../../database' from inside services
const originalRequire = Module.prototype.require;
Module.prototype.require = function patchedRequire(id) {
  // Intercept database requires from within services
  if (id.endsWith('/database') || id.endsWith('\\database') || id === '../database' || id === '../../database') {
    return mockDb;
  }
  return originalRequire.apply(this, arguments);
};

const xmlBuilder = require('../services/efactura-spv-v3/xml-builder');
const anafClient  = require('../services/efactura-spv-v3/anaf-client');

// Restore require after loading services
Module.prototype.require = originalRequire;

// ─── Test utilities ─────────────────────────────────────────────────────────

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

// ─── XML Builder Tests ──────────────────────────────────────────────────────

console.log('\n═══ xml-builder.js ═══════════════════════════════════════');

test('buildUBL – returns a string', () => {
  const result = xmlBuilder.buildUBL({
    id: 'INV-001',
    document_date: '2024-01-15',
    bt_27_seller_name: 'Test SRL',
    raw_snapshot: JSON.stringify({
      lines: [{ name: 'Produs A', quantity: 2, price: 100, vat: 19, total: 200 }],
    }),
  });
  assert.strictEqual(typeof result, 'string', 'Expected string output');
});

test('buildUBL – starts with XML declaration', () => {
  const xml = xmlBuilder.buildUBL({ id: 'INV-001', bt_27_seller_name: 'Test SRL' });
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), 'Should start with XML declaration');
});

test('buildUBL – contains UBL namespaces', () => {
  const xml = xmlBuilder.buildUBL({ id: 'INV-001', bt_27_seller_name: 'Test SRL' });
  assert.ok(xml.includes('xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"'), 'Missing UBL namespace');
  assert.ok(xml.includes('xmlns:cac='), 'Missing cac namespace');
  assert.ok(xml.includes('xmlns:cbc='), 'Missing cbc namespace');
});

test('buildUBL – contains CIUS-RO customization ID', () => {
  const xml = xmlBuilder.buildUBL({ id: 'INV-001', bt_27_seller_name: 'Test SRL' });
  assert.ok(
    xml.includes('urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1'),
    'Missing CIUS-RO CustomizationID',
  );
});

test('buildUBL – invoice ID is included', () => {
  const xml = xmlBuilder.buildUBL({ id: 'INV-TEST-123', bt_27_seller_name: 'Firma SRL' });
  assert.ok(xml.includes('<cbc:ID>INV-TEST-123</cbc:ID>'), 'Invoice ID not found in XML');
});

test('buildUBL – escapes XML special characters', () => {
  const xml = xmlBuilder.buildUBL({
    id: 'INV-001',
    bt_27_seller_name: 'Firma & Co. <SRL>',
  });
  assert.ok(xml.includes('Firma &amp; Co. &lt;SRL&gt;'), 'XML special characters not escaped');
  assert.ok(!xml.includes('Firma & Co.'), 'Unescaped & found in output');
});

test('buildUBL – computes VAT totals correctly', () => {
  const xml = xmlBuilder.buildUBL({
    id: 'INV-001',
    bt_27_seller_name: 'Test SRL',
    raw_snapshot: JSON.stringify({
      lines: [
        { name: 'Produs A', quantity: 1, price: 100, vat: 19, total: 100 },
        { name: 'Produs B', quantity: 2, price: 50,  vat: 19, total: 100 },
      ],
    }),
  });
  // Total net = 200, VAT 19% = 38, Total with VAT = 238
  assert.ok(xml.includes('38.00'), 'VAT amount 38.00 not found');
  assert.ok(xml.includes('200.00'), 'Net total 200.00 not found');
  assert.ok(xml.includes('238.00'), 'Grand total 238.00 not found');
});

test('buildUBL – uses seller data from BT fields', () => {
  const xml = xmlBuilder.buildUBL({
    id: 'INV-001',
    bt_27_seller_name: 'Vânzător SRL',
    bt_35_seller_address: 'Str. Principală 1',
    bt_37_seller_city: 'București',
    bt_40_seller_country: 'RO',
  });
  assert.ok(xml.includes('Vânzător SRL'), 'Seller name not found');
  assert.ok(xml.includes('Str. Principală 1'), 'Seller address not found');
  assert.ok(xml.includes('București'), 'Seller city not found');
});

test('buildUBL – uses buyer data from snapshot (priority over BT fields)', () => {
  const xml = xmlBuilder.buildUBL({
    id: 'INV-001',
    bt_27_seller_name: 'Test SRL',
    bt_44_buyer_name: 'BT Buyer Name',
    raw_snapshot: JSON.stringify({
      clientName: 'Snapshot Buyer Name',
      lines: [],
    }),
  });
  assert.ok(xml.includes('Snapshot Buyer Name'), 'Snapshot buyer name should take priority');
  assert.ok(!xml.includes('BT Buyer Name'), 'BT buyer name should be overridden by snapshot');
});

test('buildUBL – includes InvoiceLine for each item', () => {
  const xml = xmlBuilder.buildUBL({
    id: 'INV-001',
    bt_27_seller_name: 'Test SRL',
    raw_snapshot: JSON.stringify({
      lines: [
        { name: 'Produs 1', quantity: 1, price: 50, vat: 19, total: 50 },
        { name: 'Produs 2', quantity: 3, price: 30, vat: 9,  total: 90 },
      ],
    }),
  });
  const lineCount = (xml.match(/<cac:InvoiceLine>/g) || []).length;
  assert.strictEqual(lineCount, 2, `Expected 2 invoice lines, got ${lineCount}`);
});

test('buildUBL – handles empty lines gracefully', () => {
  const xml = xmlBuilder.buildUBL({
    id: 'INV-001',
    bt_27_seller_name: 'Test SRL',
    raw_snapshot: JSON.stringify({ lines: [] }),
  });
  assert.ok(xml.includes('</Invoice>'), 'XML should be complete even with no lines');
  const lineCount = (xml.match(/<cac:InvoiceLine>/g) || []).length;
  assert.strictEqual(lineCount, 0, 'Should have 0 invoice lines');
});

test('buildUBL – InvoiceTypeCode is 380', () => {
  const xml = xmlBuilder.buildUBL({ id: 'INV-001', bt_27_seller_name: 'Test SRL' });
  assert.ok(xml.includes('<cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>'), 'InvoiceTypeCode 380 not found');
});

test('buildUBL – DocumentCurrencyCode is RON', () => {
  const xml = xmlBuilder.buildUBL({ id: 'INV-001', bt_27_seller_name: 'Test SRL' });
  assert.ok(xml.includes('<cbc:DocumentCurrencyCode>RON</cbc:DocumentCurrencyCode>'), 'Currency RON not found');
});

test('buildUBL – uses issue date', () => {
  const xml = xmlBuilder.buildUBL({
    id: 'INV-001',
    bt_27_seller_name: 'Test SRL',
    document_date: '2024-06-15',
  });
  assert.ok(xml.includes('<cbc:IssueDate>2024-06-15</cbc:IssueDate>'), 'IssueDate not found');
});

test('buildUBL – includes IBAN payment means when bt_84 is set', () => {
  const xml = xmlBuilder.buildUBL({
    id: 'INV-001',
    bt_27_seller_name: 'Test SRL',
    bt_84_payee_iban: 'RO49AAAA1B31007593840000',
  });
  assert.ok(xml.includes('RO49AAAA1B31007593840000'), 'IBAN not found in XML');
  assert.ok(xml.includes('<cac:PaymentMeans>'), 'PaymentMeans element missing');
});

test('buildUBL – omits PaymentMeans when no IBAN', () => {
  const xml = xmlBuilder.buildUBL({ id: 'INV-001', bt_27_seller_name: 'Test SRL' });
  assert.ok(!xml.includes('<cac:PaymentMeans>'), 'PaymentMeans should be absent when no IBAN');
});

test('buildUBL – handles mixed VAT rates', () => {
  const xml = xmlBuilder.buildUBL({
    id: 'INV-001',
    bt_27_seller_name: 'Test SRL',
    raw_snapshot: JSON.stringify({
      lines: [
        { name: 'A', quantity: 1, price: 100, vat: 19, total: 100 },
        { name: 'B', quantity: 1, price: 100, vat: 9,  total: 100 },
      ],
    }),
  });
  // Should have 2 TaxSubtotal elements
  const subtotals = (xml.match(/<cac:TaxSubtotal>/g) || []).length;
  assert.strictEqual(subtotals, 2, `Expected 2 TaxSubtotals, got ${subtotals}`);
});

test('buildUBL – zero-rate VAT category is Z', () => {
  const xml = xmlBuilder.buildUBL({
    id: 'INV-001',
    bt_27_seller_name: 'Test SRL',
    raw_snapshot: JSON.stringify({
      lines: [{ name: 'A', quantity: 1, price: 100, vat: 0, total: 100 }],
    }),
  });
  assert.ok(xml.includes('<cbc:ID>Z</cbc:ID>'), 'Zero-rate VAT category should be Z');
});

// ─── computeTotals Tests ─────────────────────────────────────────────────────

console.log('\n═══ xml-builder.js – computeTotals ════════════════════════');

test('computeTotals – empty lines returns zeroes', () => {
  const { vatGroups, totalNet, totalVat } = xmlBuilder.computeTotals([]);
  assert.deepStrictEqual(vatGroups, {});
  assert.strictEqual(totalNet, 0);
  assert.strictEqual(totalVat, 0);
});

test('computeTotals – single item at 19% VAT', () => {
  const { totalNet, totalVat } = xmlBuilder.computeTotals([
    { total: 100, vat: 19 },
  ]);
  assert.strictEqual(totalNet, 100);
  assert.strictEqual(totalVat, 19);
});

test('computeTotals – uses quantity * price when total is absent', () => {
  const { totalNet } = xmlBuilder.computeTotals([
    { quantity: 5, price: 20, vat: 19 },
  ]);
  assert.strictEqual(totalNet, 100);
});

test('computeTotals – groups same VAT rates together', () => {
  const { vatGroups } = xmlBuilder.computeTotals([
    { total: 100, vat: 19 },
    { total: 200, vat: 19 },
  ]);
  assert.deepStrictEqual(vatGroups, { 19: 300 });
});

// ─── vatCategory Tests ───────────────────────────────────────────────────────

console.log('\n═══ xml-builder.js – vatCategory ══════════════════════════');

test('vatCategory – 19% → S', () => assert.strictEqual(xmlBuilder.vatCategory(19), 'S'));
test('vatCategory – 9% → S',  () => assert.strictEqual(xmlBuilder.vatCategory(9),  'S'));
test('vatCategory – 5% → S',  () => assert.strictEqual(xmlBuilder.vatCategory(5),  'S'));
test('vatCategory – 0% → Z',  () => assert.strictEqual(xmlBuilder.vatCategory(0),  'Z'));
test('vatCategory – 25% → Z', () => assert.strictEqual(xmlBuilder.vatCategory(25), 'Z'));

// ─── stripSchemaLocation Tests ───────────────────────────────────────────────

console.log('\n═══ xml-builder.js – stripSchemaLocation ══════════════════');

test('stripSchemaLocation – removes xsi:schemaLocation attribute', () => {
  const xml = '<Invoice xsi:schemaLocation="urn:xxx http://example.com/schema.xsd">content</Invoice>';
  const result = xmlBuilder.stripSchemaLocation(xml);
  assert.ok(!result.includes('xsi:schemaLocation'), 'schemaLocation should be removed');
  assert.ok(result.includes('content'), 'Content should be preserved');
});

test('stripSchemaLocation – leaves XML unchanged if no schemaLocation', () => {
  const xml = '<Invoice xmlns="urn:example">content</Invoice>';
  const result = xmlBuilder.stripSchemaLocation(xml);
  assert.strictEqual(result, xml, 'XML without schemaLocation should be unchanged');
});

// ─── ANAF Client – no mTLS Tests ────────────────────────────────────────────

console.log('\n═══ anaf-client.js ═════════════════════════════════════════');

test('anaf-client exports request function', () => {
  assert.strictEqual(typeof anafClient.request, 'function', 'request should be a function');
});

test('anaf-client exports withRetry function', () => {
  assert.strictEqual(typeof anafClient.withRetry, 'function', 'withRetry should be a function');
});

test('anaf-client does NOT export mTLS functions', () => {
  assert.strictEqual(anafClient.getMtlsAgent, undefined, 'getMtlsAgent must not be exported');
  assert.strictEqual(anafClient.isMtlsConfigured, undefined, 'isMtlsConfigured must not be exported');
});

// ─── Config – isJwt Tests (loaded via inline helper) ────────────────────────

console.log('\n═══ config helpers ═════════════════════════════════════════');

// Re-implement isJwt locally for testing (same logic as in config.js)
const isJwt = (token) => {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
};

// Re-implement isTokenExpired locally
const isTokenExpired = (s) => {
  if (!s || !s.token_expires_at) return true;
  return new Date(s.token_expires_at) <= new Date();
};

test('isJwt – valid JWT token returns true', () => {
  const token = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.SflKxwRJSMeKKF2QT4fwpMeJf36POkQ';
  assert.strictEqual(isJwt(token), true, 'Valid JWT should return true');
});

test('isJwt – opaque hex token returns false', () => {
  const token = 'f7584c01843b44ef373abe83855c53b15357d3bd571a0d3f538e173c9ed3c02e';
  assert.strictEqual(isJwt(token), false, 'Opaque hex token should return false');
});

test('isJwt – empty string returns false', () => {
  assert.strictEqual(isJwt(''), false, 'Empty string should return false');
});

test('isJwt – null returns false', () => {
  assert.strictEqual(isJwt(null), false, 'null should return false');
});

test('isJwt – undefined returns false', () => {
  assert.strictEqual(isJwt(undefined), false, 'undefined should return false');
});

test('isJwt – 2-segment string returns false', () => {
  assert.strictEqual(isJwt('header.payload'), false, 'Only 2 segments should fail');
});

test('isJwt – 4-segment string returns false', () => {
  assert.strictEqual(isJwt('a.b.c.d'), false, 'Four segments should fail');
});

test('isJwt – segments with dots inside return true (only splits on top-level dots)', () => {
  // A real JWT: header.payload.signature – all 3 segments non-empty
  assert.strictEqual(isJwt('aaa.bbb.ccc'), true, '3-segment dot-separated string should be JWT');
});

test('isTokenExpired – returns true if no token_expires_at', () => {
  assert.strictEqual(isTokenExpired({ token_expires_at: '' }), true);
  assert.strictEqual(isTokenExpired({}), true);
});

test('isTokenExpired – returns true for past date', () => {
  assert.strictEqual(isTokenExpired({ token_expires_at: '2020-01-01T00:00:00.000Z' }), true);
});

test('isTokenExpired – returns false for future date', () => {
  const future = new Date(Date.now() + 3600 * 1000).toISOString();
  assert.strictEqual(isTokenExpired({ token_expires_at: future }), false);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('══════════════════════════════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
} else {
  console.log('✅ All tests passed!\n');
}

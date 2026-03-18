/**
 * E-Factura SPV (Sistemul Prin care se efectueaza Validarea) module
 * Implements ANAF REST API for uploading UBL XML invoices to SPV (test environment).
 *
 * API docs: https://mfinante.gov.ro/ro/web/efactura/informatii-tehnice
 * Test base URL: https://api.anaf.ro/test/FCTEL/rest/
 *
 * All endpoints require OAuth2 Bearer token obtained from ANAF.
 */

const express = require('express');
const router = express.Router();
const db = require('../database');
const rateLimit = require('express-rate-limit');

// Rate limiter for e-Factura SPV endpoints (ANAF calls are expensive)
const efacturaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply rate limiting to all routes in this router
router.use(efacturaLimiter);

const ANAF_TEST_BASE = 'https://api.anaf.ro/test/FCTEL/rest';
const ANAF_PROD_BASE = 'https://api.anaf.ro/prod/FCTEL/rest';

// ANAF OAuth2 endpoints
const ANAF_AUTH_URL   = 'https://logincert.anaf.ro/anaf-oauth2/v1/authorize';
const ANAF_TOKEN_URL  = 'https://logincert.anaf.ro/anaf-oauth2/v1/token';

// Delay between consecutive ANAF API calls to avoid rate limiting
const UPLOAD_RATE_LIMIT_DELAY_MS = 300;
const STATUS_RATE_LIMIT_DELAY_MS = 200;

// Helper: get SPV settings from DB
const getSpvSettings = () => {
  return db.prepare('SELECT * FROM spv_settings WHERE id = 1').get() || {};
};

// Helper: build auth header
const buildAuthHeader = (token) => ({
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/xml',
});

// Helper: get base URL for current environment (always test for now)
const getBaseUrl = (settings) => {
  return settings.environment === 'prod' ? ANAF_PROD_BASE : ANAF_TEST_BASE;
};

// Helper: generate UBL XML from billing invoice record
const buildUBL = (inv) => {
  const snap =
    inv.raw_snapshot && typeof inv.raw_snapshot === 'string'
      ? JSON.parse(inv.raw_snapshot)
      : inv.raw_snapshot || {};

  const esc = (v) =>
    String(v || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const cName   = snap.clientName || inv.client_name || inv.bt_44_buyer_name || '';
  const cCIF    = snap.clientCIF  || inv.bt_48_buyer_vat_identifier || '';
  const cNrReg  = snap.clientNrRegCom || inv.bt_47_buyer_legal_registration || '';
  const cStrada = snap.clientStrada || inv.bt_50_buyer_address || '';
  const cCity   = snap.clientLocalitate || inv.bt_52_buyer_city || '';
  const cRegion = snap.clientJudet || inv.bt_54_buyer_region || '';
  const cCountry = snap.clientTara || inv.bt_55_buyer_country || 'RO';

  const lines = snap.lines || snap.documentPositions || [];
  const issueDate = esc(inv.document_date || inv.bt_2_issue_date || '');
  const dueDate   = esc(inv.due_date || inv.bt_9_due_date || inv.document_date || '');

  // Compute VAT groups
  const vatGroups = {};
  lines.forEach((item) => {
    const rate = item.vat != null ? Number(item.vat) : 19;
    const lineTotal = Number(item.total || (Number(item.unitCount || item.quantity || 0) * Number(item.price || 0)));
    if (!vatGroups[rate]) vatGroups[rate] = 0;
    vatGroups[rate] += lineTotal;
  });
  const totalNet = Object.values(vatGroups).reduce((s, v) => s + v, 0);
  const totalVat = Object.entries(vatGroups).reduce((s, [rate, net]) => s + (net * Number(rate)) / 100, 0);

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

  // Order reference
  const nrComanda = snap.nrComanda || null;
  if (nrComanda) {
    xml += `  <cac:OrderReference>\n    <cbc:ID>${esc(nrComanda)}</cbc:ID>\n  </cac:OrderReference>\n`;
  }

  // Seller
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

  // Buyer
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

  // Payment means
  if (inv.bt_84_payee_iban) {
    const pmCode = inv.bt_81_payment_means_code || '31';
    xml += `  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>${esc(pmCode)}</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>${esc(inv.bt_84_payee_iban)}</cbc:ID>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>\n`;
  }

  // Tax total
  xml += `  <cac:TaxTotal>\n    <cbc:TaxAmount currencyID="RON">${totalVat.toFixed(2)}</cbc:TaxAmount>\n`;
  Object.entries(vatGroups).forEach(([rate, netAmt]) => {
    const vatAmt = (netAmt * Number(rate)) / 100;
    const catCode = Number(rate) === 19 || Number(rate) === 9 || Number(rate) === 5 ? 'S' : 'Z';
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

  // Monetary totals
  xml += `  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="RON">${totalNet.toFixed(2)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="RON">${totalNet.toFixed(2)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="RON">${(totalNet + totalVat).toFixed(2)}</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="RON">${(totalNet + totalVat).toFixed(2)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>\n`;

  // Invoice lines
  lines.forEach((item, idx) => {
    const rate = item.vat != null ? Number(item.vat) : 19;
    const qty = Number(item.unitCount || item.quantity || 0);
    const price = Number(item.price || 0);
    const lineNet = Number(item.total || qty * price);
    const catCode = rate === 19 || rate === 9 || rate === 5 ? 'S' : 'Z';
    xml += `  <cac:InvoiceLine>
    <cbc:ID>${item.lineId || idx + 1}</cbc:ID>
    <cbc:InvoicedQuantity unitCode="${esc(item.unit || 'C62')}">${qty.toFixed(4)}</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="RON">${lineNet.toFixed(2)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc(item.description || item.descriere || '')}</cbc:Name>
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

  xml += `</Invoice>`;
  return xml;
};

// ─── Settings ────────────────────────────────────────────────────────────────

// GET /api/efactura/settings
router.get('/settings', (req, res) => {
  try {
    const s = getSpvSettings();
    res.json({
      cif:           s.cif            || '',
      token:         s.oauth_token    || '',
      tokenExpiresAt: s.token_expires_at || '',
      environment:   s.environment    || 'test',
      clientId:      s.client_id      || '',
      clientSecret:  s.client_secret  || '',
      redirectUri:   s.redirect_uri   || '',
      hasRefreshToken: !!(s.refresh_token),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/efactura/settings
router.put('/settings', (req, res) => {
  try {
    const { cif, token, tokenExpiresAt, environment, clientId, clientSecret, redirectUri } = req.body;
    db.prepare(
      `UPDATE spv_settings SET cif = ?, oauth_token = ?, token_expires_at = ?, environment = ?,
       client_id = ?, client_secret = ?, redirect_uri = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`
    ).run(
      cif || '',
      token || '',
      tokenExpiresAt || '',
      environment || 'test',
      clientId || '',
      clientSecret || '',
      redirectUri || '',
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── OAuth2 ANAF flow ─────────────────────────────────────────────────────────

// GET /api/efactura/oauth/authorize
// Returns the ANAF authorization URL for the user to visit
router.get('/oauth/authorize', (req, res) => {
  try {
    const settings = getSpvSettings();
    if (!settings.client_id) {
      return res.status(400).json({ error: 'client_id ANAF lipsă. Configurați credențialele OAuth2 în setări.' });
    }
    if (!settings.redirect_uri) {
      return res.status(400).json({ error: 'redirect_uri lipsă. Configurați redirect_uri în setări.' });
    }

    const params = new URLSearchParams({
      response_type:      'code',
      client_id:          settings.client_id,
      redirect_uri:       settings.redirect_uri,
      token_content_type: 'jwt',
      scope:              'offline_access',
    });

    const authUrl = `${ANAF_AUTH_URL}?${params.toString()}`;
    res.json({ authUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/efactura/oauth/callback
// ANAF redirects here after the user authenticates; exchanges code for tokens
router.get('/oauth/callback', async (req, res) => {
  const { code, error: oauthError, error_description } = req.query;

  if (oauthError) {
    const msg = error_description || oauthError;
    return res.redirect(`/?oauth_error=${encodeURIComponent(msg)}#efactura-spv`);
  }

  if (!code) {
    return res.redirect('/?oauth_error=Cod+de+autorizare+lipsă#efactura-spv');
  }

  try {
    const settings = getSpvSettings();

    const body = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  settings.redirect_uri,
      client_id:     settings.client_id,
      client_secret: settings.client_secret,
    });

    const tokenRes = await fetch(ANAF_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });

    const tokenData = await tokenRes.json().catch(() => ({}));

    if (!tokenRes.ok) {
      const errMsg = tokenData.error_description || tokenData.error || JSON.stringify(tokenData);
      return res.redirect(`/?oauth_error=${encodeURIComponent(errMsg)}#efactura-spv`);
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
      : '';

    db.prepare(
      `UPDATE spv_settings SET oauth_token = ?, refresh_token = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`
    ).run(
      tokenData.access_token  || '',
      tokenData.refresh_token || '',
      expiresAt,
    );

    res.redirect('/?oauth_success=1#efactura-spv');
  } catch (err) {
    console.error('OAuth2 callback error:', err);
    res.redirect(`/?oauth_error=${encodeURIComponent(err.message)}#efactura-spv`);
  }
});

// POST /api/efactura/oauth/refresh
// Uses the stored refresh_token to obtain a new access_token
router.post('/oauth/refresh', async (req, res) => {
  try {
    const settings = getSpvSettings();

    if (!settings.refresh_token) {
      return res.status(400).json({ error: 'Nu există refresh token salvat. Autorizați din nou aplicația.' });
    }
    if (!settings.client_id || !settings.client_secret) {
      return res.status(400).json({ error: 'client_id / client_secret lipsă. Configurați credențialele OAuth2.' });
    }

    const body = new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: settings.refresh_token,
      client_id:     settings.client_id,
      client_secret: settings.client_secret,
    });

    const tokenRes = await fetch(ANAF_TOKEN_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    body.toString(),
    });

    const tokenData = await tokenRes.json().catch(() => ({}));

    if (!tokenRes.ok) {
      const errMsg = tokenData.error_description || tokenData.error || JSON.stringify(tokenData);
      return res.status(400).json({ error: `Refresh eșuat: ${errMsg}` });
    }

    const expiresAt = tokenData.expires_in
      ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
      : '';

    db.prepare(
      `UPDATE spv_settings SET oauth_token = ?, refresh_token = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`
    ).run(
      tokenData.access_token  || '',
      // Preserve existing refresh_token if provider doesn't return a new one (common for ANAF)
      tokenData.refresh_token || settings.refresh_token,
      expiresAt,
    );

    res.json({ success: true, expiresAt });
  } catch (err) {
    console.error('OAuth2 refresh error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Invoices list for SPV ────────────────────────────────────────────────────

// GET /api/efactura/invoices?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/invoices', (req, res) => {
  try {
    const { from, to } = req.query;
    let query = 'SELECT * FROM billing_invoices WHERE 1=1';
    const params = [];
    if (from) { query += ' AND document_date >= ?'; params.push(from); }
    if (to)   { query += ' AND document_date <= ?'; params.push(to); }
    query += ' ORDER BY document_date DESC, created_at DESC';
    const rows = db.prepare(query).all(...params);
    res.json(rows.map(r => ({
      ...r,
      raw_snapshot: r.raw_snapshot ? JSON.parse(r.raw_snapshot) : null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Upload single invoice to ANAF SPV ───────────────────────────────────────

// POST /api/efactura/upload/:invoiceId
router.post('/upload/:invoiceId', async (req, res) => {
  try {
    const settings = getSpvSettings();
    if (!settings.oauth_token) {
      return res.status(400).json({ error: 'Token OAuth2 ANAF lipsă. Configurați token-ul în setări.' });
    }
    if (!settings.cif) {
      return res.status(400).json({ error: 'CIF furnizor lipsă. Configurați CIF-ul în setări.' });
    }

    const inv = db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(req.params.invoiceId);
    if (!inv) return res.status(404).json({ error: 'Factura nu a fost găsită.' });

    const xml = buildUBL(inv);
    const xmlBuffer = Buffer.from(xml, 'utf8');

    const baseUrl = getBaseUrl(settings);
    const uploadUrl = `${baseUrl}/upload?standard=UBL&cif=${encodeURIComponent(settings.cif)}`;

    // Mark as uploading
    db.prepare(
      `UPDATE billing_invoices SET spv_status = 'uploading', spv_uploaded_at = CURRENT_TIMESTAMP, spv_response = NULL WHERE id = ?`
    ).run(inv.id);

    let anafRes, anafBody;
    try {
      anafRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.oauth_token}`,
          'Content-Type': 'application/xml',
        },
        body: xmlBuffer,
      });
      anafBody = await anafRes.json().catch(() => anafRes.text());
    } catch (fetchErr) {
      db.prepare(
        `UPDATE billing_invoices SET spv_status = 'error', spv_response = ? WHERE id = ?`
      ).run(JSON.stringify({ error: fetchErr.message }), inv.id);
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${fetchErr.message}` });
    }

    // Parse response
    const uploadId = anafBody?.index_incarcare || anafBody?.IndexIncarcare || null;
    const execStatus = anafBody?.ExecutionStatus;

    let newStatus = 'uploaded';
    if (!anafRes.ok || execStatus === 1) {
      newStatus = 'error';
    }

    db.prepare(
      `UPDATE billing_invoices SET spv_upload_id = ?, spv_status = ?, spv_response = ?, spv_uploaded_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(uploadId, newStatus, JSON.stringify(anafBody), inv.id);

    res.json({
      success: anafRes.ok && execStatus !== 1,
      uploadId,
      status: newStatus,
      anafResponse: anafBody,
      httpStatus: anafRes.status,
    });
  } catch (err) {
    console.error('SPV upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Check upload status ──────────────────────────────────────────────────────

// POST /api/efactura/check-status/:invoiceId
router.post('/check-status/:invoiceId', async (req, res) => {
  try {
    const settings = getSpvSettings();
    if (!settings.oauth_token) {
      return res.status(400).json({ error: 'Token OAuth2 ANAF lipsă.' });
    }

    const inv = db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(req.params.invoiceId);
    if (!inv) return res.status(404).json({ error: 'Factura nu a fost găsită.' });
    if (!inv.spv_upload_id) return res.status(400).json({ error: 'Factura nu a fost încărcată în SPV.' });

    const baseUrl = getBaseUrl(settings);
    const statusUrl = `${baseUrl}/stareMesaj?id_incarcare=${encodeURIComponent(inv.spv_upload_id)}`;

    let anafRes, anafBody;
    try {
      anafRes = await fetch(statusUrl, {
        headers: { Authorization: `Bearer ${settings.oauth_token}` },
      });
      anafBody = await anafRes.json().catch(() => anafRes.text());
    } catch (fetchErr) {
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${fetchErr.message}` });
    }

    // Map ANAF status to local status
    const anafStare = anafBody?.stare || '';
    let newStatus = inv.spv_status;
    if (anafStare === 'ok') {
      newStatus = 'validated';
    } else if (anafStare === 'nok') {
      newStatus = 'rejected';
    } else if (anafStare === 'in prelucrare') {
      newStatus = 'processing';
    } else if (anafStare && anafStare.toLowerCase().includes('erori')) {
      newStatus = 'error';
    }

    const downloadId = anafBody?.id_descarcare || null;

    db.prepare(
      `UPDATE billing_invoices SET spv_status = ?, spv_response = ?, spv_download_id = ? WHERE id = ?`
    ).run(newStatus, JSON.stringify(anafBody), downloadId, inv.id);

    res.json({
      uploadId: inv.spv_upload_id,
      anafStatus: anafStare,
      localStatus: newStatus,
      downloadId,
      anafResponse: anafBody,
    });
  } catch (err) {
    console.error('SPV status check error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Download ANAF response ZIP ───────────────────────────────────────────────

// GET /api/efactura/download/:invoiceId
router.get('/download/:invoiceId', async (req, res) => {
  try {
    const settings = getSpvSettings();
    if (!settings.oauth_token) {
      return res.status(400).json({ error: 'Token OAuth2 ANAF lipsă.' });
    }

    const inv = db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(req.params.invoiceId);
    if (!inv) return res.status(404).json({ error: 'Factura nu a fost găsită.' });
    if (!inv.spv_download_id) return res.status(400).json({ error: 'Nu există ID descarcare pentru această factură.' });

    const baseUrl = getBaseUrl(settings);
    const dlUrl = `${baseUrl}/descarcare?id=${encodeURIComponent(inv.spv_download_id)}`;

    let anafRes;
    try {
      anafRes = await fetch(dlUrl, {
        headers: { Authorization: `Bearer ${settings.oauth_token}` },
      });
    } catch (fetchErr) {
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${fetchErr.message}` });
    }

    if (!anafRes.ok) {
      const body = await anafRes.text();
      return res.status(anafRes.status).json({ error: body });
    }

    const buffer = Buffer.from(await anafRes.arrayBuffer());
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="raspuns_anaf_${inv.invoice_code || inv.id}.zip"`);
    res.send(buffer);
  } catch (err) {
    console.error('SPV download error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Get XML for preview ──────────────────────────────────────────────────────

// GET /api/efactura/xml/:invoiceId
router.get('/xml/:invoiceId', (req, res) => {
  try {
    const inv = db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(req.params.invoiceId);
    if (!inv) return res.status(404).json({ error: 'Factura nu a fost găsită.' });
    const xml = buildUBL(inv);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="factura-${inv.invoice_code || inv.id}.xml"`);
    res.send(xml);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── List ANAF messages (primite/emise) ──────────────────────────────────────

// GET /api/efactura/messages?zile=60&tip=P   (tip: P=emise, C=primite, T=toate)
router.get('/messages', async (req, res) => {
  try {
    const settings = getSpvSettings();
    if (!settings.oauth_token) {
      return res.status(400).json({ error: 'Token OAuth2 ANAF lipsă.' });
    }
    if (!settings.cif) {
      return res.status(400).json({ error: 'CIF furnizor lipsă.' });
    }

    const { zile = 60, tip = 'T' } = req.query;
    const baseUrl = getBaseUrl(settings);
    const listUrl = `${baseUrl}/listaMesajeFactura?zile=${encodeURIComponent(zile)}&cif=${encodeURIComponent(settings.cif)}&tip=${encodeURIComponent(tip)}`;

    let anafRes, anafBody;
    try {
      anafRes = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${settings.oauth_token}` },
      });
      anafBody = await anafRes.json().catch(() => anafRes.text());
    } catch (fetchErr) {
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${fetchErr.message}` });
    }

    if (!anafRes.ok) {
      return res.status(anafRes.status).json({ error: anafBody });
    }

    // Upsert messages into local DB for offline viewing
    const messages = anafBody?.mesaje || [];
    const upsert = db.prepare(`
      INSERT OR REPLACE INTO spv_messages (anaf_message_id, tip, data_creare, cif, id_solicitant, detalii, id_descarcare, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    for (const m of messages) {
      upsert.run(
        String(m.id || ''),
        m.tip || '',
        m.data_creare || '',
        String(m.cif || ''),
        String(m.id_solicitant || ''),
        m.detalii || '',
        String(m.id_descarcare || '')
      );
    }

    res.json({ messages, total: messages.length, raw: anafBody });
  } catch (err) {
    console.error('SPV messages error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Download a specific message from ANAF ───────────────────────────────────

// GET /api/efactura/download-message/:id_descarcare
router.get('/download-message/:id_descarcare', async (req, res) => {
  try {
    const settings = getSpvSettings();
    if (!settings.oauth_token) {
      return res.status(400).json({ error: 'Token OAuth2 ANAF lipsă.' });
    }

    const { id_descarcare } = req.params;
    const baseUrl = getBaseUrl(settings);
    const dlUrl = `${baseUrl}/descarcareMesaj?id=${encodeURIComponent(id_descarcare)}`;

    let anafRes;
    try {
      anafRes = await fetch(dlUrl, {
        headers: { Authorization: `Bearer ${settings.oauth_token}` },
      });
    } catch (fetchErr) {
      return res.status(502).json({ error: `Eroare conexiune ANAF: ${fetchErr.message}` });
    }

    if (!anafRes.ok) {
      const body = await anafRes.text();
      return res.status(anafRes.status).json({ error: body });
    }

    // Update local DB record with downloaded flag
    db.prepare(
      'UPDATE spv_messages SET downloaded_at = CURRENT_TIMESTAMP WHERE id_descarcare = ?'
    ).run(id_descarcare);

    const buffer = Buffer.from(await anafRes.arrayBuffer());
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="mesaj_anaf_${id_descarcare}.zip"`);
    res.send(buffer);
  } catch (err) {
    console.error('SPV download message error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Local SPV messages cache ─────────────────────────────────────────────────

// GET /api/efactura/local-messages
router.get('/local-messages', (req, res) => {
  try {
    const msgs = db.prepare('SELECT * FROM spv_messages ORDER BY data_creare DESC, created_at DESC').all();
    res.json(msgs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Batch upload ─────────────────────────────────────────────────────────────

// POST /api/efactura/upload-batch  body: { invoiceIds: [...] }
router.post('/upload-batch', async (req, res) => {
  try {
    const { invoiceIds = [] } = req.body;
    if (!invoiceIds.length) return res.status(400).json({ error: 'invoiceIds required' });

    const settings = getSpvSettings();
    if (!settings.oauth_token) return res.status(400).json({ error: 'Token OAuth2 ANAF lipsă.' });
    if (!settings.cif) return res.status(400).json({ error: 'CIF furnizor lipsă.' });

    const baseUrl = getBaseUrl(settings);
    const results = [];

    for (const invoiceId of invoiceIds) {
      const inv = db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(invoiceId);
      if (!inv) {
        results.push({ invoiceId, success: false, error: 'Factura nu a fost găsită.' });
        continue;
      }

      try {
        const xml = buildUBL(inv);
        const xmlBuffer = Buffer.from(xml, 'utf8');
        const uploadUrl = `${baseUrl}/upload?standard=UBL&cif=${encodeURIComponent(settings.cif)}`;

        db.prepare(
          `UPDATE billing_invoices SET spv_status = 'uploading', spv_uploaded_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(inv.id);

        const anafRes = await fetch(uploadUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${settings.oauth_token}`, 'Content-Type': 'application/xml' },
          body: xmlBuffer,
        });
        const anafBody = await anafRes.json().catch(() => anafRes.text());

        const uploadId = anafBody?.index_incarcare || anafBody?.IndexIncarcare || null;
        const execStatus = anafBody?.ExecutionStatus;
        const newStatus = (!anafRes.ok || execStatus === 1) ? 'error' : 'uploaded';

        db.prepare(
          `UPDATE billing_invoices SET spv_upload_id = ?, spv_status = ?, spv_response = ?, spv_uploaded_at = CURRENT_TIMESTAMP WHERE id = ?`
        ).run(uploadId, newStatus, JSON.stringify(anafBody), inv.id);

        results.push({ invoiceId, success: anafRes.ok && execStatus !== 1, uploadId, status: newStatus, anafResponse: anafBody });

        // Small delay to avoid ANAF API rate limiting
        await new Promise(r => setTimeout(r, UPLOAD_RATE_LIMIT_DELAY_MS));
      } catch (itemErr) {
        db.prepare(
          `UPDATE billing_invoices SET spv_status = 'error', spv_response = ? WHERE id = ?`
        ).run(JSON.stringify({ error: itemErr.message }), inv.id);
        results.push({ invoiceId, success: false, error: itemErr.message });
      }
    }

    res.json({ results, total: results.length, success: results.filter(r => r.success).length });
  } catch (err) {
    console.error('SPV batch upload error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Batch status check ───────────────────────────────────────────────────────

// POST /api/efactura/check-status-batch  body: { invoiceIds: [...] }
router.post('/check-status-batch', async (req, res) => {
  try {
    const { invoiceIds = [] } = req.body;
    if (!invoiceIds.length) return res.status(400).json({ error: 'invoiceIds required' });

    const settings = getSpvSettings();
    if (!settings.oauth_token) return res.status(400).json({ error: 'Token OAuth2 ANAF lipsă.' });

    const baseUrl = getBaseUrl(settings);
    const results = [];

    for (const invoiceId of invoiceIds) {
      const inv = db.prepare('SELECT id, spv_upload_id, spv_status FROM billing_invoices WHERE id = ?').get(invoiceId);
      if (!inv || !inv.spv_upload_id) {
        results.push({ invoiceId, skipped: true });
        continue;
      }

      try {
        const statusUrl = `${baseUrl}/stareMesaj?id_incarcare=${encodeURIComponent(inv.spv_upload_id)}`;
        const anafRes = await fetch(statusUrl, { headers: { Authorization: `Bearer ${settings.oauth_token}` } });
        const anafBody = await anafRes.json().catch(() => anafRes.text());

        const anafStare = anafBody?.stare || '';
        let newStatus = inv.spv_status;
        if (anafStare === 'ok') newStatus = 'validated';
        else if (anafStare === 'nok') newStatus = 'rejected';
        else if (anafStare === 'in prelucrare') newStatus = 'processing';
        else if (anafStare && anafStare.toLowerCase().includes('erori')) newStatus = 'error';

        const downloadId = anafBody?.id_descarcare || null;
        db.prepare(
          `UPDATE billing_invoices SET spv_status = ?, spv_response = ?, spv_download_id = ? WHERE id = ?`
        ).run(newStatus, JSON.stringify(anafBody), downloadId, inv.id);

        results.push({ invoiceId, anafStatus: anafStare, localStatus: newStatus, downloadId });
        await new Promise(r => setTimeout(r, STATUS_RATE_LIMIT_DELAY_MS));
      } catch (itemErr) {
        results.push({ invoiceId, error: itemErr.message });
      }
    }

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

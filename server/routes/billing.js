const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const rateLimit = require('express-rate-limit');
const db = require('../database');

// Rate limiter for billing invoice lines endpoints
const invoiceLinesLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

const FACTUREAZA_ENDPOINT =
  process.env.FACTUREAZA_ENDPOINT || 'https://sandbox.factureaza.ro/graphql';

const getApiKey = (req) =>
  process.env.FACTUREAZA_API_KEY || req.query.api_key || '';

// Storage directory for generated PDFs
const INVOICE_STORAGE_DIR = path.join(__dirname, '..', 'storage', 'invoices');
if (!fs.existsSync(INVOICE_STORAGE_DIR)) {
  fs.mkdirSync(INVOICE_STORAGE_DIR, { recursive: true });
}

// GraphQL helper using Node built-in fetch
const gqlFetch = async (apiKey, query, variables = {}) => {
  const credentials = Buffer.from(`${apiKey}:`).toString('base64');
  const response = await fetch(FACTUREAZA_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${credentials}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GraphQL request failed: ${response.status} ${text}`);
  }
  return response.json();
};

// Format number as string with dot decimal separator
const formatNumber = (n) => {
  if (n === null || n === undefined) return '0.00';
  return Number(n).toFixed(2);
};

// Map order items to DocumentPositionAttributes
// Each line includes: lineId (Nr. crt.), barcode (EAN/codBare), productCode (codArticolFurnizor),
// description, unit, unitCount, price, total, vat
const mapOrderItems = (items, products) => {
  return items.map((item, index) => {
    const product = products
      ? products.find((p) => p.id === item.productId)
      : null;

    const pos = {
      lineId: index + 1,                                              // BT-126 / Nr. crt.
      barcode: product?.codBare || null,                             // BT-157 / EAN cod bare
      description: product?.descriere || item.productId || 'Produs', // BT-153
      unit: product?.um || 'buc',                                    // BT-130
      unitCount: String(item.quantity || 0),                         // BT-129
      price: formatNumber(item.price),                               // BT-146
      total: formatNumber((item.quantity || 0) * (item.price || 0)), // BT-131
    };

    if (product?.codArticolFurnizor) {
      pos.productCode = product.codArticolFurnizor; // BT-155
    }

    if (product?.cotaTVA !== undefined && product?.cotaTVA !== null) {
      pos.vat = String(product.cotaTVA); // BT-152
    }

    return pos;
  });
};

// Get current billing settings
const getBillingSettings = () => {
  return db.prepare('SELECT * FROM billing_settings WHERE id = 1').get();
};

// Get company/seller settings from app_config (BT-27…BT-43, BT-84 IBAN, BT-85 Banca)
const getCompanySettings = () => {
  const row = db.prepare("SELECT value FROM app_config WHERE key = 'company'").get();
  if (!row) return {};
  try {
    return JSON.parse(row.value);
  } catch {
    return {};
  }
};

// Generate PDF for invoice and save to disk
// Header: two-column layout – Seller (left, no title) | Buyer (right-aligned, no title)
// Seller data read from app_config (company, BT-27…BT-43, BT-84 IBAN, BT-85 Banca); Buyer from invoice snapshot.
// Address is split across two lines: street on line 1, city+county on line 2.
// Right column is omitted gracefully when buyer data is absent.
// Table columns: Nr. crt. | Cod (EAN/barcode, BT-157) | Descriere | UM | Cant. | Preț | Total
const generateInvoicePdf = (invoice, order, client) => {
  return new Promise((resolve, reject) => {
    const snapshot = invoice.raw_snapshot
      ? (typeof invoice.raw_snapshot === 'string'
          ? JSON.parse(invoice.raw_snapshot)
          : invoice.raw_snapshot)
      : {};

    // Prefer snapshot client fields (stored at invoice time) then fallback to live client object
    const c = {
      nume:             snapshot.clientName     || client?.nume             || null,
      cif:              snapshot.clientCIF      || client?.cif              || null,
      nrRegCom:         snapshot.clientNrRegCom || client?.nrRegCom         || null,
      strada:           snapshot.clientStrada   || client?.strada           || null,
      localitate:       snapshot.clientLocalitate || client?.localitate     || null,
      judet:            snapshot.clientJudet    || client?.judet            || null,
      tara:             snapshot.clientTara     || client?.buyer_country    || 'RO',
      deliveryName:     snapshot.clientDeliveryName    || client?.delivery_name    || null,
      deliveryGLN:      snapshot.clientDeliveryGLN     || client?.delivery_gln     || null,
      deliveryAddress:  snapshot.clientDeliveryAddress || client?.delivery_address || null,
      deliveryCity:     snapshot.clientDeliveryCity    || client?.delivery_city    || null,
      deliveryRegion:   snapshot.clientDeliveryRegion  || client?.delivery_region  || null,
      deliveryCountry:  snapshot.clientDeliveryCountry || client?.delivery_country || 'RO',
    };

    const pdfPath = path.join(INVOICE_STORAGE_DIR, `${invoice.id}.pdf`);
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(pdfPath);

    doc.pipe(stream);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('FACTURĂ', { align: 'center' });
    doc.moveDown(0.5);

    if (invoice.invoice_code) {
      doc.fontSize(14).font('Helvetica').text(`Nr: ${invoice.invoice_code}`, { align: 'center' });
    }
    doc.fontSize(10).text(`Data: ${invoice.document_date || order?.date || '-'}`, { align: 'center' });
    doc.moveDown(0.5);

    // Two-column header: Seller (left, no title) | Buyer (right-aligned, no title)
    // Seller data comes from invoice snapshot (BT-xx stored at creation time), with fallback
    // to live app_config. If buyer data is absent the right column is omitted.
    const company = getCompanySettings();
    const pageWidth = doc.page.width;
    const colLeft      = 50;
    const rightMargin  = pageWidth - 50;
    const colRight     = Math.floor(pageWidth / 2) + 10;
    const leftColWidth = colRight - colLeft - 10;
    const rightColWidth = rightMargin - colRight;
    const headerStartY = doc.y;
    let leftY  = headerStartY;
    let rightY = headerStartY;

    // LEFT COLUMN – Seller (Vânzător): prefer snapshot BT-xx (historical), fallback to live app_config
    const sellerName   = snapshot.bt_27_seller_name              || company?.bt_27_seller_name;
    const sellerCIF    = snapshot.bt_31_32_seller_vat_identifier  || company?.bt_31_32_seller_vat_identifier
                      || snapshot.bt_29_seller_identifier         || company?.bt_29_seller_identifier;
    const sellerRegCom = snapshot.bt_30_seller_legal_registration || company?.bt_30_seller_legal_registration;
    const sellerStreet = snapshot.bt_35_seller_address            || company?.bt_35_seller_address;
    const sellerCity   = snapshot.bt_37_seller_city               || company?.bt_37_seller_city;
    const sellerRegion = snapshot.bt_39_seller_region             || company?.bt_39_seller_region;
    const sellerPhone  = snapshot.bt_42_seller_phone              || company?.bt_42_seller_phone;
    const sellerEmail  = snapshot.bt_43_seller_email              || company?.bt_43_seller_email;
    const sellerBanca  = snapshot.bt_85_payee_bank_name           || company?.bt_85_payee_bank_name;
    const sellerIBAN   = snapshot.bt_84_payee_iban                || company?.bt_84_payee_iban;

    if (sellerName || sellerCIF) {
      doc.font('Helvetica-Bold').fontSize(9);
      if (sellerName)   { doc.text(sellerName,                   colLeft, leftY, { width: leftColWidth }); leftY += 12; }
      doc.font('Helvetica').fontSize(9);
      if (sellerCIF)    { doc.text(`CIF: ${sellerCIF}`,          colLeft, leftY); leftY += 12; }
      if (sellerRegCom) { doc.text(`Reg. Com.: ${sellerRegCom}`, colLeft, leftY); leftY += 12; }
      if (sellerStreet) { doc.text(sellerStreet,                 colLeft, leftY, { width: leftColWidth }); leftY += 12; }
      const sellerCityReg = [sellerCity, sellerRegion].filter(Boolean).join(', ');
      if (sellerCityReg) { doc.text(sellerCityReg,              colLeft, leftY); leftY += 12; }
      if (sellerPhone)  { doc.text(`Tel: ${sellerPhone}`,        colLeft, leftY); leftY += 12; }
      if (sellerEmail)  { doc.text(`Email: ${sellerEmail}`,      colLeft, leftY); leftY += 12; }
      if (sellerBanca)  { doc.text(`Banca: ${sellerBanca}`,      colLeft, leftY); leftY += 12; }
      if (sellerIBAN)   { doc.text(`IBAN: ${sellerIBAN}`,        colLeft, leftY, { width: leftColWidth }); leftY += 12; }
    }

    // RIGHT COLUMN – Buyer (Cumpărător) BT-44…BT-55; omitted if no buyer data
    const hasBuyerData = c.nume || c.cif || c.nrRegCom || c.strada;
    if (hasBuyerData) {
      doc.font('Helvetica-Bold').fontSize(9);
      doc.text(c.nume || invoice.external_client_id || '-', colRight, rightY, { width: rightColWidth, align: 'right' }); rightY += 12;
      doc.font('Helvetica').fontSize(9);
      if (c.cif)      { doc.text(`CIF: ${c.cif}`,                             colRight, rightY, { width: rightColWidth, align: 'right' }); rightY += 12; }
      if (c.nrRegCom) { doc.text(`Reg. Com.: ${c.nrRegCom}`,                  colRight, rightY, { width: rightColWidth, align: 'right' }); rightY += 12; }
      if (c.strada)   { doc.text(c.strada,                                    colRight, rightY, { width: rightColWidth, align: 'right' }); rightY += 12; }
      if (c.localitate || c.judet) {
        doc.text([c.localitate, c.judet].filter(Boolean).join(', '),           colRight, rightY, { width: rightColWidth, align: 'right' });
        rightY += 12;
      }
      if (c.tara && c.tara !== 'RO') { doc.text(`Tara: ${c.tara}`,            colRight, rightY, { width: rightColWidth, align: 'right' }); rightY += 12; }
    }

    // Delivery section – right column, under buyer data; same font/size as buyer; no section title
    const hasDelivery = c.deliveryName || c.deliveryGLN || c.deliveryAddress || c.deliveryCity || c.deliveryRegion;
    if (hasDelivery) {
      doc.font('Helvetica').fontSize(9);
      if (c.deliveryName)    { doc.text(`Denumire Loc Livrare: ${c.deliveryName}`,    colRight, rightY, { width: rightColWidth, align: 'right' }); rightY += 12; }
      if (c.deliveryGLN)     { doc.text(`GLN Loc Livrare: ${c.deliveryGLN}`,          colRight, rightY, { width: rightColWidth, align: 'right' }); rightY += 12; }
      if (c.deliveryAddress) { doc.text(`Adresa Livrare: ${c.deliveryAddress}`,       colRight, rightY, { width: rightColWidth, align: 'right' }); rightY += 12; }
      if (c.deliveryCity)    { doc.text(`Localitate Livrare: ${c.deliveryCity}`,      colRight, rightY, { width: rightColWidth, align: 'right' }); rightY += 12; }
      if (c.deliveryRegion)  { doc.text(`Judet: ${c.deliveryRegion}`,                 colRight, rightY, { width: rightColWidth, align: 'right' }); rightY += 12; }
    }

    // Advance cursor past both columns; reset x to left margin for subsequent flowing text
    doc.y = Math.max(leftY, rightY) + 14;
    doc.x = colLeft;

    doc.moveDown(0.5);

    // Items table – columns: Nr. | Cod | Descriere | UM | Cant. | Preț | Total
    const items = snapshot.lines || snapshot.documentPositions || [];
    if (items.length > 0) {
      doc.fontSize(11).font('Helvetica-Bold').text('Produse:');
      doc.moveDown(0.3);

      const tableTop = doc.y;
      // Column x-positions (left margin = 50, right edge = 540)
      const col = { nr: 50, cod: 75, desc: 160, um: 340, qty: 370, price: 415, total: 470 };

      // Table header
      doc.fontSize(8).font('Helvetica-Bold');
      doc.text('Nr.',    col.nr,   tableTop, { width: 22,  align: 'right' });
      doc.text('Cod',    col.cod,  tableTop, { width: 82,  align: 'left'  });
      doc.text('Descriere', col.desc, tableTop, { width: 175, align: 'left' });
      doc.text('UM',     col.um,   tableTop, { width: 27,  align: 'left'  });
      doc.text('Cant.',  col.qty,  tableTop, { width: 42,  align: 'right' });
      doc.text('Preț',   col.price, tableTop, { width: 52,  align: 'right' });
      doc.text('Total',  col.total, tableTop, { width: 68,  align: 'right' });

      doc.moveTo(50, doc.y + 2).lineTo(540, doc.y + 2).stroke();
      doc.moveDown(0.4);

      doc.font('Helvetica').fontSize(8);
      items.forEach((item, idx) => {
        const y = doc.y;
        const nr    = item.lineId    != null ? String(item.lineId) : String(idx + 1);
        const code  = item.barcode   || '';
        const desc  = item.description || item.descriere || '-';
        const um    = item.unit      || item.um    || '';
        const qty   = item.unitCount || item.quantity || '0';
        const price = item.price     || '0.00';
        const total = item.total     || formatNumber((parseFloat(qty) || 0) * (parseFloat(price) || 0));

        doc.text(nr,    col.nr,   y, { width: 22,  align: 'right' });
        doc.text(code,  col.cod,  y, { width: 82,  align: 'left'  });
        doc.text(desc,  col.desc, y, { width: 175, align: 'left'  });
        doc.text(um,    col.um,   y, { width: 27,  align: 'left'  });
        doc.text(String(qty),   col.qty,   y, { width: 42,  align: 'right' });
        doc.text(String(price), col.price, y, { width: 52,  align: 'right' });
        doc.text(String(total), col.total, y, { width: 68,  align: 'right' });
        doc.moveDown(0.4);
      });

      doc.moveTo(50, doc.y).lineTo(540, doc.y).stroke();
      doc.moveDown(0.5);
    }

    // Totals
    doc.fontSize(10).font('Helvetica');
    const totals = [
      ['Total fără TVA:', formatNumber(invoice.total)],
      ['TVA:', formatNumber(invoice.total_vat)],
    ];
    doc.fontSize(11).font('Helvetica-Bold');
    totals.push(['TOTAL:', formatNumber(invoice.total_with_vat)]);

    for (const [label, value] of totals) {
      doc.text(`${label} ${value} RON`, { align: 'right' });
    }

    doc.end();

    stream.on('finish', () => resolve(pdfPath));
    stream.on('error', reject);
  });
};

// Map VAT rate to e-Factura category code: "S" for standard 19%, "" for other non-null rates
const vatCategoryFromRate = (vatRate) => {
  if (vatRate === 19) return 'S';
  if (vatRate != null) return '';
  return null;
};

// Get the first available net price from a product's prices map (fallback to 0)
const getDefaultProductPrice = (product) => {
  const prices = product?.prices;
  if (prices && typeof prices === 'object') {
    const first = Object.values(prices)[0];
    if (first != null) return Number(first);
  }
  return 0;
};

// Upsert billing_invoice_lines rows with BT fields mapped from products
const upsertInvoiceLines = (invoiceId, items, products) => {
  db.prepare('DELETE FROM billing_invoice_lines WHERE invoice_id = ?').run(invoiceId);

  const insertLine = db.prepare(`
    INSERT INTO billing_invoice_lines (
      invoice_id, bt_126_line_id, bt_129_invoiced_quantity, bt_129_unit_code,
      bt_131_line_net_amount, bt_146_item_net_price, bt_147_item_price_discount,
      bt_151_line_vat_category_code, bt_152_line_vat_rate,
      bt_153_item_name, bt_155_seller_item_id, bt_157_item_barcode
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  items.forEach((item, index) => {
    const product = products ? products.find((p) => p.id === item.productId) : null;
    const qty = item.quantity || 0;
    const price = item.price || 0;
    const netAmount = qty * price;
    const vatRate = product?.cotaTVA != null ? product.cotaTVA : null;
    const vatCategoryCode = vatCategoryFromRate(vatRate);

    insertLine.run(
      invoiceId,
      index + 1,
      qty,
      product?.um || null,
      netAmount,
      price,
      0,
      vatCategoryCode,
      vatRate,
      product?.descriere || null,
      product?.codArticolFurnizor || null,
      product?.codBare || null
    );
  });
};

// Generate (or regenerate) a local invoice for an order (synchronous, uses transaction)
const generateLocalInvoice = (orderId) => {
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) {
      console.warn(`generateLocalInvoice: order ${orderId} not found`);
      return null;
    }

    const products = db
      .prepare('SELECT * FROM products')
      .all()
      .map((p) => ({ ...p, prices: p.prices ? JSON.parse(p.prices) : {} }));

    const client = order.clientId
      ? db.prepare('SELECT * FROM clients WHERE id = ?').get(order.clientId)
      : null;

    const items = order.items ? JSON.parse(order.items) : [];
    const lines = mapOrderItems(items, products);

    const documentDate = order.date || new Date().toISOString().split('T')[0];

    // Check if invoice exists already
    const existing = db
      .prepare('SELECT * FROM billing_invoices WHERE order_id = ?')
      .get(orderId);

    let invoiceNumber = existing?.invoice_number || null;
    let invoiceCode = existing?.invoice_code || null;

    // Read seller BT-xx fields from app_config at invoice creation time (snapshot)
    const company = getCompanySettings();

    // Allocate a new invoice number if this is a new invoice
    const allocateAndStore = db.transaction(() => {
      if (!invoiceNumber) {
        const settings = getBillingSettings();
        invoiceNumber = settings.invoice_next_number;
        const series = settings.invoice_series || 'FCT';
        const padding = settings.invoice_number_padding || 6;
        invoiceCode = `${series}-${String(invoiceNumber).padStart(padding, '0')}`;

        // Increment next number
        db.prepare(
          'UPDATE billing_settings SET invoice_next_number = invoice_next_number + 1, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
        ).run();
      }

      const snapshot = {
        orderId,
        clientId: order.clientId,
        // Seller / Vânzător BT-xx fields (snapshot at invoice creation time)
        bt_27_seller_name:               company.bt_27_seller_name              || null,
        bt_29_seller_identifier:         company.bt_29_seller_identifier         || null,
        bt_30_seller_legal_registration: company.bt_30_seller_legal_registration || null,
        bt_31_32_seller_vat_identifier:  company.bt_31_32_seller_vat_identifier  || null,
        bt_35_seller_address:            company.bt_35_seller_address            || null,
        bt_37_seller_city:               company.bt_37_seller_city               || null,
        bt_39_seller_region:             company.bt_39_seller_region             || null,
        bt_40_seller_country:            company.bt_40_seller_country            || 'RO',
        bt_41_seller_contact:            company.bt_41_seller_contact            || null,
        bt_42_seller_phone:              company.bt_42_seller_phone              || null,
        bt_43_seller_email:              company.bt_43_seller_email              || null,
        bt_84_payee_iban:                company.bt_84_payee_iban                || null,
        bt_85_payee_bank_name:           company.bt_85_payee_bank_name           || null,
        bt_81_payment_means_code:        company.bt_81_payment_means_code        || '42',
        // Buyer / Cumpărător fields (BT-44 … BT-55)
        clientName:       client?.nume        || null,
        clientCIF:        client?.cif         || null,
        clientNrRegCom:   client?.nrRegCom    || null,
        clientStrada:     client?.strada      || null,
        clientLocalitate: client?.localitate  || null,
        clientJudet:      client?.judet       || null,
        // NOTE: 'clientTara' in snapshot corresponds to client.buyer_country in the DB schema
        clientTara:       client?.buyer_country || 'RO',
        // Delivery address fields (BT-70 … BT-80)
        clientDeliveryName:    client?.delivery_name    || null,
        clientDeliveryGLN:     client?.delivery_gln     || null,
        clientDeliveryAddress: client?.delivery_address || null,
        clientDeliveryCity:    client?.delivery_city    || null,
        clientDeliveryRegion:  client?.delivery_region  || null,
        clientDeliveryCountry: client?.delivery_country || 'RO',
        documentDate,
        lines,
        total: order.total,
        totalVat: order.totalTVA,
        totalWithVat: order.totalWithVAT,
      };

      if (existing) {
        db.prepare(
          `UPDATE billing_invoices SET
            series = ?, document_date = ?, total = ?, total_vat = ?,
            total_with_vat = ?, status = ?, raw_snapshot = ?,
            invoice_number = ?, invoice_code = ?,
            bt_27_seller_name = ?, bt_29_seller_identifier = ?,
            bt_30_seller_legal_registration = ?, bt_31_32_seller_vat_identifier = ?,
            bt_35_seller_address = ?, bt_37_seller_city = ?,
            bt_39_seller_region = ?, bt_40_seller_country = ?,
            bt_41_seller_contact = ?, bt_42_seller_phone = ?, bt_43_seller_email = ?,
            bt_84_payee_iban = ?, bt_85_payee_bank_name = ?, bt_81_payment_means_code = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE order_id = ?`
        ).run(
          invoiceCode?.split('-')[0] || null,
          documentDate,
          order.total || 0,
          order.totalTVA || 0,
          order.totalWithVAT || 0,
          'created',
          JSON.stringify(snapshot),
          invoiceNumber,
          invoiceCode,
          snapshot.bt_27_seller_name,
          snapshot.bt_29_seller_identifier,
          snapshot.bt_30_seller_legal_registration,
          snapshot.bt_31_32_seller_vat_identifier,
          snapshot.bt_35_seller_address,
          snapshot.bt_37_seller_city,
          snapshot.bt_39_seller_region,
          snapshot.bt_40_seller_country,
          snapshot.bt_41_seller_contact,
          snapshot.bt_42_seller_phone,
          snapshot.bt_43_seller_email,
          snapshot.bt_84_payee_iban,
          snapshot.bt_85_payee_bank_name,
          snapshot.bt_81_payment_means_code,
          orderId
        );
        return db.prepare('SELECT * FROM billing_invoices WHERE order_id = ?').get(orderId);
      } else {
        const localId = `billing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        db.prepare(
          `INSERT INTO billing_invoices
            (id, order_id, series, document_date, external_client_id,
             total, total_vat, total_with_vat, status, raw_snapshot,
             invoice_number, invoice_code, export_status,
             bt_27_seller_name, bt_29_seller_identifier,
             bt_30_seller_legal_registration, bt_31_32_seller_vat_identifier,
             bt_35_seller_address, bt_37_seller_city,
             bt_39_seller_region, bt_40_seller_country,
             bt_41_seller_contact, bt_42_seller_phone, bt_43_seller_email,
             bt_84_payee_iban, bt_85_payee_bank_name, bt_81_payment_means_code)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          localId,
          orderId,
          invoiceCode?.split('-')[0] || null,
          documentDate,
          order.clientId || null,
          order.total || 0,
          order.totalTVA || 0,
          order.totalWithVAT || 0,
          'created',
          JSON.stringify(snapshot),
          invoiceNumber,
          invoiceCode,
          'disabled',
          snapshot.bt_27_seller_name,
          snapshot.bt_29_seller_identifier,
          snapshot.bt_30_seller_legal_registration,
          snapshot.bt_31_32_seller_vat_identifier,
          snapshot.bt_35_seller_address,
          snapshot.bt_37_seller_city,
          snapshot.bt_39_seller_region,
          snapshot.bt_40_seller_country,
          snapshot.bt_41_seller_contact,
          snapshot.bt_42_seller_phone,
          snapshot.bt_43_seller_email,
          snapshot.bt_84_payee_iban,
          snapshot.bt_85_payee_bank_name,
          snapshot.bt_81_payment_means_code
        );
        return db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(localId);
      }
    });

    const invoiceRow = allocateAndStore();

    // Populate billing_invoice_lines with BT fields from products
    upsertInvoiceLines(invoiceRow.id, items, products);

    // Generate PDF asynchronously (don't block the response)
    generateInvoicePdf(invoiceRow, order, client)
      .then((pdfPath) => {
        db.prepare(
          'UPDATE billing_invoices SET pdf_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
        ).run(pdfPath, invoiceRow.id);
      })
      .catch((err) => {
        console.error(`PDF generation failed for invoice ${invoiceRow.id}:`, err);
      });

    return invoiceRow;
  } catch (err) {
    console.error('generateLocalInvoice error:', err);
    return null;
  }
};

// Export for use in server.js - attached below after router definition as well
// (see end of file)

// ============ BILLING SETTINGS ENDPOINTS ============

// GET /api/billing/settings
router.get('/settings', (req, res) => {
  try {
    const settings = getBillingSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/billing/settings
router.put('/settings', (req, res) => {
  try {
    const { invoice_series, invoice_next_number, invoice_number_padding, receipt_series, receipt_next_number } = req.body;

    if (invoice_series !== undefined && (typeof invoice_series !== 'string' || !invoice_series.trim())) {
      return res.status(400).json({ error: 'invoice_series must be a non-empty string' });
    }
    if (invoice_next_number !== undefined) {
      const n = parseInt(invoice_next_number, 10);
      if (isNaN(n) || n < 1) {
        return res.status(400).json({ error: 'invoice_next_number must be a positive integer' });
      }
    }
    if (invoice_number_padding !== undefined) {
      const p = parseInt(invoice_number_padding, 10);
      if (isNaN(p) || p < 1 || p > 10) {
        return res.status(400).json({ error: 'invoice_number_padding must be between 1 and 10' });
      }
    }
    if (receipt_series !== undefined && (typeof receipt_series !== 'string' || !receipt_series.trim())) {
      return res.status(400).json({ error: 'receipt_series must be a non-empty string' });
    }
    if (receipt_next_number !== undefined) {
      const n = parseInt(receipt_next_number, 10);
      if (isNaN(n) || n < 1) {
        return res.status(400).json({ error: 'receipt_next_number must be a positive integer' });
      }
    }

    const updates = [];
    const params = [];
    if (invoice_series !== undefined) { updates.push('invoice_series = ?'); params.push(invoice_series.trim()); }
    if (invoice_next_number !== undefined) { updates.push('invoice_next_number = ?'); params.push(parseInt(invoice_next_number, 10)); }
    if (invoice_number_padding !== undefined) { updates.push('invoice_number_padding = ?'); params.push(parseInt(invoice_number_padding, 10)); }
    if (receipt_series !== undefined) { updates.push('receipt_series = ?'); params.push(receipt_series.trim()); }
    if (receipt_next_number !== undefined) { updates.push('receipt_next_number = ?'); params.push(parseInt(receipt_next_number, 10)); }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    db.prepare(`UPDATE billing_settings SET ${updates.join(', ')} WHERE id = 1`).run(...params);

    res.json(getBillingSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/billing/orders/:orderId/validate - mark order as validated
router.post('/orders/:orderId/validate', (req, res) => {
  try {
    const { orderId } = req.params;
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!row) return res.status(404).json({ error: 'Order not found' });

    db.prepare(
      'UPDATE orders SET validata = 1, updatedAt = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(orderId);

    res.json({ success: true, orderId, validata: true });
  } catch (err) {
    console.error('Error validating order:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/billing/local-invoices - list local billing invoice records
router.get('/local-invoices', (req, res) => {
  try {
    const rows = db
      .prepare('SELECT * FROM billing_invoices ORDER BY created_at DESC')
      .all();
    res.json(
      rows.map((r) => ({
        ...r,
        raw_snapshot: r.raw_snapshot ? JSON.parse(r.raw_snapshot) : null,
      }))
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/billing/local-invoices/:id/pdf - download local generated PDF
router.get('/local-invoices/:id/pdf', (req, res) => {
  try {
    const inv = db
      .prepare('SELECT * FROM billing_invoices WHERE id = ?')
      .get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    if (!inv.pdf_path || !fs.existsSync(inv.pdf_path)) {
      // Try to regenerate on-the-fly
      if (inv.order_id) {
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(inv.order_id);
        const pdfPath = path.join(INVOICE_STORAGE_DIR, `${inv.id}.pdf`);

        const PDFDoc = require('pdfkit');
        const doc2 = new PDFDoc({ margin: 50, size: 'A4' });
        const chunks = [];
        doc2.on('data', (c) => chunks.push(c));
        doc2.on('end', () => {
          const buf = Buffer.concat(chunks);
          fs.writeFileSync(pdfPath, buf);
          db.prepare('UPDATE billing_invoices SET pdf_path = ? WHERE id = ?').run(pdfPath, inv.id);
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', `attachment; filename="factura-${inv.invoice_code || inv.id}.pdf"`);
          res.send(buf);
        });

        // Write minimal PDF
        doc2.fontSize(20).font('Helvetica-Bold').text('FACTURĂ', { align: 'center' });
        if (inv.invoice_code) doc2.fontSize(14).font('Helvetica').text(`Nr: ${inv.invoice_code}`, { align: 'center' });
        doc2.fontSize(10).text(`Data: ${inv.document_date || order?.date || '-'}`, { align: 'center' });
        doc2.end();
        return;
      }
      return res.status(404).json({ error: 'PDF not yet generated' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="factura-${inv.invoice_code || inv.id}.pdf"`);
    fs.createReadStream(inv.pdf_path).pipe(res);
  } catch (err) {
    console.error('Error serving local PDF:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/billing/local-invoices/from-order - create/upsert local invoice without Factureaza
router.post('/local-invoices/from-order', (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId required' });

    const record = generateLocalInvoice(orderId);
    if (!record) return res.status(404).json({ error: 'Order not found or invoice generation failed' });

    res.json({
      success: true,
      invoice: {
        ...record,
        raw_snapshot: record.raw_snapshot
          ? JSON.parse(record.raw_snapshot)
          : null,
      },
    });
  } catch (err) {
    console.error('Error creating local invoice:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/billing/invoices/from-order - create invoice from validated order via Factureaza
router.post('/invoices/from-order', async (req, res) => {
  try {
    const { orderId, seriesId, clientId: externalClientId } = req.body;
    const apiKey = getApiKey(req);

    if (!apiKey) return res.status(400).json({ error: 'API key required' });
    if (!orderId) return res.status(400).json({ error: 'orderId required' });

    // Get order
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (!order.validata) {
      return res.status(400).json({
        error:
          'Order must be validated (validata=true) before generating invoice',
      });
    }

    // Check if already invoiced
    const existing = db
      .prepare('SELECT * FROM billing_invoices WHERE order_id = ?')
      .get(orderId);
    if (existing) {
      return res.status(409).json({
        error: 'Invoice already generated for this order',
        invoice: {
          ...existing,
          raw_snapshot: existing.raw_snapshot
            ? JSON.parse(existing.raw_snapshot)
            : null,
        },
      });
    }

    // Get products for mapping
    const products = db
      .prepare('SELECT * FROM products')
      .all()
      .map((p) => ({
        ...p,
        prices: p.prices ? JSON.parse(p.prices) : {},
      }));

    // Parse order items
    const items = order.items ? JSON.parse(order.items) : [];
    const documentPositions = mapOrderItems(items, products);

    const documentDate =
      order.date || new Date().toISOString().split('T')[0];

    const mutation = `
      mutation CreateDocument($document: DocumentAttributes!) {
        createDocument(document: $document) {
          document {
            id
            series
            documentDate
            clientId
            total
            totalVat
            totalWithVat
            status
            pdfContent
          }
          errors
        }
      }
    `;

    const docInput = {
      documentDate,
      documentPositions,
    };
    if (externalClientId) docInput.clientId = externalClientId;
    if (seriesId) docInput.seriesId = seriesId;

    let doc = null;
    let externalError = null;
    try {
      const result = await gqlFetch(apiKey, mutation, { document: docInput });

      if (result.errors && result.errors.length > 0) {
        externalError = result.errors;
      } else {
        const gqlErrors = result.data?.createDocument?.errors;
        if (gqlErrors && gqlErrors.length > 0) {
          externalError = gqlErrors;
        } else {
          doc = result.data?.createDocument?.document;
        }
      }
    } catch (extErr) {
      externalError = extErr.message;
      console.warn('External invoice API failed (non-blocking):', extErr.message);
    }

    // Store local record regardless of external result
    const localId = `billing-${Date.now()}`;
    db.prepare(
      `INSERT INTO billing_invoices
        (id, order_id, external_invoice_id, series, document_date,
         external_client_id, total, total_vat, total_with_vat, status, raw_snapshot,
         export_provider, export_status, last_export_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      localId,
      orderId,
      doc?.id || null,
      doc?.series || null,
      doc?.documentDate || documentDate,
      doc?.clientId || externalClientId || null,
      doc?.total || order.total,
      doc?.totalVat || order.totalTVA,
      doc?.totalWithVat || order.totalWithVAT,
      doc?.status || 'created',
      JSON.stringify(doc || { documentPositions }),
      'factureaza',
      doc ? 'exported' : 'failed',
      externalError ? JSON.stringify(externalError) : null
    );

    const localRecord = db
      .prepare('SELECT * FROM billing_invoices WHERE id = ?')
      .get(localId);

    res.json({
      success: true,
      invoice: {
        ...localRecord,
        raw_snapshot: localRecord.raw_snapshot
          ? JSON.parse(localRecord.raw_snapshot)
          : null,
      },
      document: doc,
      externalError: externalError || undefined,
    });
  } catch (err) {
    console.error('Error creating invoice:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/billing/invoices - list invoices from factureaza.ro
router.get('/invoices', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'API key required' });

    const { page = 1, per_page = 20 } = req.query;

    const query = `
      query ListDocuments($page: Int, $perPage: Int) {
        documents(page: $page, perPage: $perPage) {
          id
          series
          documentDate
          clientId
          total
          totalVat
          totalWithVat
          status
        }
      }
    `;

    const result = await gqlFetch(apiKey, query, {
      page: Number(page),
      perPage: Number(per_page),
    });

    if (result.errors) {
      return res
        .status(400)
        .json({ error: 'GraphQL error', details: result.errors });
    }

    res.json(result.data?.documents || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/billing/invoice-series - list invoice series
router.get('/invoice-series', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'API key required' });

    const query = `
      query {
        documentSeries {
          id
          name
          documentType
          nextNumber
        }
      }
    `;

    const result = await gqlFetch(apiKey, query);

    if (result.errors) {
      return res
        .status(400)
        .json({ error: 'GraphQL error', details: result.errors });
    }

    res.json(result.data?.documentSeries || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/billing/invoice-series - create invoice series
router.post('/invoice-series', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'API key required' });

    const { name, documentType, nextNumber } = req.body;

    const mutation = `
      mutation CreateDocumentSeries($series: DocumentSeriesAttributes!) {
        createDocumentSeries(series: $series) {
          documentSeries {
            id
            name
            documentType
            nextNumber
          }
          errors
        }
      }
    `;

    const result = await gqlFetch(apiKey, mutation, {
      series: { name, documentType, nextNumber },
    });

    if (result.errors) {
      return res
        .status(400)
        .json({ error: 'GraphQL error', details: result.errors });
    }

    const series = result.data?.createDocumentSeries?.documentSeries;
    const errors = result.data?.createDocumentSeries?.errors;

    if (errors && errors.length > 0) {
      return res
        .status(400)
        .json({ error: 'Series creation failed', details: errors });
    }

    res.json({ success: true, series });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/billing/invoices/:id/pdf - fetch PDF content from Factureaza
router.get('/invoices/:id/pdf', async (req, res) => {
  try {
    const apiKey = getApiKey(req);
    if (!apiKey) return res.status(400).json({ error: 'API key required' });

    const { id } = req.params;

    const query = `
      query GetDocument($id: ID!) {
        document(id: $id) {
          id
          pdfContent
          pdf
        }
      }
    `;

    const result = await gqlFetch(apiKey, query, { id });

    if (result.errors) {
      return res
        .status(400)
        .json({ error: 'GraphQL error', details: result.errors });
    }

    const doc = result.data?.document;
    if (!doc) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const pdfData = doc.pdfContent || doc.pdf;
    if (!pdfData) {
      return res.status(404).json({ error: 'PDF not available' });
    }

    // If it's a URL, proxy it
    if (typeof pdfData === 'string' && pdfData.startsWith('http')) {
      const pdfResponse = await fetch(pdfData);
      if (!pdfResponse.ok) {
        return res.status(500).json({ error: 'Failed to fetch PDF' });
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="invoice-${id}.pdf"`
      );
      const buffer = await pdfResponse.arrayBuffer();
      return res.send(Buffer.from(buffer));
    }

    // Assume base64 encoded
    const buffer = Buffer.from(pdfData, 'base64');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice-${id}.pdf"`
    );
    res.send(buffer);
  } catch (err) {
    console.error('Error fetching invoice PDF:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/billing/local-invoices/:id/lines - list BT line rows for an invoice
router.get('/local-invoices/:id/lines', invoiceLinesLimiter, (req, res) => {
  try {
    const inv = db.prepare('SELECT id FROM billing_invoices WHERE id = ?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const lines = db
      .prepare('SELECT * FROM billing_invoice_lines WHERE invoice_id = ? ORDER BY bt_126_line_id')
      .all(req.params.id);
    res.json(lines);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/billing/local-invoices/:id/lines - add a line (auto-populate BT fields from product)
router.post('/local-invoices/:id/lines', invoiceLinesLimiter, (req, res) => {
  try {
    const inv = db.prepare('SELECT id FROM billing_invoices WHERE id = ?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const body = req.body || {};
    const productId = body.productId || null;
    let product = null;
    if (productId) {
      const row = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
      if (row) product = { ...row, prices: row.prices ? JSON.parse(row.prices) : {} };
    }

    const qty = body.bt_129_invoiced_quantity != null ? Number(body.bt_129_invoiced_quantity) : 0;
    const price = body.bt_146_item_net_price != null
      ? Number(body.bt_146_item_net_price)
      : (product ? getDefaultProductPrice(product) : 0);
    const netAmount = body.bt_131_line_net_amount != null
      ? Number(body.bt_131_line_net_amount)
      : qty * price;

    const vatRate = body.bt_152_line_vat_rate != null
      ? Number(body.bt_152_line_vat_rate)
      : (product?.cotaTVA != null ? product.cotaTVA : null);
    const vatCategoryCode = body.bt_151_line_vat_category_code !== undefined
      ? body.bt_151_line_vat_category_code
      : vatCategoryFromRate(vatRate);

    // Determine next line id
    const maxLine = db
      .prepare('SELECT MAX(bt_126_line_id) as m FROM billing_invoice_lines WHERE invoice_id = ?')
      .get(req.params.id);
    const lineId = (maxLine?.m || 0) + 1;

    const result = db.prepare(`
      INSERT INTO billing_invoice_lines (
        invoice_id, bt_126_line_id, bt_127_line_note,
        bt_129_invoiced_quantity, bt_129_unit_code,
        bt_131_line_net_amount, bt_146_item_net_price,
        bt_147_item_price_discount, bt_148_item_gross_price,
        bt_151_line_vat_category_code, bt_152_line_vat_rate,
        bt_153_item_name, bt_154_item_description,
        bt_155_seller_item_id, bt_156_buyer_item_id, bt_157_item_barcode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      req.params.id,
      lineId,
      body.bt_127_line_note || null,
      qty,
      body.bt_129_unit_code || product?.um || null,
      netAmount,
      price,
      body.bt_147_item_price_discount != null ? Number(body.bt_147_item_price_discount) : null,
      body.bt_148_item_gross_price != null ? Number(body.bt_148_item_gross_price) : null,
      vatCategoryCode,
      vatRate,
      body.bt_153_item_name || product?.descriere || null,
      body.bt_154_item_description || null,
      body.bt_155_seller_item_id || product?.codArticolFurnizor || null,
      body.bt_156_buyer_item_id || null,
      body.bt_157_item_barcode || product?.codBare || null
    );

    const newLine = db
      .prepare('SELECT * FROM billing_invoice_lines WHERE id = ?')
      .get(result.lastInsertRowid);
    res.status(201).json(newLine);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/billing/local-invoices/:id/lines/:lineId - update a line
router.put('/local-invoices/:id/lines/:lineId', invoiceLinesLimiter, (req, res) => {
  try {
    const inv = db.prepare('SELECT id FROM billing_invoices WHERE id = ?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const line = db
      .prepare('SELECT * FROM billing_invoice_lines WHERE id = ? AND invoice_id = ?')
      .get(req.params.lineId, req.params.id);
    if (!line) return res.status(404).json({ error: 'Line not found' });

    const body = req.body || {};
    const productId = body.productId || null;
    let product = null;
    if (productId) {
      const row = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
      if (row) product = { ...row, prices: row.prices ? JSON.parse(row.prices) : {} };
    }

    const qty = body.bt_129_invoiced_quantity != null
      ? Number(body.bt_129_invoiced_quantity)
      : line.bt_129_invoiced_quantity;
    const price = body.bt_146_item_net_price != null
      ? Number(body.bt_146_item_net_price)
      : (product ? (getDefaultProductPrice(product) || line.bt_146_item_net_price) : line.bt_146_item_net_price);
    const netAmount = body.bt_131_line_net_amount != null
      ? Number(body.bt_131_line_net_amount)
      : qty * price;

    const vatRate = body.bt_152_line_vat_rate !== undefined
      ? (body.bt_152_line_vat_rate != null ? Number(body.bt_152_line_vat_rate) : null)
      : (product?.cotaTVA != null ? product.cotaTVA : line.bt_152_line_vat_rate);
    const vatCategoryCode = body.bt_151_line_vat_category_code !== undefined
      ? body.bt_151_line_vat_category_code
      : (product ? vatCategoryFromRate(vatRate) : (line.bt_151_line_vat_category_code ?? vatCategoryFromRate(vatRate)));

    db.prepare(`
      UPDATE billing_invoice_lines SET
        bt_127_line_note = ?,
        bt_129_invoiced_quantity = ?,
        bt_129_unit_code = ?,
        bt_131_line_net_amount = ?,
        bt_146_item_net_price = ?,
        bt_147_item_price_discount = ?,
        bt_148_item_gross_price = ?,
        bt_151_line_vat_category_code = ?,
        bt_152_line_vat_rate = ?,
        bt_153_item_name = ?,
        bt_154_item_description = ?,
        bt_155_seller_item_id = ?,
        bt_156_buyer_item_id = ?,
        bt_157_item_barcode = ?
      WHERE id = ? AND invoice_id = ?
    `).run(
      body.bt_127_line_note !== undefined ? body.bt_127_line_note : line.bt_127_line_note,
      qty,
      body.bt_129_unit_code !== undefined ? body.bt_129_unit_code : (product?.um || line.bt_129_unit_code),
      netAmount,
      price,
      body.bt_147_item_price_discount !== undefined ? body.bt_147_item_price_discount : line.bt_147_item_price_discount,
      body.bt_148_item_gross_price !== undefined ? body.bt_148_item_gross_price : line.bt_148_item_gross_price,
      vatCategoryCode,
      vatRate,
      body.bt_153_item_name !== undefined ? body.bt_153_item_name : (product?.descriere || line.bt_153_item_name),
      body.bt_154_item_description !== undefined ? body.bt_154_item_description : line.bt_154_item_description,
      body.bt_155_seller_item_id !== undefined ? body.bt_155_seller_item_id : (product?.codArticolFurnizor || line.bt_155_seller_item_id),
      body.bt_156_buyer_item_id !== undefined ? body.bt_156_buyer_item_id : line.bt_156_buyer_item_id,
      body.bt_157_item_barcode !== undefined ? body.bt_157_item_barcode : (product?.codBare || line.bt_157_item_barcode),
      req.params.lineId,
      req.params.id
    );

    const updated = db
      .prepare('SELECT * FROM billing_invoice_lines WHERE id = ?')
      .get(req.params.lineId);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/billing/local-invoices/:id/lines/:lineId - delete a line
router.delete('/local-invoices/:id/lines/:lineId', invoiceLinesLimiter, (req, res) => {
  try {
    const inv = db.prepare('SELECT id FROM billing_invoices WHERE id = ?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const result = db
      .prepare('DELETE FROM billing_invoice_lines WHERE id = ? AND invoice_id = ?')
      .run(req.params.lineId, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Line not found' });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.generateLocalInvoice = generateLocalInvoice;
// upsertLocalInvoice is an alias for generateLocalInvoice (creates or updates invoice for an order)
module.exports.upsertLocalInvoice = generateLocalInvoice;

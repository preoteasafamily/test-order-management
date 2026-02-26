const express = require('express');
const router = express.Router();
const db = require('../database');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const { rateLimit } = require('express-rate-limit');

const pdfLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

const FACTUREAZA_ENDPOINT =
  process.env.FACTUREAZA_ENDPOINT || 'https://sandbox.factureaza.ro/graphql';

const getApiKey = (req) =>
  process.env.FACTUREAZA_API_KEY || req.query.api_key || '';

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

// Sanitize a string for use in filenames (replace diacritics, special chars, spaces)
const sanitizeFilename = (name) => {
  if (!name) return 'necunoscut';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[\\/:*?"<>|]/g, '')    // remove forbidden chars
    .replace(/\s+/g, '_')            // spaces to underscores
    .replace(/[^a-zA-Z0-9_\-]/g, '') // keep only safe chars
    .substring(0, 100)
    || 'client';
};

// Generate a PDF buffer from an invoice snapshot
const generateInvoicePdf = (inv) => {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({ size: 'A4', margin: 40 });

    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const snapshot = inv.raw_snapshot
      ? (typeof inv.raw_snapshot === 'string' ? JSON.parse(inv.raw_snapshot) : inv.raw_snapshot)
      : {};

    const company = (() => {
      try {
        const row = db.prepare("SELECT value FROM app_settings WHERE key = 'company'").get();
        return row ? JSON.parse(row.value) : {};
      } catch (e) { return {}; }
    })();

    const clientName = inv.client_name || snapshot.clientName || '-';
    const clientInfo = snapshot.client || {};
    const invoiceCode = inv.invoice_code || '-';
    const docDate = inv.document_date || snapshot.documentDate || '-';
    const items = snapshot.items || [];
    const currency = 'RON';

    // ---- HEADER ----
    doc.fontSize(18).font('Helvetica-Bold').text('FACTURA', { align: 'center' });
    doc.fontSize(12).font('Helvetica').text(invoiceCode, { align: 'center' });
    doc.moveDown(0.5);

    // Supplier / Client info side by side
    const colW = 240;
    const startY = doc.y;

    doc.font('Helvetica-Bold').text('Furnizor:', 40, startY);
    doc.font('Helvetica').text(company.furnizorNume || '-', 40, doc.y);
    doc.text(`CIF: ${company.furnizorCIF || '-'}`, 40, doc.y);
    doc.text(`Reg. Com.: ${company.furnizorNrRegCom || '-'}`, 40, doc.y);
    doc.text(`${company.furnizorStrada || ''}, ${company.furnizorLocalitate || ''}`, 40, doc.y);
    doc.text(`Banca: ${company.furnizorBanca || '-'}  IBAN: ${company.furnizorIBAN || '-'}`, 40, doc.y);

    const rightX = 40 + colW + 20;
    doc.font('Helvetica-Bold').text('Client:', rightX, startY);
    doc.font('Helvetica').text(clientName, rightX, doc.y > startY + 12 ? startY + 12 : doc.y);
    if (clientInfo.cif) doc.text(`CIF: ${clientInfo.cif}`, rightX, doc.y);
    if (clientInfo.nrRegCom) doc.text(`Reg. Com.: ${clientInfo.nrRegCom}`, rightX, doc.y);
    if (clientInfo.strada) doc.text(`${clientInfo.strada}`, rightX, doc.y);
    if (clientInfo.iban) doc.text(`IBAN: ${clientInfo.iban}`, rightX, doc.y);

    doc.moveDown(1);
    doc.text(`Data document: ${docDate}`, 40, doc.y);
    doc.moveDown(0.5);

    // ---- TABLE HEADER ----
    const tableTop = doc.y + 5;
    const cols = { nr: 40, cod: 65, desc: 115, um: 310, qty: 340, price: 380, vat: 430, total: 480 };

    doc.rect(40, tableTop, 520, 16).fillAndStroke('#e5e7eb', '#d1d5db');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(8);
    doc.text('Nr.', cols.nr, tableTop + 4, { width: 20 });
    doc.text('Cod', cols.cod, tableTop + 4, { width: 48 });
    doc.text('Descriere', cols.desc, tableTop + 4, { width: 190 });
    doc.text('UM', cols.um, tableTop + 4, { width: 28 });
    doc.text('Cant.', cols.qty, tableTop + 4, { width: 38 });
    doc.text('Pret', cols.price, tableTop + 4, { width: 48 });
    doc.text('TVA%', cols.vat, tableTop + 4, { width: 38 });
    doc.text('Total', cols.total, tableTop + 4, { width: 60 });

    // ---- TABLE ROWS ----
    let rowY = tableTop + 16;
    doc.font('Helvetica').fontSize(8);
    let totalFaraTVA = 0;
    let totalTVA = 0;
    let totalCuTVA = 0;

    items.forEach((item, idx) => {
      const qty = Number(item.quantity) || 0;
      const price = Number(item.price) || 0;
      const vatPct = Number(item.cotaTVA) || 0;
      const rowTotalFara = qty * price;
      const rowTVA = rowTotalFara * vatPct / 100;
      const rowTotal = rowTotalFara + rowTVA;
      totalFaraTVA += rowTotalFara;
      totalTVA += rowTVA;
      totalCuTVA += rowTotal;

      if (idx % 2 === 1) {
        doc.rect(40, rowY, 520, 14).fill('#f9fafb').stroke();
      }
      doc.fillColor('#000');
      doc.text(String(idx + 1), cols.nr, rowY + 3, { width: 20 });
      doc.text(item.codArticolFurnizor || '', cols.cod, rowY + 3, { width: 48 });
      doc.text(item.descriere || '', cols.desc, rowY + 3, { width: 190 });
      doc.text(item.um || 'buc', cols.um, rowY + 3, { width: 28 });
      doc.text(qty.toFixed(2), cols.qty, rowY + 3, { width: 38 });
      doc.text(price.toFixed(2), cols.price, rowY + 3, { width: 48 });
      doc.text(`${vatPct}%`, cols.vat, rowY + 3, { width: 38 });
      doc.text(rowTotal.toFixed(2), cols.total, rowY + 3, { width: 60 });
      rowY += 14;
    });

    doc.moveTo(40, rowY).lineTo(560, rowY).stroke();
    rowY += 6;

    // ---- TOTALS ----
    doc.font('Helvetica').fontSize(9);
    doc.text(`Total fara TVA:`, 380, rowY);
    doc.font('Helvetica-Bold').text(`${totalFaraTVA.toFixed(2)} ${currency}`, 480, rowY);
    rowY += 14;
    doc.font('Helvetica').text(`Total TVA:`, 380, rowY);
    doc.font('Helvetica-Bold').text(`${totalTVA.toFixed(2)} ${currency}`, 480, rowY);
    rowY += 14;
    doc.font('Helvetica-Bold').fontSize(10).text(`TOTAL DE PLATA:`, 380, rowY);
    doc.text(`${totalCuTVA.toFixed(2)} ${currency}`, 480, rowY);

    doc.end();
  });
};

// Format number as string with dot decimal separator
const formatNumber = (n) => {
  if (n === null || n === undefined) return '0.00';
  return Number(n).toFixed(2);
};

// Map order items to DocumentPositionAttributes
const mapOrderItems = (items, products) => {
  return items.map((item) => {
    const product = products
      ? products.find((p) => p.id === item.productId)
      : null;

    const pos = {
      description: product?.descriere || item.productId || 'Produs',
      unit: product?.um || 'buc',
      unitCount: String(item.quantity || 0),
      price: formatNumber(item.price),
      total: formatNumber((item.quantity || 0) * (item.price || 0)),
    };

    if (product?.codArticolFurnizor) {
      pos.productCode = product.codArticolFurnizor;
    }

    if (product?.cotaTVA !== undefined && product?.cotaTVA !== null) {
      pos.vat = String(product.cotaTVA);
    }

    return pos;
  });
};

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

// Build invoice PDF filename from invoice record
const buildInvoiceFilename = (inv) => {
  const safeClient = sanitizeFilename(inv.client_name);
  const docDate = inv.document_date || 'fara-data';
  const invoiceCode = (inv.invoice_code || 'factura').replace(/[^a-zA-Z0-9_\-]/g, '');
  return `${invoiceCode}_${safeClient}_${docDate}.pdf`;
};

// GET /api/billing/local-invoices/:id/pdf - generate PDF on demand for a single invoice
router.get('/local-invoices/:id/pdf', pdfLimiter, async (req, res) => {
  try {
    const inv = db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(req.params.id);
    if (!inv) return res.status(404).json({ error: 'Invoice not found' });

    const pdfBuffer = await generateInvoicePdf(inv);
    const filename = buildInvoiceFilename(inv);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Error generating invoice PDF:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/billing/local-invoices/pdf/batch - generate ZIP of PDFs for selected invoices
router.post('/local-invoices/pdf/batch', pdfLimiter, async (req, res) => {
  try {
    const { invoiceIds } = req.body;
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return res.status(400).json({ error: 'invoiceIds array is required' });
    }

    // Fetch all invoices in a single query
    const placeholders = invoiceIds.map(() => '?').join(',');
    const invoices = db
      .prepare(`SELECT * FROM billing_invoices WHERE id IN (${placeholders})`)
      .all(...invoiceIds)
      .filter(Boolean);

    if (invoices.length === 0) {
      return res.status(404).json({ error: 'No invoices found for the provided IDs' });
    }

    // Determine ZIP filename based on dates
    const dates = [...new Set(invoices.map((i) => i.document_date).filter(Boolean))];
    let zipName;
    if (dates.length === 1) {
      zipName = `facturi_${dates[0].replace(/-/g, '_')}.zip`;
    } else {
      zipName = 'facturi_multiple_dates.zip';
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => { throw err; });
    archive.pipe(res);

    for (const inv of invoices) {
      const pdfBuffer = await generateInvoicePdf(inv);
      const filename = buildInvoiceFilename(inv);
      archive.append(pdfBuffer, { name: filename });
    }

    await archive.finalize();
  } catch (err) {
    console.error('Error generating batch PDF ZIP:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// POST /api/billing/invoices/from-order - create invoice from validated order
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

    const result = await gqlFetch(apiKey, mutation, { document: docInput });

    if (result.errors && result.errors.length > 0) {
      return res
        .status(400)
        .json({ error: 'GraphQL error', details: result.errors });
    }

    const doc = result.data?.createDocument?.document;
    const gqlErrors = result.data?.createDocument?.errors;

    if (gqlErrors && gqlErrors.length > 0) {
      return res
        .status(400)
        .json({ error: 'Invoice creation failed', details: gqlErrors });
    }

    if (!doc) {
      return res
        .status(500)
        .json({ error: 'No document returned from API' });
    }

    // Store local record
    const localId = `billing-${Date.now()}`;
    db.prepare(
      `INSERT INTO billing_invoices
        (id, order_id, external_invoice_id, series, document_date,
         external_client_id, total, total_vat, total_with_vat, status, raw_snapshot)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      localId,
      orderId,
      doc.id || null,
      doc.series || null,
      doc.documentDate || documentDate,
      doc.clientId || externalClientId || null,
      doc.total || order.total,
      doc.totalVat || order.totalTVA,
      doc.totalWithVat || order.totalWithVAT,
      doc.status || 'created',
      JSON.stringify(doc)
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

// GET /api/billing/invoices/:id/pdf - fetch PDF content
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

module.exports = router;

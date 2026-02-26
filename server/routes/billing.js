const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const db = require('../database');

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

// Get current billing settings
const getBillingSettings = () => {
  return db.prepare('SELECT * FROM billing_settings WHERE id = 1').get();
};

// Generate PDF for invoice and save to disk
const generateInvoicePdf = (invoice, order, client) => {
  return new Promise((resolve, reject) => {
    const snapshot = invoice.raw_snapshot
      ? (typeof invoice.raw_snapshot === 'string'
          ? JSON.parse(invoice.raw_snapshot)
          : invoice.raw_snapshot)
      : {};

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
    doc.moveDown(1);

    // Client info
    doc.fontSize(11).font('Helvetica-Bold').text('Client:');
    doc.font('Helvetica').fontSize(10);
    if (client) {
      doc.text(client.nume || '-');
      if (client.cif) doc.text(`CIF: ${client.cif}`);
      if (client.nrRegCom) doc.text(`Reg. Com.: ${client.nrRegCom}`);
      if (client.localitate) doc.text(`${client.localitate}${client.judet ? ', ' + client.judet : ''}`);
    } else {
      doc.text(invoice.external_client_id || '-');
    }
    doc.moveDown(1);

    // Items table
    const items = snapshot.lines || snapshot.documentPositions || [];
    if (items.length > 0) {
      doc.fontSize(11).font('Helvetica-Bold').text('Produse:');
      doc.moveDown(0.3);

      const tableTop = doc.y;
      const col = { desc: 50, qty: 300, price: 370, total: 450 };

      // Table header
      doc.fontSize(9).font('Helvetica-Bold');
      doc.text('Descriere', col.desc, tableTop, { width: 240 });
      doc.text('Cant.', col.qty, tableTop, { width: 60, align: 'right' });
      doc.text('Preț', col.price, tableTop, { width: 70, align: 'right' });
      doc.text('Total', col.total, tableTop, { width: 70, align: 'right' });

      doc.moveTo(50, doc.y + 3).lineTo(540, doc.y + 3).stroke();
      doc.moveDown(0.5);

      doc.font('Helvetica').fontSize(9);
      for (const item of items) {
        const y = doc.y;
        const desc = item.description || item.descriere || '-';
        const qty = item.unitCount || item.quantity || '0';
        const price = item.price || '0.00';
        const total = item.total || formatNumber((parseFloat(qty) || 0) * (parseFloat(price) || 0));

        doc.text(desc, col.desc, y, { width: 240 });
        doc.text(String(qty), col.qty, y, { width: 60, align: 'right' });
        doc.text(String(price), col.price, y, { width: 70, align: 'right' });
        doc.text(String(total), col.total, y, { width: 70, align: 'right' });
        doc.moveDown(0.4);
      }

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
        clientName: client?.nume || null,
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
            invoice_number = ?, invoice_code = ?, updated_at = CURRENT_TIMESTAMP
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
          orderId
        );
        return db.prepare('SELECT * FROM billing_invoices WHERE order_id = ?').get(orderId);
      } else {
        const localId = `billing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        db.prepare(
          `INSERT INTO billing_invoices
            (id, order_id, series, document_date, external_client_id,
             total, total_vat, total_with_vat, status, raw_snapshot,
             invoice_number, invoice_code, export_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          'disabled'
        );
        return db.prepare('SELECT * FROM billing_invoices WHERE id = ?').get(localId);
      }
    });

    const invoiceRow = allocateAndStore();

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
    const { invoice_series, invoice_next_number, invoice_number_padding } = req.body;

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

    const updates = [];
    const params = [];
    if (invoice_series !== undefined) { updates.push('invoice_series = ?'); params.push(invoice_series.trim()); }
    if (invoice_next_number !== undefined) { updates.push('invoice_next_number = ?'); params.push(parseInt(invoice_next_number, 10)); }
    if (invoice_number_padding !== undefined) { updates.push('invoice_number_padding = ?'); params.push(parseInt(invoice_number_padding, 10)); }

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

module.exports = router;
module.exports.generateLocalInvoice = generateLocalInvoice;
// upsertLocalInvoice is an alias for generateLocalInvoice (creates or updates invoice for an order)
module.exports.upsertLocalInvoice = generateLocalInvoice;

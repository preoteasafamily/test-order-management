const express = require('express');
const router = express.Router();
const db = require('../database');
const rateLimit = require('express-rate-limit');

// Rate limiter for billing endpoints
const billingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

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

/**
 * Atomically allocate the next invoice number from company settings.
 * Returns { invoiceNumber, invoiceCode }.
 * Runs inside a transaction and increments the stored nextNumber.
 */
const allocateInvoiceNumber = db.transaction((series, padding) => {
  const configRow = db
    .prepare("SELECT value FROM app_config WHERE key = 'company'")
    .get();
  const config = configRow ? JSON.parse(configRow.value) : {};

  const currentSeries = series || config.invoiceSeries || 'FAC';
  const pad = parseInt(padding || config.invoiceNumberPadding, 10) || 6;

  // Guard: use MAX(invoice_number) for this series to prevent gaps/duplicates
  const maxRow = db
    .prepare(
      "SELECT MAX(invoice_number) as maxNum FROM billing_invoices WHERE series = ?"
    )
    .get(currentSeries);
  const maxDb = maxRow?.maxNum || 0;
  const nextFromConfig = parseInt(config.invoiceNextNumber, 10) || 1;
  const invoiceNumber = Math.max(nextFromConfig, maxDb + 1);

  // Increment nextNumber in config
  config.invoiceNextNumber = invoiceNumber + 1;
  config.invoiceSeries = currentSeries;
  db.prepare(
    "INSERT INTO app_config (key, value) VALUES ('company', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
  ).run(JSON.stringify(config));

  const invoiceCode = `${currentSeries}-${String(invoiceNumber).padStart(pad, '0')}`;
  return { invoiceNumber, invoiceCode, series: currentSeries };
});

/**
 * Upsert a local billing invoice for an order.
 * If invoice already exists, preserves invoice_number/invoice_code.
 * If new, allocates next number atomically.
 * Returns the local invoice record.
 */
const upsertLocalInvoice = (orderId) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw new Error('Order not found');

  // Check if invoice already exists for this order
  const existing = db
    .prepare('SELECT * FROM billing_invoices WHERE order_id = ?')
    .get(orderId);

  if (existing) {
    // Preserve existing invoice_number/invoice_code; just update snapshot
    const client = db
      .prepare('SELECT * FROM clients WHERE id = ?')
      .get(order.clientId);
    const products = db
      .prepare('SELECT * FROM products')
      .all()
      .map((p) => ({ ...p, prices: p.prices ? JSON.parse(p.prices) : {} }));
    const items = order.items ? JSON.parse(order.items) : [];
    const enrichedItems = items.map((item) => {
      const product = products.find((p) => p.id === item.productId);
      return { ...item, product: product || null };
    });

    const snapshot = {
      orderId,
      orderDate: order.date,
      client: client || { id: order.clientId },
      items: enrichedItems,
      total: order.total,
      totalTVA: order.totalTVA,
      totalWithVAT: order.totalWithVAT,
      invoice_number: existing.invoice_number,
      invoice_code: existing.invoice_code,
      series: existing.series,
    };

    db.prepare(
      `UPDATE billing_invoices SET
         total = ?, total_vat = ?, total_with_vat = ?,
         raw_snapshot = ?, updated_at = CURRENT_TIMESTAMP
       WHERE order_id = ?`
    ).run(
      order.total,
      order.totalTVA,
      order.totalWithVAT,
      JSON.stringify(snapshot),
      orderId
    );

    return db
      .prepare('SELECT * FROM billing_invoices WHERE order_id = ?')
      .get(orderId);
  }

  // New invoice: allocate number atomically
  const configRow = db
    .prepare("SELECT value FROM app_config WHERE key = 'company'")
    .get();
  const config = configRow ? JSON.parse(configRow.value) : {};
  const series = config.invoiceSeries || 'FAC';
  const padding = parseInt(config.invoiceNumberPadding, 10) || 6;

  const { invoiceNumber, invoiceCode } = allocateInvoiceNumber(
    series,
    padding
  );

  const client = db
    .prepare('SELECT * FROM clients WHERE id = ?')
    .get(order.clientId);
  const clientName = client?.nume || order.clientId;
  const documentDate = order.date || new Date().toISOString().split('T')[0];

  const products = db
    .prepare('SELECT * FROM products')
    .all()
    .map((p) => ({ ...p, prices: p.prices ? JSON.parse(p.prices) : {} }));
  const items = order.items ? JSON.parse(order.items) : [];
  const enrichedItems = items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    return { ...item, product: product || null };
  });

  const snapshot = {
    orderId,
    orderDate: order.date,
    client: client || { id: order.clientId },
    items: enrichedItems,
    total: order.total,
    totalTVA: order.totalTVA,
    totalWithVAT: order.totalWithVAT,
    invoice_number: invoiceNumber,
    invoice_code: invoiceCode,
    series,
  };

  const localId = `billing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  db.prepare(
    `INSERT INTO billing_invoices
      (id, order_id, series, document_date, total, total_vat, total_with_vat,
       status, raw_snapshot, invoice_number, invoice_code, client_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'local', ?, ?, ?, ?)`
  ).run(
    localId,
    orderId,
    series,
    documentDate,
    order.total,
    order.totalTVA,
    order.totalWithVAT,
    JSON.stringify(snapshot),
    invoiceNumber,
    invoiceCode,
    clientName
  );

  return db
    .prepare('SELECT * FROM billing_invoices WHERE id = ?')
    .get(localId);
};

// Export helper for use in server.js (attach to router so both are available)
router.upsertLocalInvoice = upsertLocalInvoice;

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

// POST /api/billing/local-invoices/from-order - create/return local invoice (no Factureaza)
router.post('/local-invoices/from-order', billingLimiter, (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId required' });

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    if (!order.validata) {
      return res.status(400).json({
        error: 'Order must be validated before generating invoice',
      });
    }

    const record = upsertLocalInvoice(orderId);
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

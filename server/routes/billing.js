const express = require('express');
const router = express.Router();
const db = require('../database');

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

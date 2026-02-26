const express = require('express');
const router = express.Router();
const db = require('../database');
const { requireAdmin } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// Rate limiter for company config endpoints
const configLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// Default company settings
const DEFAULT_COMPANY = {
  furnizorNume: '',
  furnizorCIF: '',
  furnizorNrRegCom: '',
  furnizorJudet: '',
  furnizorLocalitate: '',
  furnizorStrada: '',
  furnizorTelefon: '',
  furnizorEmail: '',
  furnizorBanca: '',
  furnizorIBAN: '',
  invoiceSeries: 'FAC',
  invoiceNextNumber: 1,
  invoiceNumberPadding: 6,
  receiptSeries: 'CN',
  lotNumberCurrent: 1,
  lotDate: null,
};

// GET /api/config/company - returns company settings (public)
router.get('/company', configLimiter, (req, res) => {
  try {
    const row = db.prepare("SELECT value FROM app_config WHERE key = 'company'").get();
    if (!row) {
      return res.json(DEFAULT_COMPANY);
    }
    const settings = JSON.parse(row.value);
    // Merge with defaults to ensure all fields are present
    res.json({ ...DEFAULT_COMPANY, ...settings });
  } catch (err) {
    console.error('Error getting company config:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/config/company - saves company settings (admin only)
router.put('/company', configLimiter, requireAdmin, (req, res) => {
  try {
    const settings = req.body;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      return res.status(400).json({ error: 'Invalid settings object' });
    }

    // Validate and sanitize string fields (max length 500 chars each)
    const STRING_FIELDS = [
      'furnizorNume', 'furnizorCIF', 'furnizorNrRegCom', 'furnizorJudet',
      'furnizorLocalitate', 'furnizorStrada', 'furnizorTelefon', 'furnizorEmail',
      'furnizorBanca', 'furnizorIBAN', 'invoiceSeries', 'receiptSeries', 'lotDate',
    ];
    for (const field of STRING_FIELDS) {
      if (settings[field] !== undefined && settings[field] !== null) {
        if (typeof settings[field] !== 'string') {
          return res.status(400).json({ error: `Field ${field} must be a string` });
        }
        if (settings[field].length > 500) {
          return res.status(400).json({ error: `Field ${field} exceeds maximum length` });
        }
      }
    }

    // Enforce integer types for numeric fields
    if (settings.invoiceNextNumber !== undefined) {
      settings.invoiceNextNumber = parseInt(settings.invoiceNextNumber, 10) || 1;
    }
    if (settings.invoiceNumberPadding !== undefined) {
      settings.invoiceNumberPadding = parseInt(settings.invoiceNumberPadding, 10) || 6;
    }

    const value = JSON.stringify(settings);
    db.prepare(
      "INSERT INTO app_config (key, value) VALUES ('company', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP"
    ).run(value);

    res.json({ ...DEFAULT_COMPANY, ...settings });
  } catch (err) {
    console.error('Error saving company config:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

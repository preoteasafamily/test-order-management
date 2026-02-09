const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/export-counters/:date - Get counter for specific date
router.get('/:date', (req, res) => {
  try {
    const { date } = req.params;
    const row = db.prepare('SELECT * FROM export_counters WHERE export_date = ?').get(date);
    
    if (!row) {
      // Return default counter if not found
      res.json({
        export_date: date,
        invoice_count: 0,
        receipt_count: 0,
        production_count: 0
      });
    } else {
      res.json(row);
    }
  } catch (err) {
    console.error('Error fetching export counter:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/export-counters - Create counter for a date
router.post('/', (req, res) => {
  try {
    const { export_date, invoice_count = 0, receipt_count = 0, production_count = 0 } = req.body;
    
    if (!export_date) {
      return res.status(400).json({ error: 'export_date is required' });
    }
    
    const result = db.prepare(
      'INSERT INTO export_counters (export_date, invoice_count, receipt_count, production_count) VALUES (?, ?, ?, ?)'
    ).run(export_date, invoice_count, receipt_count, production_count);
    
    const created = db.prepare('SELECT * FROM export_counters WHERE export_date = ?').get(export_date);
    res.json(created);
  } catch (err) {
    console.error('Error creating export counter:', err);
    if (err.message.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'Export counter for this date already exists' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// PUT /api/export-counters/:date - Increment counters for a date
router.put('/:date', (req, res) => {
  try {
    const { date } = req.params;
    const { invoice_count, receipt_count, production_count } = req.body;
    
    // Check if counter exists
    const existing = db.prepare('SELECT * FROM export_counters WHERE export_date = ?').get(date);
    
    if (!existing) {
      // Create new counter with the provided values
      db.prepare(
        'INSERT INTO export_counters (export_date, invoice_count, receipt_count, production_count) VALUES (?, ?, ?, ?)'
      ).run(
        date,
        invoice_count || 0,
        receipt_count || 0,
        production_count || 0
      );
    } else {
      // Update existing counter
      db.prepare(
        `UPDATE export_counters SET 
          invoice_count = ?, 
          receipt_count = ?, 
          production_count = ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE export_date = ?`
      ).run(
        invoice_count !== undefined ? invoice_count : existing.invoice_count,
        receipt_count !== undefined ? receipt_count : existing.receipt_count,
        production_count !== undefined ? production_count : existing.production_count,
        date
      );
    }
    
    const updated = db.prepare('SELECT * FROM export_counters WHERE export_date = ?').get(date);
    res.json(updated);
  } catch (err) {
    console.error('Error updating export counter:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/day-status/:date - Get day status for specific date
router.get('/:date', (req, res) => {
  try {
    const { date } = req.params;
    const row = db.prepare('SELECT * FROM day_status WHERE status_date = ?').get(date);
    
    if (!row) {
      // Return default status if not found
      res.json({
        status_date: date,
        production_exported: 0,
        exported_at: null,
        exported_by: null,
        lot_number: null,
        unlocked_at: null,
        unlocked_by: null
      });
    } else {
      // Convert INTEGER to boolean for production_exported
      res.json({
        ...row,
        production_exported: row.production_exported === 1
      });
    }
  } catch (err) {
    console.error('Error fetching day status:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/day-status - Create day status for a date
router.post('/', (req, res) => {
  try {
    const { status_date, production_exported = false, exported_at, exported_by, lot_number, unlocked_at, unlocked_by } = req.body;
    
    if (!status_date) {
      return res.status(400).json({ error: 'status_date is required' });
    }
    
    db.prepare(
      `INSERT INTO day_status 
       (status_date, production_exported, exported_at, exported_by, lot_number, unlocked_at, unlocked_by) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      status_date,
      production_exported ? 1 : 0,
      exported_at || null,
      exported_by || null,
      lot_number || null,
      unlocked_at || null,
      unlocked_by || null
    );
    
    const created = db.prepare('SELECT * FROM day_status WHERE status_date = ?').get(status_date);
    res.json({
      ...created,
      production_exported: created.production_exported === 1
    });
  } catch (err) {
    console.error('Error creating day status:', err);
    if (err.message.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'Day status for this date already exists' });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// PUT /api/day-status/:date - Update day status for a date
router.put('/:date', (req, res) => {
  try {
    const { date } = req.params;
    const { production_exported, exported_at, exported_by, lot_number, unlocked_at, unlocked_by } = req.body;
    
    // Check if status exists
    const existing = db.prepare('SELECT * FROM day_status WHERE status_date = ?').get(date);
    
    if (!existing) {
      // Create new status
      db.prepare(
        `INSERT INTO day_status 
         (status_date, production_exported, exported_at, exported_by, lot_number, unlocked_at, unlocked_by) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(
        date,
        production_exported ? 1 : 0,
        exported_at || null,
        exported_by || null,
        lot_number || null,
        unlocked_at || null,
        unlocked_by || null
      );
    } else {
      // Update existing status
      db.prepare(
        `UPDATE day_status SET 
          production_exported = ?, 
          exported_at = ?, 
          exported_by = ?, 
          lot_number = ?,
          unlocked_at = ?,
          unlocked_by = ?,
          updated_at = CURRENT_TIMESTAMP
         WHERE status_date = ?`
      ).run(
        production_exported !== undefined ? (production_exported ? 1 : 0) : existing.production_exported,
        exported_at !== undefined ? exported_at : existing.exported_at,
        exported_by !== undefined ? exported_by : existing.exported_by,
        lot_number !== undefined ? lot_number : existing.lot_number,
        unlocked_at !== undefined ? unlocked_at : existing.unlocked_at,
        unlocked_by !== undefined ? unlocked_by : existing.unlocked_by,
        date
      );
    }
    
    const updated = db.prepare('SELECT * FROM day_status WHERE status_date = ?').get(date);
    res.json({
      ...updated,
      production_exported: updated.production_exported === 1
    });
  } catch (err) {
    console.error('Error updating day status:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/day-status/:date - Delete day status for a date
router.delete('/:date', (req, res) => {
  try {
    const { date } = req.params;
    const result = db.prepare('DELETE FROM day_status WHERE status_date = ?').run(date);
    
    if (result.changes === 0) {
      res.status(404).json({ error: 'Day status not found' });
    } else {
      res.json({ success: true });
    }
  } catch (err) {
    console.error('Error deleting day status:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

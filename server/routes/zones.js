const express = require('express');
const router = express.Router();
const db = require('../database');

// Get all zones
router.get('/', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM zones ORDER BY name').all();
        res.status(200).json(rows || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create zone
router.post('/', (req, res) => {
    const newZone = req.body;
    
    if (!newZone.name) {
        return res.status(400).json({ error: 'Zone name is required' });
    }
    
    try {
        const stmt = db.prepare(
            `INSERT INTO zones (id, code, name, description) VALUES (?, ?, ?, ?)`
        );
        stmt.run(
            newZone.id,
            newZone.code,
            newZone.name,
            newZone.description || null
        );
        res.status(201).json(newZone);
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            res.status(400).json({ error: 'Zone code already exists' });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

// Update zone
router.put('/:id', (req, res) => {
    const { id } = req.params;
    const updatedZone = req.body;
    
    try {
        const stmt = db.prepare(
            `UPDATE zones SET code = ?, name = ?, description = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`
        );
        const result = stmt.run(
            updatedZone.code,
            updatedZone.name,
            updatedZone.description || null,
            id
        );
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Zone not found' });
        }
        
        res.status(200).json(updatedZone);
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            res.status(400).json({ error: 'Zone code already exists' });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

// Delete zone
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    
    try {
        const stmt = db.prepare('DELETE FROM zones WHERE id = ?');
        const result = stmt.run(id);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Zone not found' });
        }
        
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
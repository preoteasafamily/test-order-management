const express = require('express');
const router = express.Router();
const db = require('../database');

// Get all agents
router.get('/', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM agents ORDER BY name').all();
        // Parse JSON fields
        const agents = (rows || []).map(row => ({
            ...row,
            zones: row.zones ? JSON.parse(row.zones) : []
        }));
        res.json({ success: true, data: agents });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get single agent
router.get('/:id', (req, res) => {
    try {
        const row = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id);
        if (!row) {
            res.status(404).json({ success: false, error: 'Agent not found' });
        } else {
            const agent = {
                ...row,
                zones: row.zones ? JSON.parse(row.zones) : []
            };
            res.json({ success: true, data: agent });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create agent
router.post('/', (req, res) => {
    const agent = req.body;
    
    if (!agent.id || !agent.code || !agent.name) {
        return res.status(400).json({ success: false, error: 'ID, code, and name are required' });
    }
    
    try {
        const stmt = db.prepare(
            `INSERT INTO agents (id, code, name, user_id, status, zones) VALUES (?, ?, ?, ?, ?, ?)`
        );
        stmt.run(
            agent.id,
            agent.code,
            agent.name,
            agent.user_id || null,
            agent.status || 'active',
            JSON.stringify(agent.zones || [])
        );
        res.json({ 
            success: true, 
            data: { 
                ...agent, 
                createdAt: new Date().toISOString() 
            },
            message: 'Agent created successfully'
        });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            res.status(400).json({ success: false, error: 'Agent code already exists' });
        } else {
            res.status(500).json({ success: false, error: err.message });
        }
    }
});

// Update agent
router.put('/:id', (req, res) => {
    const agent = req.body;
    
    if (!agent.code || !agent.name) {
        return res.status(400).json({ success: false, error: 'Code and name are required' });
    }
    
    try {
        const stmt = db.prepare(
            `UPDATE agents SET 
                code = ?, name = ?, user_id = ?, status = ?, zones = ?, updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?`
        );
        const result = stmt.run(
            agent.code,
            agent.name,
            agent.user_id || null,
            agent.status || 'active',
            JSON.stringify(agent.zones || []),
            req.params.id
        );
        if (result.changes === 0) {
            res.status(404).json({ success: false, error: 'Agent not found' });
        } else {
            res.json({ success: true, message: 'Agent updated successfully' });
        }
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            res.status(400).json({ success: false, error: 'Agent code already exists' });
        } else {
            res.status(500).json({ success: false, error: err.message });
        }
    }
});

// Delete agent
router.delete('/:id', (req, res) => {
    try {
        const stmt = db.prepare('DELETE FROM agents WHERE id = ?');
        const result = stmt.run(req.params.id);
        if (result.changes === 0) {
            res.status(404).json({ success: false, error: 'Agent not found' });
        } else {
            res.json({ success: true, message: 'Agent deleted successfully' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

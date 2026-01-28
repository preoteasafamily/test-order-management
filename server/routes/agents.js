const express = require('express');
const router = express.Router();
const db = require('../database');

// Get all agents
router.get('/', (req, res) => {
    db.all('SELECT * FROM agents ORDER BY name', [], (err, rows) => {
        if (err) {
            res.status(500).json({ success: false, error: err.message });
        } else {
            // Parse JSON fields
            const agents = (rows || []).map(row => ({
                ...row,
                zones: row.zones ? JSON.parse(row.zones) : []
            }));
            res.json({ success: true, data: agents });
        }
    });
});

// Get single agent
router.get('/:id', (req, res) => {
    db.get('SELECT * FROM agents WHERE id = ?', [req.params.id], (err, row) => {
        if (err) {
            res.status(500).json({ success: false, error: err.message });
        } else if (!row) {
            res.status(404).json({ success: false, error: 'Agent not found' });
        } else {
            const agent = {
                ...row,
                zones: row.zones ? JSON.parse(row.zones) : []
            };
            res.json({ success: true, data: agent });
        }
    });
});

// Create agent
router.post('/', (req, res) => {
    const agent = req.body;
    
    if (!agent.id || !agent.code || !agent.name) {
        return res.status(400).json({ success: false, error: 'ID, code, and name are required' });
    }
    
    db.run(
        `INSERT INTO agents (id, code, name, status, zones) VALUES (?, ?, ?, ?, ?)`,
        [
            agent.id,
            agent.code,
            agent.name,
            agent.status || 'active',
            JSON.stringify(agent.zones || [])
        ],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    res.status(400).json({ success: false, error: 'Agent code already exists' });
                } else {
                    res.status(500).json({ success: false, error: err.message });
                }
            } else {
                res.json({ 
                    success: true, 
                    data: { 
                        ...agent, 
                        createdAt: new Date().toISOString() 
                    },
                    message: 'Agent created successfully'
                });
            }
        }
    );
});

// Update agent
router.put('/:id', (req, res) => {
    const agent = req.body;
    
    if (!agent.code || !agent.name) {
        return res.status(400).json({ success: false, error: 'Code and name are required' });
    }
    
    db.run(
        `UPDATE agents SET 
            code = ?, name = ?, status = ?, zones = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?`,
        [
            agent.code,
            agent.name,
            agent.status || 'active',
            JSON.stringify(agent.zones || []),
            req.params.id
        ],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    res.status(400).json({ success: false, error: 'Agent code already exists' });
                } else {
                    res.status(500).json({ success: false, error: err.message });
                }
            } else if (this.changes === 0) {
                res.status(404).json({ success: false, error: 'Agent not found' });
            } else {
                res.json({ success: true, message: 'Agent updated successfully' });
            }
        }
    );
});

// Delete agent
router.delete('/:id', (req, res) => {
    db.run('DELETE FROM agents WHERE id = ?', [req.params.id], function(err) {
        if (err) {
            res.status(500).json({ success: false, error: err.message });
        } else if (this.changes === 0) {
            res.status(404).json({ success: false, error: 'Agent not found' });
        } else {
            res.json({ success: true, message: 'Agent deleted successfully' });
        }
    });
});

module.exports = router;

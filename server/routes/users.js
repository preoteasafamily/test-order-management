const express = require('express');
const router = express.Router();
const db = require('../database');
const crypto = require('crypto');

// Simple password hashing function (using SHA256 with salt)
// Note: In production, use bcrypt or argon2 for better security
function hashPassword(password) {
    // Add a salt to make the hash more secure
    const salt = 'order-management-salt-2026'; // In production, use a random salt per user
    return crypto.createHash('sha256').update(password + salt).digest('hex');
}

// Get all users
router.get('/', (req, res) => {
    try {
        const rows = db.prepare('SELECT id, username, role, name, agent_id, status, createdAt, updatedAt FROM users ORDER BY name').all();
        res.json({ success: true, data: rows || [] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get single user
router.get('/:id', (req, res) => {
    try {
        const row = db.prepare('SELECT id, username, role, name, agent_id, status, createdAt, updatedAt FROM users WHERE id = ?').get(req.params.id);
        if (!row) {
            res.status(404).json({ success: false, error: 'User not found' });
        } else {
            res.json({ success: true, data: row });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create user
router.post('/', (req, res) => {
    const user = req.body;
    
    if (!user.id || !user.username || !user.password || !user.role || !user.name) {
        return res.status(400).json({ success: false, error: 'ID, username, password, role, and name are required' });
    }

    // Validate role
    const validRoles = ['admin', 'birou', 'agent'];
    if (!validRoles.includes(user.role)) {
        return res.status(400).json({ success: false, error: 'Invalid role. Must be admin, birou, or agent' });
    }
    
    const hashedPassword = hashPassword(user.password);
    
    try {
        const stmt = db.prepare(
            `INSERT INTO users (id, username, password, role, name, agent_id, status) VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        stmt.run(
            user.id,
            user.username,
            hashedPassword,
            user.role,
            user.name,
            user.agent_id || null,
            user.status || 'active'
        );
        res.json({ 
            success: true, 
            data: { 
                id: user.id,
                username: user.username,
                role: user.role,
                name: user.name,
                agent_id: user.agent_id,
                status: user.status || 'active',
                createdAt: new Date().toISOString() 
            },
            message: 'User created successfully'
        });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            res.status(400).json({ success: false, error: 'Username already exists' });
        } else {
            res.status(500).json({ success: false, error: err.message });
        }
    }
});

// Update user
router.put('/:id', (req, res) => {
    const user = req.body;
    
    if (!user.username || !user.role || !user.name) {
        return res.status(400).json({ success: false, error: 'Username, role, and name are required' });
    }

    // Validate role
    const validRoles = ['admin', 'birou', 'agent'];
    if (!validRoles.includes(user.role)) {
        return res.status(400).json({ success: false, error: 'Invalid role. Must be admin, birou, or agent' });
    }
    
    try {
        let stmt, result;
        
        // If password is provided, update it as well
        if (user.password) {
            const hashedPassword = hashPassword(user.password);
            stmt = db.prepare(`UPDATE users SET 
                username = ?, password = ?, role = ?, name = ?, agent_id = ?, status = ?, updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?`);
            result = stmt.run(user.username, hashedPassword, user.role, user.name, user.agent_id || null, user.status || 'active', req.params.id);
        } else {
            stmt = db.prepare(`UPDATE users SET 
                username = ?, role = ?, name = ?, agent_id = ?, status = ?, updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?`);
            result = stmt.run(user.username, user.role, user.name, user.agent_id || null, user.status || 'active', req.params.id);
        }
        
        if (result.changes === 0) {
            res.status(404).json({ success: false, error: 'User not found' });
        } else {
            res.json({ success: true, message: 'User updated successfully' });
        }
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            res.status(400).json({ success: false, error: 'Username already exists' });
        } else {
            res.status(500).json({ success: false, error: err.message });
        }
    }
});

// Delete user
router.delete('/:id', (req, res) => {
    try {
        const stmt = db.prepare('DELETE FROM users WHERE id = ?');
        const result = stmt.run(req.params.id);
        if (result.changes === 0) {
            res.status(404).json({ success: false, error: 'User not found' });
        } else {
            res.json({ success: true, message: 'User deleted successfully' });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

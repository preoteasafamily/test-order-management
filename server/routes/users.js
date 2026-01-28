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
    db.all('SELECT id, username, role, name, status, createdAt, updatedAt FROM users ORDER BY name', [], (err, rows) => {
        if (err) {
            res.status(500).json({ success: false, error: err.message });
        } else {
            res.json({ success: true, data: rows || [] });
        }
    });
});

// Get single user
router.get('/:id', (req, res) => {
    db.get('SELECT id, username, role, name, status, createdAt, updatedAt FROM users WHERE id = ?', [req.params.id], (err, row) => {
        if (err) {
            res.status(500).json({ success: false, error: err.message });
        } else if (!row) {
            res.status(404).json({ success: false, error: 'User not found' });
        } else {
            res.json({ success: true, data: row });
        }
    });
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
    
    db.run(
        `INSERT INTO users (id, username, password, role, name, status) VALUES (?, ?, ?, ?, ?, ?)`,
        [
            user.id,
            user.username,
            hashedPassword,
            user.role,
            user.name,
            user.status || 'active'
        ],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    res.status(400).json({ success: false, error: 'Username already exists' });
                } else {
                    res.status(500).json({ success: false, error: err.message });
                }
            } else {
                res.json({ 
                    success: true, 
                    data: { 
                        id: user.id,
                        username: user.username,
                        role: user.role,
                        name: user.name,
                        status: user.status || 'active',
                        createdAt: new Date().toISOString() 
                    },
                    message: 'User created successfully'
                });
            }
        }
    );
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
    
    let query, params;
    
    // If password is provided, update it as well
    if (user.password) {
        const hashedPassword = hashPassword(user.password);
        query = `UPDATE users SET 
            username = ?, password = ?, role = ?, name = ?, status = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?`;
        params = [user.username, hashedPassword, user.role, user.name, user.status || 'active', req.params.id];
    } else {
        query = `UPDATE users SET 
            username = ?, role = ?, name = ?, status = ?, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?`;
        params = [user.username, user.role, user.name, user.status || 'active', req.params.id];
    }
    
    db.run(query, params, function(err) {
        if (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                res.status(400).json({ success: false, error: 'Username already exists' });
            } else {
                res.status(500).json({ success: false, error: err.message });
            }
        } else if (this.changes === 0) {
            res.status(404).json({ success: false, error: 'User not found' });
        } else {
            res.json({ success: true, message: 'User updated successfully' });
        }
    });
});

// Delete user
router.delete('/:id', (req, res) => {
    db.run('DELETE FROM users WHERE id = ?', [req.params.id], function(err) {
        if (err) {
            res.status(500).json({ success: false, error: err.message });
        } else if (this.changes === 0) {
            res.status(404).json({ success: false, error: 'User not found' });
        } else {
            res.json({ success: true, message: 'User deleted successfully' });
        }
    });
});

module.exports = router;

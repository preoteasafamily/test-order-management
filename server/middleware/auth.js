const db = require('../database');

/**
 * Middleware to check if user is authenticated and has admin role
 * Expects Authorization header with format: "Bearer token_userId_timestamp"
 */
function requireAdmin(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        
        if (!authHeader) {
            return res.status(401).json({ error: 'No authorization header provided' });
        }

        // Extract token from "Bearer token_userId_timestamp" format
        const token = authHeader.replace('Bearer ', '');
        
        if (!token || !token.startsWith('token_')) {
            return res.status(401).json({ error: 'Invalid token format' });
        }

        // Extract userId from token (format: token_userId_timestamp)
        const parts = token.split('_');
        if (parts.length < 2) {
            return res.status(401).json({ error: 'Invalid token format' });
        }
        
        const userId = parts[1];
        
        // Get user from database
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        if (user.status !== 'active') {
            return res.status(403).json({ error: 'User account is not active' });
        }

        if (user.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }

        // Attach user to request for use in route handlers
        req.user = {
            id: user.id,
            username: user.username,
            name: user.name,
            role: user.role
        };

        next();
    } catch (err) {
        return res.status(500).json({ error: 'Authentication error: ' + err.message });
    }
}

module.exports = { requireAdmin };

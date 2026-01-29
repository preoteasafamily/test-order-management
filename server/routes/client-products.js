const express = require('express');
const router = express.Router();
const db = require('../database');

// GET /api/clients/:clientId/products - Get active products for a client
router.get('/:clientId/products', (req, res) => {
  try {
    const { clientId } = req.params;
    
    // Get all products with their active status for this client
    const query = `
      SELECT 
        p.*,
        COALESCE(cp.is_active, 1) as is_active
      FROM products p
      LEFT JOIN client_products cp ON p.id = cp.product_id AND cp.client_id = ?
      WHERE COALESCE(cp.is_active, 1) = 1
      ORDER BY p.descriere
    `;
    
    const rows = db.prepare(query).all(clientId);
    
    // Parse JSON fields
    const products = rows.map(row => ({
      ...row,
      prices: row.prices ? JSON.parse(row.prices) : {},
      is_active: row.is_active === 1
    }));
    
    res.json(products);
  } catch (err) {
    console.error('Error getting client products:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:clientId/products/all - Get ALL products with status for a client
router.get('/:clientId/products/all', (req, res) => {
  try {
    const { clientId } = req.params;
    
    // Get all products with their active status for this client
    const query = `
      SELECT 
        p.*,
        COALESCE(cp.is_active, 1) as is_active
      FROM products p
      LEFT JOIN client_products cp ON p.id = cp.product_id AND cp.client_id = ?
      ORDER BY p.descriere
    `;
    
    const rows = db.prepare(query).all(clientId);
    
    // Parse JSON fields
    const products = rows.map(row => ({
      ...row,
      prices: row.prices ? JSON.parse(row.prices) : {},
      is_active: row.is_active === 1
    }));
    
    res.json(products);
  } catch (err) {
    console.error('Error getting all client products:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/clients/:clientId/products/:productId - Toggle product active status
router.put('/:clientId/products/:productId', (req, res) => {
  try {
    const { clientId, productId } = req.params;
    const { is_active } = req.body;
    
    // Check if entry exists
    const existing = db.prepare(
      'SELECT * FROM client_products WHERE client_id = ? AND product_id = ?'
    ).get(clientId, productId);
    
    if (existing) {
      // Update existing entry
      db.prepare(
        'UPDATE client_products SET is_active = ?, updatedAt = CURRENT_TIMESTAMP WHERE client_id = ? AND product_id = ?'
      ).run(is_active ? 1 : 0, clientId, productId);
    } else {
      // Insert new entry
      db.prepare(
        'INSERT INTO client_products (client_id, product_id, is_active) VALUES (?, ?, ?)'
      ).run(clientId, productId, is_active ? 1 : 0);
    }
    
    res.json({ success: true, is_active });
  } catch (err) {
    console.error('Error toggling product:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:clientId/products/bulk - Bulk update products
router.post('/:clientId/products/bulk', (req, res) => {
  try {
    const { clientId } = req.params;
    const { productIds, is_active } = req.body;
    
    if (!Array.isArray(productIds)) {
      return res.status(400).json({ error: 'productIds must be an array' });
    }
    
    // Use a transaction for bulk operations
    const updateMany = db.transaction((ids, active) => {
      for (const productId of ids) {
        const existing = db.prepare(
          'SELECT * FROM client_products WHERE client_id = ? AND product_id = ?'
        ).get(clientId, productId);
        
        if (existing) {
          db.prepare(
            'UPDATE client_products SET is_active = ?, updatedAt = CURRENT_TIMESTAMP WHERE client_id = ? AND product_id = ?'
          ).run(active ? 1 : 0, clientId, productId);
        } else {
          db.prepare(
            'INSERT INTO client_products (client_id, product_id, is_active) VALUES (?, ?, ?)'
          ).run(clientId, productId, active ? 1 : 0);
        }
      }
    });
    
    updateMany(productIds, is_active);
    
    res.json({ success: true, updated: productIds.length });
  } catch (err) {
    console.error('Error bulk updating products:', err);
    res.status(500).json({ error: err.message });
  }
});

// Helper function to initialize client products when a new client is created
// This will be called from the clients endpoint
const initializeClientProducts = (clientId) => {
  try {
    // Get all products
    const products = db.prepare('SELECT id FROM products').all();
    
    // Insert all products as active for this client (if not already exists)
    const insert = db.prepare(`
      INSERT OR IGNORE INTO client_products (client_id, product_id, is_active)
      VALUES (?, ?, 1)
    `);
    
    const insertMany = db.transaction((client, prods) => {
      for (const product of prods) {
        insert.run(client, product.id);
      }
    });
    
    insertMany(clientId, products);
    
    return true;
  } catch (err) {
    console.error('Error initializing client products:', err);
    return false;
  }
};

module.exports = router;
module.exports.initializeClientProducts = initializeClientProducts;

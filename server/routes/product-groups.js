const express = require('express');
const router = express.Router();
const db = require('../database');

// Get all product groups
router.get('/', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM product_groups ORDER BY name').all();
        // Parse JSON fields
        const productGroups = (rows || []).map(row => ({
            ...row,
            productIds: row.productIds ? JSON.parse(row.productIds) : []
        }));
        res.status(200).json(productGroups);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create product group
router.post('/', (req, res) => {
    const newGroup = req.body;
    
    if (!newGroup.name || !newGroup.productIds || !Array.isArray(newGroup.productIds)) {
        return res.status(400).json({ error: 'Name and productIds array are required' });
    }
    
    if (newGroup.productIds.length === 0) {
        return res.status(400).json({ error: 'At least one product is required' });
    }
    
    if (typeof newGroup.price !== 'number' || newGroup.price <= 0) {
        return res.status(400).json({ error: 'Valid price greater than 0 is required' });
    }
    
    if (typeof newGroup.cotaTVA !== 'number' || newGroup.cotaTVA < 0) {
        return res.status(400).json({ error: 'Valid cotaTVA is required' });
    }
    
    try {
        const stmt = db.prepare(
            `INSERT INTO product_groups (id, name, productIds, price, cotaTVA) VALUES (?, ?, ?, ?, ?)`
        );
        stmt.run(
            newGroup.id,
            newGroup.name,
            JSON.stringify(newGroup.productIds),
            newGroup.price,
            newGroup.cotaTVA
        );
        res.status(201).json(newGroup);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update product group
router.put('/:id', (req, res) => {
    const { id } = req.params;
    const updatedGroup = req.body;
    
    if (!updatedGroup.name || !updatedGroup.productIds || !Array.isArray(updatedGroup.productIds)) {
        return res.status(400).json({ error: 'Name and productIds array are required' });
    }
    
    if (updatedGroup.productIds.length === 0) {
        return res.status(400).json({ error: 'At least one product is required' });
    }
    
    if (typeof updatedGroup.price !== 'number' || updatedGroup.price <= 0) {
        return res.status(400).json({ error: 'Valid price greater than 0 is required' });
    }
    
    if (typeof updatedGroup.cotaTVA !== 'number' || updatedGroup.cotaTVA < 0) {
        return res.status(400).json({ error: 'Valid cotaTVA is required' });
    }
    
    try {
        const stmt = db.prepare(
            `UPDATE product_groups SET name = ?, productIds = ?, price = ?, cotaTVA = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`
        );
        const result = stmt.run(
            updatedGroup.name,
            JSON.stringify(updatedGroup.productIds),
            updatedGroup.price,
            updatedGroup.cotaTVA,
            id
        );
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Product group not found' });
        }
        
        res.status(200).json(updatedGroup);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete product group
router.delete('/:id', (req, res) => {
    const { id } = req.params;
    
    try {
        const stmt = db.prepare('DELETE FROM product_groups WHERE id = ?');
        const result = stmt.run(id);
        
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Product group not found' });
        }
        
        res.status(204).send();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

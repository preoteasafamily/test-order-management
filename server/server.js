require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./database');

// Import route modules
const agentsRouter = require('./routes/agents');
const usersRouter = require('./routes/users');
const zonesRouter = require('./routes/zones');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Mount route modules
app.use('/api/agents', agentsRouter);
app.use('/api/users', usersRouter);
app.use('/api/zones', zonesRouter);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Get all orders
app.get('/api/orders', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM orders ORDER BY createdAt DESC').all();
        res.json(rows || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create order
app.post('/api/orders', (req, res) => {
    const { title, description } = req.body;
    if (!title) {
        return res.status(400).json({ error: 'Title is required' });
    }
    
    try {
        const result = db.prepare('INSERT INTO orders (title, description) VALUES (?, ?)').run(title, description);
        res.json({ 
            id: result.lastInsertRowid, 
            title, 
            description, 
            status: 'pending',
            createdAt: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update order
app.put('/api/orders/:id', (req, res) => {
    const { status } = req.body;
    if (!status) {
        return res.status(400).json({ error: 'Status is required' });
    }
    
    try {
        const result = db.prepare('UPDATE orders SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?').run(status, req.params.id);
        if (result.changes === 0) {
            res.status(404).json({ error: 'Order not found' });
        } else {
            res.json({ success: true });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete order
app.delete('/api/orders/:id', (req, res) => {
    try {
        const result = db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
        if (result.changes === 0) {
            res.status(404).json({ error: 'Order not found' });
        } else {
            res.json({ success: true });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ CLIENTS ENDPOINTS ============

// Get all clients
app.get('/api/clients', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM clients ORDER BY nume').all();
        // Parse JSON fields
        const clients = (rows || []).map(row => ({
            ...row,
            afiseazaKG: row.afiseazaKG === 1,
            productCodes: row.productCodes ? JSON.parse(row.productCodes) : {}
        }));
        res.json(clients);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single client
app.get('/api/clients/:id', (req, res) => {
    try {
        const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
        if (!row) {
            res.status(404).json({ error: 'Client not found' });
        } else {
            const client = {
                ...row,
                afiseazaKG: row.afiseazaKG === 1,
                productCodes: row.productCodes ? JSON.parse(row.productCodes) : {}
            };
            res.json(client);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create client
app.post('/api/clients', (req, res) => {
    const client = req.body;
    
    if (!client.id || !client.nume) {
        return res.status(400).json({ error: 'ID and nume are required' });
    }
    
    try {
        const result = db.prepare(
            `INSERT INTO clients (
                id, nume, cif, nrRegCom, codContabil, judet, localitate, strada, 
                codPostal, telefon, email, banca, iban, agentId, priceZone, 
                afiseazaKG, productCodes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            client.id, client.nume, client.cif, client.nrRegCom, client.codContabil,
            client.judet, client.localitate, client.strada, client.codPostal,
            client.telefon, client.email, client.banca, client.iban, client.agentId,
            client.priceZone, client.afiseazaKG ? 1 : 0, 
            JSON.stringify(client.productCodes || {})
        );
        res.json({ ...client, createdAt: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update client
app.put('/api/clients/:id', (req, res) => {
    const client = req.body;
    
    if (!client.nume) {
        return res.status(400).json({ error: 'nume is required' });
    }
    
    try {
        const result = db.prepare(
            `UPDATE clients SET 
                nume = ?, cif = ?, nrRegCom = ?, codContabil = ?, judet = ?, 
                localitate = ?, strada = ?, codPostal = ?, telefon = ?, email = ?, 
                banca = ?, iban = ?, agentId = ?, priceZone = ?, afiseazaKG = ?, 
                productCodes = ?, updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?`
        ).run(
            client.nume, client.cif, client.nrRegCom, client.codContabil, client.judet,
            client.localitate, client.strada, client.codPostal, client.telefon,
            client.email, client.banca, client.iban, client.agentId, client.priceZone,
            client.afiseazaKG ? 1 : 0, JSON.stringify(client.productCodes || {}),
            req.params.id
        );
        if (result.changes === 0) {
            res.status(404).json({ error: 'Client not found' });
        } else {
            res.json({ success: true });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete client
app.delete('/api/clients/:id', (req, res) => {
    try {
        const result = db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
        if (result.changes === 0) {
            res.status(404).json({ error: 'Client not found' });
        } else {
            res.json({ success: true });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============ PRODUCTS ENDPOINTS ============

// Get all products
app.get('/api/products', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM products ORDER BY descriere').all();
        // Parse JSON fields
        const products = (rows || []).map(row => ({
            ...row,
            prices: row.prices ? JSON.parse(row.prices) : {}
        }));
        res.json(products);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single product
app.get('/api/products/:id', (req, res) => {
    try {
        const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
        if (!row) {
            res.status(404).json({ error: 'Product not found' });
        } else {
            const product = {
                ...row,
                prices: row.prices ? JSON.parse(row.prices) : {}
            };
            res.json(product);
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create product
app.post('/api/products', (req, res) => {
    const product = req.body;
    
    if (!product.id || !product.descriere) {
        return res.status(400).json({ error: 'ID and descriere are required' });
    }
    
    try {
        const result = db.prepare(
            `INSERT INTO products (
                id, codArticolFurnizor, codProductie, codBare, descriere, 
                um, gestiune, gramajKg, cotaTVA, prices
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            product.id, product.codArticolFurnizor, product.codProductie, 
            product.codBare, product.descriere, product.um, product.gestiune,
            product.gramajKg, product.cotaTVA, JSON.stringify(product.prices || {})
        );
        res.json({ ...product, createdAt: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update product
app.put('/api/products/:id', (req, res) => {
    const product = req.body;
    
    if (!product.descriere) {
        return res.status(400).json({ error: 'descriere is required' });
    }
    
    try {
        const result = db.prepare(
            `UPDATE products SET 
                codArticolFurnizor = ?, codProductie = ?, codBare = ?, descriere = ?, 
                um = ?, gestiune = ?, gramajKg = ?, cotaTVA = ?, prices = ?,
                updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?`
        ).run(
            product.codArticolFurnizor, product.codProductie, product.codBare,
            product.descriere, product.um, product.gestiune, product.gramajKg,
            product.cotaTVA, JSON.stringify(product.prices || {}), req.params.id
        );
        if (result.changes === 0) {
            res.status(404).json({ error: 'Product not found' });
        } else {
            res.json({ success: true });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete product
app.delete('/api/products/:id', (req, res) => {
    try {
        const result = db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
        if (result.changes === 0) {
            res.status(404).json({ error: 'Product not found' });
        } else {
            res.json({ success: true });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});

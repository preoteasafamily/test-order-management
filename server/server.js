require('dotenv').config();
const express = require('express');
const cors = require('cors');
const db = require('./database');

// Import route modules
const agentsRouter = require('./routes/agents');
const usersRouter = require('./routes/users');
const zonesRouter = require('./routes/zones');
const authRouter = require('./routes/auth');
const clientProductsRouter = require('./routes/client-products');
const { initializeClientProducts } = require('./routes/client-products');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Mount route modules
app.use('/api/agents', agentsRouter);
app.use('/api/users', usersRouter);
app.use('/api/zones', zonesRouter);
app.use('/api/auth', authRouter);
app.use('/api/clients', clientProductsRouter);

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Get all orders
app.get('/api/orders', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM orders ORDER BY date DESC, createdAt DESC').all();
        // Parse JSON fields with error handling
        const orders = (rows || []).map(row => {
            let items = [];
            try {
                items = row.items ? JSON.parse(row.items) : [];
            } catch (parseErr) {
                console.error(`Failed to parse items for order ${row.id}:`, parseErr);
            }
            
            return {
                ...row,
                invoiceExported: row.invoiceExported === 1,
                receiptExported: row.receiptExported === 1,
                items
            };
        });
        res.json(orders);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create order
app.post('/api/orders', (req, res) => {
    const order = req.body;
    
    if (!order.id || !order.date || !order.clientId) {
        return res.status(400).json({ error: 'id, date, and clientId are required' });
    }
    
    try {
        const result = db.prepare(
            `INSERT INTO orders (
                id, date, clientId, agentId, paymentType, dueDate, items,
                total, totalTVA, totalWithVAT, invoiceExported, receiptExported
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            order.id,
            order.date,
            order.clientId,
            order.agentId || null,
            order.paymentType || 'immediate',
            order.dueDate || null,
            JSON.stringify(order.items || []),
            order.total || 0,
            order.totalTVA || 0,
            order.totalWithVAT || 0,
            order.invoiceExported ? 1 : 0,
            order.receiptExported ? 1 : 0
        );
        res.json({ ...order, createdAt: new Date().toISOString() });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed') || err.message.includes('PRIMARY KEY')) {
            res.status(409).json({ error: 'Order with this ID already exists' });
        } else {
            res.status(500).json({ error: err.message });
        }
    }
});

// Update order
app.put('/api/orders/:id', (req, res) => {
    const order = req.body;
    
    if (!order.date || !order.clientId) {
        return res.status(400).json({ error: 'date and clientId are required' });
    }
    
    try {
        const result = db.prepare(
            `UPDATE orders SET 
                date = ?, clientId = ?, agentId = ?, paymentType = ?, dueDate = ?,
                items = ?, total = ?, totalTVA = ?, totalWithVAT = ?,
                invoiceExported = ?, receiptExported = ?, updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?`
        ).run(
            order.date,
            order.clientId,
            order.agentId || null,
            order.paymentType || 'immediate',
            order.dueDate || null,
            JSON.stringify(order.items || []),
            order.total || 0,
            order.totalTVA || 0,
            order.totalWithVAT || 0,
            order.invoiceExported ? 1 : 0,
            order.receiptExported ? 1 : 0,
            req.params.id
        );
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
        
        // Initialize all products as active for this new client
        initializeClientProducts(client.id);
        
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
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
});

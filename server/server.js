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
const csvRouter = require('./routes/csv');
const { initializeClientProducts } = require('./routes/client-products');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for CSV uploads

// Mount route modules
app.use('/api/agents', agentsRouter);
app.use('/api/users', usersRouter);
app.use('/api/zones', zonesRouter);
app.use('/api/auth', authRouter);
app.use('/api/clients', clientProductsRouter);
app.use('/api/csv', csvRouter);

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
            // Fetch the updated order
            const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
            const updatedOrder = {
                ...row,
                invoiceExported: row.invoiceExported === 1,
                receiptExported: row.receiptExported === 1,
                items: row.items ? JSON.parse(row.items) : []
            };
            res.json(updatedOrder);
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
            productCodes: row.productCodes ? JSON.parse(row.productCodes) : {},
            status: row.status || 'active',
            activeFrom: row.activeFrom || null,
            activeTo: row.activeTo || null
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
                productCodes: row.productCodes ? JSON.parse(row.productCodes) : {},
                status: row.status || 'active',
                activeFrom: row.activeFrom || null,
                activeTo: row.activeTo || null
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
    
    // Validate required fields
    if (!client.id || !client.nume) {
        return res.status(400).json({ error: 'ID and nume are required' });
    }
    
    // Validate agentId if provided
    if (client.agentId) {
        try {
            const agent = db.prepare('SELECT id FROM agents WHERE id = ?').get(client.agentId);
            if (!agent) {
                console.error(`❌ Agent not found: ${client.agentId}`);
                return res.status(400).json({ error: `Agent with ID '${client.agentId}' does not exist` });
            }
        } catch (err) {
            console.error('❌ Error validating agent:', err);
            return res.status(500).json({ error: 'Error validating agent: ' + err.message });
        }
    }
    
    // Validate priceZone if provided
    if (client.priceZone) {
        try {
            const zone = db.prepare('SELECT id FROM zones WHERE id = ?').get(client.priceZone);
            if (!zone) {
                console.error(`❌ Price zone not found: ${client.priceZone}`);
                return res.status(400).json({ error: `Price zone with ID '${client.priceZone}' does not exist` });
            }
        } catch (err) {
            console.error('❌ Error validating price zone:', err);
            return res.status(500).json({ error: 'Error validating price zone: ' + err.message });
        }
    }
    
    // Validate status and date fields
    const status = client.status || 'active';
    if (!['active', 'inactive', 'periodic'].includes(status)) {
        return res.status(400).json({ error: 'Status must be active, inactive, or periodic' });
    }
    
    if (status === 'periodic') {
        if (!client.activeFrom || !client.activeTo) {
            return res.status(400).json({ error: 'activeFrom and activeTo are required for periodic status' });
        }
        if (client.activeFrom > client.activeTo) {
            return res.status(400).json({ error: 'activeFrom must be before or equal to activeTo' });
        }
    }
    
    try {
        console.log(`💾 Creating client:`, {
            id: client.id,
            nume: client.nume,
            agentId: client.agentId,
            priceZone: client.priceZone,
            status: status
        });
        
        const result = db.prepare(
            `INSERT INTO clients (
                id, nume, cif, nrRegCom, codContabil, judet, localitate, strada, 
                codPostal, telefon, email, banca, iban, agentId, priceZone, 
                afiseazaKG, productCodes, status, activeFrom, activeTo
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
            client.id, client.nume, client.cif, client.nrRegCom, client.codContabil,
            client.judet, client.localitate, client.strada, client.codPostal,
            client.telefon, client.email, client.banca, client.iban, client.agentId,
            client.priceZone, client.afiseazaKG ? 1 : 0, 
            JSON.stringify(client.productCodes || {}),
            status,
            client.activeFrom || null,
            client.activeTo || null
        );
        
        // Initialize all products as active for this new client
        initializeClientProducts(client.id);
        
        console.log(`✅ Client created successfully: ${client.id}`);
        res.json({ ...client, createdAt: new Date().toISOString() });
    } catch (err) {
        console.error('❌ Error creating client:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update client
app.put('/api/clients/:id', (req, res) => {
    const client = req.body;
    
    // Validate required fields
    if (!client.nume) {
        return res.status(400).json({ error: 'nume is required' });
    }
    
    // Validate agentId if provided
    if (client.agentId) {
        try {
            const agent = db.prepare('SELECT id FROM agents WHERE id = ?').get(client.agentId);
            if (!agent) {
                console.error(`❌ Agent not found: ${client.agentId}`);
                return res.status(400).json({ error: `Agent with ID '${client.agentId}' does not exist` });
            }
        } catch (err) {
            console.error('❌ Error validating agent:', err);
            return res.status(500).json({ error: 'Error validating agent: ' + err.message });
        }
    }
    
    // Validate priceZone if provided
    if (client.priceZone) {
        try {
            const zone = db.prepare('SELECT id FROM zones WHERE id = ?').get(client.priceZone);
            if (!zone) {
                console.error(`❌ Price zone not found: ${client.priceZone}`);
                return res.status(400).json({ error: `Price zone with ID '${client.priceZone}' does not exist` });
            }
        } catch (err) {
            console.error('❌ Error validating price zone:', err);
            return res.status(500).json({ error: 'Error validating price zone: ' + err.message });
        }
    }
    
    // Validate status and date fields
    const status = client.status || 'active';
    if (!['active', 'inactive', 'periodic'].includes(status)) {
        return res.status(400).json({ error: 'Status must be active, inactive, or periodic' });
    }
    
    if (status === 'periodic') {
        if (!client.activeFrom || !client.activeTo) {
            return res.status(400).json({ error: 'activeFrom and activeTo are required for periodic status' });
        }
        if (client.activeFrom > client.activeTo) {
            return res.status(400).json({ error: 'activeFrom must be before or equal to activeTo' });
        }
    }
    
    try {
        console.log(`💾 Updating client ${req.params.id}:`, {
            nume: client.nume,
            agentId: client.agentId,
            priceZone: client.priceZone,
            status: status
        });
        
        const result = db.prepare(
            `UPDATE clients SET 
                nume = ?, cif = ?, nrRegCom = ?, codContabil = ?, judet = ?, 
                localitate = ?, strada = ?, codPostal = ?, telefon = ?, email = ?, 
                banca = ?, iban = ?, agentId = ?, priceZone = ?, afiseazaKG = ?, 
                productCodes = ?, status = ?, activeFrom = ?, activeTo = ?, updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?`
        ).run(
            client.nume, client.cif, client.nrRegCom, client.codContabil, client.judet,
            client.localitate, client.strada, client.codPostal, client.telefon,
            client.email, client.banca, client.iban, client.agentId, client.priceZone,
            client.afiseazaKG ? 1 : 0, JSON.stringify(client.productCodes || {}),
            status, client.activeFrom || null, client.activeTo || null,
            req.params.id
        );
        
        if (result.changes === 0) {
            console.error(`❌ Client not found: ${req.params.id}`);
            res.status(404).json({ error: 'Client not found' });
        } else {
            console.log(`✅ Client updated successfully: ${req.params.id}`);
            // Fetch the updated client
            const row = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
            const updatedClient = {
                ...row,
                afiseazaKG: row.afiseazaKG === 1,
                productCodes: row.productCodes ? JSON.parse(row.productCodes) : {},
                status: row.status || 'active',
                activeFrom: row.activeFrom || null,
                activeTo: row.activeTo || null
            };
            res.json(updatedClient);
        }
    } catch (err) {
        console.error('❌ Error updating client:', err);
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

// Bulk update client status
app.post('/api/clients/bulk-status', (req, res) => {
    const { clientIds, status, activeFrom, activeTo } = req.body;
    
    if (!clientIds || !Array.isArray(clientIds) || clientIds.length === 0) {
        return res.status(400).json({ error: 'clientIds array is required' });
    }
    
    if (!status || !['active', 'inactive', 'periodic'].includes(status)) {
        return res.status(400).json({ error: 'Valid status is required' });
    }
    
    if (status === 'periodic') {
        if (!activeFrom || !activeTo) {
            return res.status(400).json({ error: 'activeFrom and activeTo are required for periodic status' });
        }
        if (activeFrom > activeTo) {
            return res.status(400).json({ error: 'activeFrom must be before or equal to activeTo' });
        }
    }
    
    try {
        const updateStmt = db.prepare(
            `UPDATE clients SET 
                status = ?, activeFrom = ?, activeTo = ?, updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?`
        );
        
        const updateMany = db.transaction((ids, stat, from, to) => {
            let updated = 0;
            for (const clientId of ids) {
                const result = updateStmt.run(stat, from || null, to || null, clientId);
                updated += result.changes;
            }
            return updated;
        });
        
        const updatedCount = updateMany(clientIds, status, activeFrom, activeTo);
        
        console.log(`✅ Bulk status update: ${updatedCount} clients updated to ${status}`);
        res.json({ success: true, updated: updatedCount });
    } catch (err) {
        console.error('❌ Error in bulk status update:', err);
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
            // Fetch the updated product
            const row = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
            const updatedProduct = {
                ...row,
                prices: row.prices ? JSON.parse(row.prices) : {}
            };
            res.json(updatedProduct);
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

// ============ CLIENT PRODUCTS BACKUP ENDPOINT ============

// Get all client_products for backup
app.get('/api/client-products/all', (req, res) => {
    try {
        const rows = db.prepare('SELECT * FROM client_products').all();
        const clientProducts = rows.map(row => ({
            ...row,
            is_active: row.is_active === 1
        }));
        res.json(clientProducts);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Restore client_products from backup
app.post('/api/client-products/restore', (req, res) => {
    try {
        const clientProducts = req.body;
        
        if (!Array.isArray(clientProducts)) {
            return res.status(400).json({ error: 'Invalid data format' });
        }
        
        // Clear existing client_products
        db.prepare('DELETE FROM client_products').run();
        
        // Insert all client_products
        const insert = db.prepare(`
            INSERT INTO client_products (client_id, product_id, is_active)
            VALUES (?, ?, ?)
        `);
        
        const insertMany = db.transaction((items) => {
            for (const item of items) {
                insert.run(item.client_id, item.product_id, item.is_active ? 1 : 0);
            }
        });
        
        insertMany(clientProducts);
        
        res.json({ success: true, restored: clientProducts.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
});

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'orders.db');

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Database connection error:', err);
    } else {
        console.log('Connected to SQLite database at', dbPath);
        initializeDatabase();
    }
});

function initializeDatabase() {
    // Create clients table
    db.run(`
        CREATE TABLE IF NOT EXISTS clients (
            id TEXT PRIMARY KEY,
            nume TEXT NOT NULL,
            cif TEXT,
            nrRegCom TEXT,
            codContabil TEXT,
            judet TEXT,
            localitate TEXT,
            strada TEXT,
            codPostal TEXT,
            telefon TEXT,
            email TEXT,
            banca TEXT,
            iban TEXT,
            agentId TEXT,
            priceZone TEXT,
            afiseazaKG INTEGER DEFAULT 0,
            productCodes TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Error creating clients table:', err);
        } else {
            console.log('Clients table ready');
        }
    });

    // Create products table
    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            codArticolFurnizor TEXT,
            codProductie TEXT,
            codBare TEXT,
            descriere TEXT NOT NULL,
            um TEXT,
            gestiune TEXT,
            gramajKg REAL,
            cotaTVA REAL,
            prices TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Error creating products table:', err);
        } else {
            console.log('Products table ready');
        }
    });

    // Create orders table
    db.run(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'pending',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Error creating orders table:', err);
        } else {
            console.log('Orders table ready');
        }
    });

    // Create order_items table (for future order-product relationships)
    db.run(`
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            orderId INTEGER NOT NULL,
            productId TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            price REAL NOT NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (orderId) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (productId) REFERENCES products(id) ON DELETE CASCADE
        )
    `, (err) => {
        if (err) {
            console.error('Error creating order_items table:', err);
        } else {
            console.log('Order items table ready');
        }
    });
}

module.exports = db;

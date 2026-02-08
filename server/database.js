const Database = require('better-sqlite3');
const path = require('path');

// Create database connection
const db = new Database(path.join(__dirname, 'data.db'));

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Check if we need to migrate the orders table
const migrateOrdersTable = () => {
  try {
    // Check if the old orders table exists with the old schema
    const tableInfo = db.prepare("PRAGMA table_info(orders)").all();
    
    if (tableInfo.length > 0) {
      // Check if it has the old schema (title column exists)
      const hasOldSchema = tableInfo.some(col => col.name === 'title');
      
      if (hasOldSchema) {
        console.log('Migrating orders table to new schema...');
        
        // Drop old table (we'll lose the simple orders, but they're not compatible anyway)
        db.exec('DROP TABLE IF EXISTS orders');
        
        console.log('Old orders table dropped. New schema will be created.');
      }
    }
  } catch (err) {
    console.error('Error checking orders table:', err);
  }
};

// Check if we need to add status columns to clients table
const migrateClientsTable = () => {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(clients)").all();
    
    if (tableInfo.length > 0) {
      const hasStatus = tableInfo.some(col => col.name === 'status');
      
      if (!hasStatus) {
        console.log('Adding status columns to clients table...');
        
        // Add new columns for client status management
        db.exec(`
          ALTER TABLE clients ADD COLUMN status TEXT DEFAULT 'active';
          ALTER TABLE clients ADD COLUMN activeFrom TEXT;
          ALTER TABLE clients ADD COLUMN activeTo TEXT;
        `);
        
        // Set all existing clients to 'active' status
        db.exec(`UPDATE clients SET status = 'active' WHERE status IS NULL`);
        
        console.log('✅ Clients table migrated successfully. All existing clients set to active status.');
      }
    }
  } catch (err) {
    console.error('Error checking clients table:', err);
  }
};

// Check if we need to add master product columns to product_groups table
const migrateProductGroupsTable = () => {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(product_groups)").all();
    
    if (tableInfo.length > 0) {
      const hasMasterProduct = tableInfo.some(col => col.name === 'masterProductId');
      
      if (!hasMasterProduct) {
        console.log('Adding master product columns to product_groups table...');
        
        // Add new columns for master product selection
        db.exec(`
          ALTER TABLE product_groups ADD COLUMN masterProductId TEXT;
          ALTER TABLE product_groups ADD COLUMN masterProductCode TEXT;
        `);
        
        console.log('✅ Product groups table migrated successfully. Master product columns added.');
      }
    }
  } catch (err) {
    console.error('Error checking product_groups table:', err);
  }
};

// Migrate before creating tables
migrateOrdersTable();

// Create tables if they don't exist
const createTables = () => {
  // Orders table
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      clientId TEXT NOT NULL,
      agentId TEXT,
      paymentType TEXT,
      dueDate TEXT,
      items TEXT,
      total REAL,
      totalTVA REAL,
      totalWithVAT REAL,
      invoiceExported INTEGER DEFAULT 0,
      receiptExported INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Agents table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      user_id TEXT,
      status TEXT DEFAULT 'active',
      zones TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Users table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      agent_id TEXT,
      status TEXT DEFAULT 'active',
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Zones table
  db.exec(`
    CREATE TABLE IF NOT EXISTS zones (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Clients table
  db.exec(`
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
      status TEXT DEFAULT 'active',
      activeFrom TEXT,
      activeTo TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Products table
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      codArticolFurnizor TEXT NOT NULL,
      codProductie TEXT,
      codBare TEXT,
      descriere TEXT NOT NULL,
      um TEXT,
      gestiune TEXT,
      gramajKg REAL,
      cotaTVA INTEGER,
      prices TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Client Products table (for managing which products are available per client)
  db.exec(`
    CREATE TABLE IF NOT EXISTS client_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      UNIQUE(client_id, product_id)
    )
  `);

  // Product Groups table (for grouping products in invoices)
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      productIds TEXT NOT NULL,
      price REAL NOT NULL,
      cotaTVA INTEGER NOT NULL,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
      updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('Database tables initialized');
};

// Create default admin user if users table is empty
const createDefaultAdminUser = () => {
  try {
    // Check if users table is empty
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    
    if (userCount.count === 0) {
      console.log('Creating default admin user...');
      
      // Default admin credentials
      const defaultAdmin = {
        id: `user-${Date.now()}`,
        username: 'admin',
        password: '947f77500ab536beb4fd1a70cba70729ee7d74729aa3100774e43323234d8d8c', // Pre-hashed password for 'CR5a8oie'
        name: 'Administrator',
        role: 'admin',
        status: 'active'
      };
      
      db.prepare(
        'INSERT INTO users (id, username, password, name, role, status) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(
        defaultAdmin.id,
        defaultAdmin.username,
        defaultAdmin.password,
        defaultAdmin.name,
        defaultAdmin.role,
        defaultAdmin.status
      );
      
      console.log('✅ Default admin user created successfully (username: admin)');
    }
  } catch (err) {
    console.error('Error creating default admin user:', err);
  }
};

// Initialize tables
createTables();

// Run migrations after tables are created
migrateClientsTable();
migrateProductGroupsTable();

// Create default admin user if needed
createDefaultAdminUser();

module.exports = db;
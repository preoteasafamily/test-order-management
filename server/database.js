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

// Check if we need to add validata column to orders table
const migrateOrdersTableForValidata = () => {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(orders)").all();

    if (tableInfo.length > 0) {
      const hasValidata = tableInfo.some(col => col.name === 'validata');

      if (!hasValidata) {
        console.log('Adding validata column to orders table...');
        db.exec(`ALTER TABLE orders ADD COLUMN validata INTEGER DEFAULT 0`);
        console.log('✅ Orders table migrated: validata column added.');
      }
    }
  } catch (err) {
    console.error('Error migrating orders table for validata:', err);
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

// Migrate billing_invoices table to add new columns
const migrateBillingInvoicesTable = () => {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(billing_invoices)").all();
    if (tableInfo.length === 0) return; // table doesn't exist yet, will be created fresh

    const cols = tableInfo.map(c => c.name);
    const toAdd = [
      { name: 'invoice_number', def: 'INTEGER' },
      { name: 'invoice_code', def: 'TEXT' },
      { name: 'pdf_path', def: 'TEXT' },
      { name: 'export_provider', def: 'TEXT' },
      { name: 'export_status', def: "TEXT DEFAULT 'disabled'" },
      { name: 'export_attempts', def: 'INTEGER DEFAULT 0' },
      { name: 'last_export_error', def: 'TEXT' },
      { name: 'exported_at', def: 'TEXT' },
    ];
    for (const col of toAdd) {
      if (!cols.includes(col.name)) {
        db.exec(`ALTER TABLE billing_invoices ADD COLUMN ${col.name} ${col.def}`);
      }
    }
  } catch (err) {
    console.error('Error migrating billing_invoices table:', err);
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

  // Export Counters table (for tracking daily export counts)
  db.exec(`
    CREATE TABLE IF NOT EXISTS export_counters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      export_date TEXT NOT NULL UNIQUE,
      invoice_count INTEGER DEFAULT 0,
      receipt_count INTEGER DEFAULT 0,
      production_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Day Status table (for tracking day closing and reopening)
  db.exec(`
    CREATE TABLE IF NOT EXISTS day_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status_date TEXT NOT NULL UNIQUE,
      production_exported INTEGER DEFAULT 0,
      exported_at TEXT,
      exported_by TEXT,
      lot_number TEXT,
      unlocked_at TEXT,
      unlocked_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Billing Invoices table (local records linked to orders)
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_invoices (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL UNIQUE,
      external_invoice_id TEXT,
      series TEXT,
      document_date TEXT,
      external_client_id TEXT,
      total REAL,
      total_vat REAL,
      total_with_vat REAL,
      status TEXT DEFAULT 'created',
      raw_snapshot TEXT,
      invoice_number INTEGER,
      invoice_code TEXT,
      pdf_path TEXT,
      export_provider TEXT,
      export_status TEXT DEFAULT 'disabled',
      export_attempts INTEGER DEFAULT 0,
      last_export_error TEXT,
      exported_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    )
  `);

  // Billing Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      invoice_series TEXT DEFAULT 'FCT',
      invoice_next_number INTEGER DEFAULT 1,
      invoice_number_padding INTEGER DEFAULT 6,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert default billing settings if not present
  db.exec(`INSERT OR IGNORE INTO billing_settings (id) VALUES (1)`);

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

// Create default export counter for current date if needed
const createDefaultExportCounters = () => {
  try {
    const currentDate = new Date().toISOString().split('T')[0];
    const existing = db.prepare('SELECT * FROM export_counters WHERE export_date = ?').get(currentDate);
    
    if (!existing) {
      console.log('Creating default export counter for current date...');
      db.prepare(
        'INSERT INTO export_counters (export_date, invoice_count, receipt_count, production_count) VALUES (?, 0, 0, 0)'
      ).run(currentDate);
      console.log('✅ Default export counter created for:', currentDate);
    }
  } catch (err) {
    console.error('Error creating default export counters:', err);
  }
};

// Create default day status for current date if needed
const createDefaultDayStatus = () => {
  try {
    const currentDate = new Date().toISOString().split('T')[0];
    const existing = db.prepare('SELECT * FROM day_status WHERE status_date = ?').get(currentDate);
    
    if (!existing) {
      console.log('Creating default day status for current date...');
      db.prepare(
        'INSERT INTO day_status (status_date, production_exported) VALUES (?, 0)'
      ).run(currentDate);
      console.log('✅ Default day status created for:', currentDate);
    }
  } catch (err) {
    console.error('Error creating default day status:', err);
  }
};

// Initialize tables
createTables();

// Run migrations after tables are created
migrateClientsTable();
migrateProductGroupsTable();
migrateOrdersTableForValidata();
migrateBillingInvoicesTable();

// Create default admin user if needed
createDefaultAdminUser();

// Create default export counters and day status
createDefaultExportCounters();
createDefaultDayStatus();

module.exports = db;
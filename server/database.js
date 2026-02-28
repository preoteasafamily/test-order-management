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
      { name: 'client_name', def: 'TEXT' },
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

// Migrate billing_invoices table to add e-Factura BT columns for existing databases
const migrateBillingInvoicesForEFactura = () => {
  try {
    const tableInfo = db.prepare("PRAGMA table_info(billing_invoices)").all();
    if (tableInfo.length === 0) return; // table doesn't exist yet, will be created fresh

    const cols = tableInfo.map(c => c.name);
    const toAdd = [
      { name: 'bt_1_invoice_number', def: 'TEXT' },
      { name: 'bt_2_issue_date', def: 'TEXT' },
      { name: 'bt_3_invoice_type_code', def: 'TEXT' },
      { name: 'bt_5_document_currency_code', def: 'TEXT' },
      { name: 'bt_6_vat_accounting_currency_code', def: 'TEXT' },
      { name: 'bt_9_due_date', def: 'TEXT' },
      { name: 'bt_10_buyer_reference', def: 'TEXT' },
      { name: 'bt_11_project_reference', def: 'TEXT' },
      { name: 'bt_12_contract_reference', def: 'TEXT' },
      { name: 'bt_13_order_reference', def: 'TEXT' },
      { name: 'bt_15_receipt_document_reference', def: 'TEXT' },
      { name: 'bt_16_delivery_document_reference', def: 'TEXT' },
      { name: 'bt_19_buyer_accounting_reference', def: 'TEXT' },
      { name: 'bt_20_payment_terms', def: 'TEXT' },
      { name: 'bt_22_note', def: 'TEXT' },
      { name: 'bt_25_preceding_invoice_reference', def: 'TEXT' },
      { name: 'bt_26_preceding_invoice_issue_date', def: 'TEXT' },
      { name: 'bt_27_seller_name', def: 'TEXT' },
      { name: 'bt_29_seller_identifier', def: 'TEXT' },
      { name: 'bt_30_seller_legal_registration', def: 'TEXT' },
      { name: 'bt_31_32_seller_vat_identifier', def: 'TEXT' },
      { name: 'bt_35_seller_address', def: 'TEXT' },
      { name: 'bt_37_seller_city', def: 'TEXT' },
      { name: 'bt_39_seller_region', def: 'TEXT' },
      { name: 'bt_40_seller_country', def: "TEXT DEFAULT 'RO'" },
      { name: 'bt_41_seller_contact', def: 'TEXT' },
      { name: 'bt_42_seller_phone', def: 'TEXT' },
      { name: 'bt_43_seller_email', def: 'TEXT' },
      { name: 'bt_44_buyer_name', def: 'TEXT' },
      { name: 'bt_46_buyer_identifier', def: 'TEXT' },
      { name: 'bt_47_buyer_legal_registration', def: 'TEXT' },
      { name: 'bt_48_buyer_vat_identifier', def: 'TEXT' },
      { name: 'bt_50_buyer_address', def: 'TEXT' },
      { name: 'bt_52_buyer_city', def: 'TEXT' },
      { name: 'bt_54_buyer_region', def: 'TEXT' },
      { name: 'bt_55_buyer_country', def: "TEXT DEFAULT 'RO'" },
      { name: 'bt_56_buyer_contact', def: 'TEXT' },
      { name: 'bt_57_buyer_phone', def: 'TEXT' },
      { name: 'bt_58_buyer_email', def: 'TEXT' },
      { name: 'bt_59_payee_name', def: 'TEXT' },
      { name: 'bt_60_payee_identifier', def: 'TEXT' },
      { name: 'bt_61_payee_legal_registration', def: 'TEXT' },
      { name: 'bt_70_delivery_location_name', def: 'TEXT' },
      { name: 'bt_71_delivery_location_id', def: 'TEXT' },
      { name: 'bt_72_actual_delivery_date', def: 'TEXT' },
      { name: 'bt_75_delivery_address', def: 'TEXT' },
      { name: 'bt_77_delivery_city', def: 'TEXT' },
      { name: 'bt_79_delivery_region', def: 'TEXT' },
      { name: 'bt_80_delivery_country', def: "TEXT DEFAULT 'RO'" },
      { name: 'bt_81_payment_means_code', def: 'TEXT' },
      { name: 'bt_84_payee_iban', def: 'TEXT' },
      { name: 'bt_85_payee_bank_name', def: 'TEXT' },
      { name: 'bt_106_sum_invoice_line_net_amount', def: 'REAL' },
      { name: 'bt_107_sum_allowances_on_document_level', def: 'REAL' },
      { name: 'bt_109_invoice_total_amount_without_vat', def: 'REAL' },
      { name: 'bt_110_invoice_total_vat_amount', def: 'REAL' },
      { name: 'bt_111_invoice_total_vat_amount_in_accounting_currency', def: 'REAL' },
      { name: 'bt_112_invoice_total_amount_with_vat', def: 'REAL' },
      { name: 'bt_113_paid_amount', def: 'REAL' },
      { name: 'bt_115_amount_due_for_payment', def: 'REAL' },
    ];
    for (const col of toAdd) {
      if (!cols.includes(col.name)) {
        db.exec(`ALTER TABLE billing_invoices ADD COLUMN ${col.name} ${col.def}`);
      }
    }
    console.log('✅ billing_invoices e-Factura BT columns migration complete.');
  } catch (err) {
    console.error('Error migrating billing_invoices for e-Factura:', err);
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
      client_name TEXT,
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
      bt_1_invoice_number TEXT,
      bt_2_issue_date TEXT,
      bt_3_invoice_type_code TEXT,
      bt_5_document_currency_code TEXT,
      bt_6_vat_accounting_currency_code TEXT,
      bt_9_due_date TEXT,
      bt_10_buyer_reference TEXT,
      bt_11_project_reference TEXT,
      bt_12_contract_reference TEXT,
      bt_13_order_reference TEXT,
      bt_15_receipt_document_reference TEXT,
      bt_16_delivery_document_reference TEXT,
      bt_19_buyer_accounting_reference TEXT,
      bt_20_payment_terms TEXT,
      bt_22_note TEXT,
      bt_25_preceding_invoice_reference TEXT,
      bt_26_preceding_invoice_issue_date TEXT,
      bt_27_seller_name TEXT,
      bt_29_seller_identifier TEXT,
      bt_30_seller_legal_registration TEXT,
      bt_31_32_seller_vat_identifier TEXT,
      bt_35_seller_address TEXT,
      bt_37_seller_city TEXT,
      bt_39_seller_region TEXT,
      bt_40_seller_country TEXT DEFAULT 'RO',
      bt_41_seller_contact TEXT,
      bt_42_seller_phone TEXT,
      bt_43_seller_email TEXT,
      bt_44_buyer_name TEXT,
      bt_46_buyer_identifier TEXT,
      bt_47_buyer_legal_registration TEXT,
      bt_48_buyer_vat_identifier TEXT,
      bt_50_buyer_address TEXT,
      bt_52_buyer_city TEXT,
      bt_54_buyer_region TEXT,
      bt_55_buyer_country TEXT DEFAULT 'RO',
      bt_56_buyer_contact TEXT,
      bt_57_buyer_phone TEXT,
      bt_58_buyer_email TEXT,
      bt_59_payee_name TEXT,
      bt_60_payee_identifier TEXT,
      bt_61_payee_legal_registration TEXT,
      bt_70_delivery_location_name TEXT,
      bt_71_delivery_location_id TEXT,
      bt_72_actual_delivery_date TEXT,
      bt_75_delivery_address TEXT,
      bt_77_delivery_city TEXT,
      bt_79_delivery_region TEXT,
      bt_80_delivery_country TEXT DEFAULT 'RO',
      bt_81_payment_means_code TEXT,
      bt_84_payee_iban TEXT,
      bt_85_payee_bank_name TEXT,
      bt_106_sum_invoice_line_net_amount REAL,
      bt_107_sum_allowances_on_document_level REAL,
      bt_109_invoice_total_amount_without_vat REAL,
      bt_110_invoice_total_vat_amount REAL,
      bt_111_invoice_total_vat_amount_in_accounting_currency REAL,
      bt_112_invoice_total_amount_with_vat REAL,
      bt_113_paid_amount REAL,
      bt_115_amount_due_for_payment REAL,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    )
  `);

  // Invoice lines table (e-Factura BG-25 line BT fields)
  db.exec(`
    CREATE TABLE IF NOT EXISTS billing_invoice_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id TEXT NOT NULL,
      bt_126_line_id INTEGER,
      bt_127_line_note TEXT,
      bt_129_invoiced_quantity REAL,
      bt_129_unit_code TEXT,
      bt_131_line_net_amount REAL,
      bt_146_item_net_price REAL,
      bt_147_item_price_discount REAL,
      bt_148_item_gross_price REAL,
      bt_151_line_vat_category_code TEXT,
      bt_152_line_vat_rate REAL,
      bt_153_item_name TEXT,
      bt_154_item_description TEXT,
      bt_155_seller_item_id TEXT,
      bt_156_buyer_item_id TEXT,
      bt_157_item_barcode TEXT,
      bt_158_item_classification_id TEXT,
      bt_160_item_attribute_name TEXT,
      bt_161_item_attribute_value TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invoice_id) REFERENCES billing_invoices(id) ON DELETE CASCADE
    )
  `);

  // VAT breakdown table (e-Factura BG-23)
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_vat_breakdown (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id TEXT NOT NULL,
      bt_118_vat_category_code TEXT,
      bt_119_vat_rate REAL,
      bt_116_vat_taxable_amount REAL,
      bt_117_vat_tax_amount REAL,
      bt_120_vat_exemption_reason_text TEXT,
      bt_121_vat_exemption_reason_code TEXT,
      FOREIGN KEY (invoice_id) REFERENCES billing_invoices(id) ON DELETE CASCADE
    )
  `);

  // Document-level allowances/charges table (e-Factura BG-20)
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_document_allowances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id TEXT NOT NULL,
      bt_92_allowance_amount REAL,
      bt_95_vat_category_code TEXT,
      bt_96_vat_rate REAL,
      bt_97_allowance_reason TEXT,
      bt_98_allowance_reason_code TEXT,
      FOREIGN KEY (invoice_id) REFERENCES billing_invoices(id) ON DELETE CASCADE
    )
  `);

  // Line-level allowances table (e-Factura BG-27)
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_line_allowances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_line_id INTEGER NOT NULL,
      bt_136_allowance_amount REAL,
      bt_137_allowance_base_amount REAL,
      bt_138_allowance_percentage REAL,
      bt_139_allowance_reason TEXT,
      bt_140_allowance_reason_code TEXT,
      FOREIGN KEY (invoice_line_id) REFERENCES billing_invoice_lines(id) ON DELETE CASCADE
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

  // App config table (key-value store for company settings and other config)
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
migrateBillingInvoicesForEFactura();

// Create default admin user if needed
createDefaultAdminUser();

// Create default export counters and day status
createDefaultExportCounters();
createDefaultDayStatus();

module.exports = db;
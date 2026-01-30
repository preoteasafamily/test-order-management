const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const db = new Database(path.join(__dirname, 'data.db'));

// Hash password function (same as in auth.js)
function hashPassword(password) {
    const salt = 'order-management-salt-2026';
    return crypto.createHash('sha256').update(password + salt).digest('hex');
}

// Create admin user
const adminId = 'user-admin-test';
const adminPassword = hashPassword('admin123');

try {
    // Check if admin already exists
    const existing = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
    
    if (!existing) {
        db.prepare(
            'INSERT INTO users (id, username, password, name, role, status) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(adminId, 'admin', adminPassword, 'Admin User', 'admin', 'active');
        console.log('✅ Admin user created: username=admin, password=admin123');
    } else {
        console.log('✅ Admin user already exists');
    }

    // Create test zones
    const zones = [
        { id: 'zone_1', code: 'Z1', name: 'Zona 1' },
        { id: 'zone_2', code: 'Z2', name: 'Zona 2' },
        { id: 'zone_3', code: 'Z3', name: 'Zona 3' }
    ];

    for (const zone of zones) {
        const existingZone = db.prepare('SELECT * FROM zones WHERE id = ?').get(zone.id);
        if (!existingZone) {
            db.prepare(
                'INSERT INTO zones (id, code, name, description) VALUES (?, ?, ?, ?)'
            ).run(zone.id, zone.code, zone.name, `Descriere ${zone.name}`);
            console.log(`✅ Zone created: ${zone.name}`);
        } else {
            console.log(`✅ Zone already exists: ${zone.name}`);
        }
    }

    // Create test agent
    const agentId = 'agent-test-1';
    const existingAgent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!existingAgent) {
        db.prepare(
            'INSERT INTO agents (id, code, name, status, zones) VALUES (?, ?, ?, ?, ?)'
        ).run(agentId, 'AG001', 'Agent Test', 'active', JSON.stringify(['zone_1', 'zone_2']));
        console.log('✅ Test agent created');
    } else {
        console.log('✅ Test agent already exists');
    }

    console.log('\n✅ Database setup complete!');
} catch (error) {
    console.error('❌ Error setting up database:', error.message);
    process.exit(1);
}

db.close();

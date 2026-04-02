const { db, sqlite, schema } = require('../../db');
const { eq } = require('drizzle-orm');

async function initializeDatabase() {
  console.log('----------------------------------------------------');
  console.log('📦WG-FUX Database Initialization...');
  
  try {
    // 1. Create Tables if they don't exist
    // better-sqlite3 handles this via SQL, but we can also use drizzle metadata or simple SQL
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT DEFAULT 'viewer',
        twoFactorSecret TEXT,
        expiry TEXT
      );

      CREATE TABLE IF NOT EXISTS containers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        createdAt INTEGER DEFAULT (strftime('%s', 'now'))
      );

      CREATE TABLE IF NOT EXISTS clients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        container TEXT NOT NULL,
        name TEXT NOT NULL,
        ip TEXT,
        publicKey TEXT NOT NULL UNIQUE,
        expiry TEXT,
        quota INTEGER DEFAULT 0,
        uploadLimit INTEGER DEFAULT 0,
        createdAt INTEGER DEFAULT (strftime('%s', 'now')),
        enabled INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        publicKey TEXT NOT NULL UNIQUE,
        total INTEGER DEFAULT 0,
        daily TEXT
      );

      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        type TEXT DEFAULT 'snapshot',
        status TEXT,
        container TEXT,
        name TEXT,
        virtualIp TEXT,
        realIp TEXT,
        usageDaily INTEGER DEFAULT 0,
        usageTotal INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        messages TEXT,
        updatedAt INTEGER DEFAULT (strftime('%s', 'now'))
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER DEFAULT (strftime('%s', 'now')),
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        targetType TEXT NOT NULL,
        targetName TEXT,
        details TEXT,
        ip TEXT
      );
    `);

    // 2. Create Indexes if they don't exist
    sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS username_idx ON users(username);
      CREATE UNIQUE INDEX IF NOT EXISTS container_name_idx ON containers(name);
      CREATE UNIQUE INDEX IF NOT EXISTS pubkey_idx ON clients(publicKey);
      CREATE INDEX IF NOT EXISTS container_idx ON clients(container);
      CREATE INDEX IF NOT EXISTS log_timestamp_idx ON logs(timestamp);
      CREATE INDEX IF NOT EXISTS audit_timestamp_idx ON audit_logs(timestamp);
      CREATE INDEX IF NOT EXISTS audit_actor_idx ON audit_logs(actor);
    `);


    console.log('✅ Schema synchronization complete.');

    // 3. Seed Admin User if users table is empty
    const usersCount = sqlite.prepare('SELECT count(*) as count FROM users').get().count;
    
    if (usersCount === 0) {
      const adminUser = process.env.ADMIN_USER || 'admin';
      const adminHash = process.env.ADMIN_PASSWORD_HASH;
      const adminSalt = process.env.ADMIN_PASSWORD_SALT;

      if (adminHash && adminSalt) {
        console.log(`👤 Seeding initial admin user: ${adminUser}`);
        await db.insert(schema.users).values({
          username: adminUser,
          hash: adminHash,
          salt: adminSalt,
          role: 'admin'
        });
        console.log('✅ Admin user seeded successfully.');
      } else {
        console.warn('⚠️ Missing ADMIN_PASSWORD_HASH/SALT in env. Admin user not seeded.');
      }
    } else {
      console.log('ℹ️ Users already exist. Skipping seed.');
    }

  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

module.exports = { initializeDatabase };

const axios = require('axios');
const { db, sqlite, schema } = require('../../db');
const logger = require('./logger');

const { eq } = require('drizzle-orm');
const fs = require('fs').promises;

async function initializeDatabase() {
  logger.info('db', '📦WG-FUX Database Initialization...');

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
 `);

    sqlite.exec(`
 CREATE TABLE IF NOT EXISTS containers (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL UNIQUE,
 owner TEXT DEFAULT 'admin',
 interface TEXT DEFAULT 'wg0',
 createdAt INTEGER DEFAULT (strftime('%s', 'now'))
 );
 `);

    sqlite.exec(`
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
 `);

    sqlite.exec(`
 CREATE TABLE IF NOT EXISTS usage (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 publicKey TEXT NOT NULL UNIQUE,
 total INTEGER DEFAULT 0,
 daily TEXT,
 FOREIGN KEY (publicKey) REFERENCES clients(publicKey) ON DELETE CASCADE
 );
 `);

    sqlite.exec(`
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
 `);

    sqlite.exec(`
 CREATE TABLE IF NOT EXISTS auditLogs (
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

    // ── Versioned migration system ─────────────────────────────────────────
    // Each migration runs exactly once, tracked in schema_version.
    // New columns / indexes go here — never touch the CREATE TABLE blocks above.
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER DEFAULT (strftime('%s','now'))
      );
    `);

    const appliedVersions = new Set(
      sqlite.prepare('SELECT version FROM schema_version').all().map((r) => r.version)
    );

    const migrations = [
      // Phase 4 (legacy — already applied inline above, registered here for completeness)
      { version: 4, sql: "ALTER TABLE containers ADD COLUMN interface TEXT DEFAULT 'wg0'", label: 'containers.interface' },
      // Phase 5
      { version: 5, sql: "ALTER TABLE containers ADD COLUMN owner TEXT DEFAULT 'admin'", label: 'containers.owner' },
      // Phase 6
      { version: 6, sql: 'ALTER TABLE users ADD COLUMN enabled INTEGER DEFAULT 1', label: 'users.enabled' },
    ];

    for (const m of migrations) {
      if (appliedVersions.has(m.version)) continue;
      try {
        sqlite.exec(m.sql);
        logger.info('db', `✅ Migration v${m.version} applied: ${m.label}`);
      } catch (e) {
        // Column already exists from the old inline path — harmless
        if (!e.message.includes('duplicate column name')) {
          logger.warn('db', `Migration v${m.version} notice: ${e.message}`);
        }
      }
      sqlite.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(m.version);
    }

    // 3. Create Indexes if they don't exist
    // Keep in sync with db/schema.js
    sqlite.exec(`
 CREATE UNIQUE INDEX IF NOT EXISTS username_idx ON users(username);
 CREATE UNIQUE INDEX IF NOT EXISTS container_name_idx ON containers(name);
 CREATE UNIQUE INDEX IF NOT EXISTS pubkey_idx ON clients(publicKey);
 CREATE UNIQUE INDEX IF NOT EXISTS usage_pubkey_idx ON usage(publicKey);
 CREATE INDEX IF NOT EXISTS container_idx ON clients(container);
 CREATE INDEX IF NOT EXISTS log_timestamp_idx ON logs(timestamp);
 CREATE INDEX IF NOT EXISTS log_type_timestamp_idx ON logs(type, timestamp);
 CREATE INDEX IF NOT EXISTS log_status_idx ON logs(status);
 CREATE INDEX IF NOT EXISTS log_name_idx ON logs(name);
 CREATE INDEX IF NOT EXISTS audit_timestamp_idx ON auditLogs(timestamp);
 CREATE INDEX IF NOT EXISTS audit_actor_idx ON auditLogs(actor);
 CREATE INDEX IF NOT EXISTS audit_action_idx ON auditLogs(action);
 `);

    logger.info('db', '✅ Schema synchronization complete.');

    // 3. Sync Admin User from Env (v6.5 SRE - Ensure setup.sh changes are applied)
    const adminUser = process.env.ADMIN_USER || 'admin';
    const adminHash = process.env.ADMIN_PASSWORD_HASH;
    const adminSalt = process.env.ADMIN_PASSWORD_SALT;

    if (adminHash && adminSalt) {
      const existing = sqlite
        .prepare('SELECT id, hash, salt FROM users WHERE username = ?')
        .get(adminUser);

      if (!existing) {
        logger.info('db', `👤 Seeding initial admin user: ${adminUser}`);
        await db.insert(schema.users).values({
          username: adminUser,
          hash: adminHash,
          salt: adminSalt,
          role: 'admin',
        });
        logger.info('db', '✅ Admin user seeded successfully.');
      } else if (existing.hash !== adminHash || existing.salt !== adminSalt) {
        logger.info('db', `👤 Syncing credentials for existing admin user: ${adminUser}`);
        await db
          .update(schema.users)
          .set({ hash: adminHash, salt: adminSalt })
          .where(eq(schema.users.username, adminUser));
        logger.info('db', '✅ Admin credentials synchronized from .env');
      } else {
        logger.info('db', 'ℹ️ Admin credentials already in sync.');
      }
    } else {
      logger.warn(
        'db',
        '⚠️ Missing ADMIN_PASSWORD_HASH/SALT in env. Admin user not seeded/synced.'
      );
    }

    // 4. Sync Containers from Filesystem
    const clientsDir = process.env.WG_CLIENTS_DIR || '/etc/wireguard/clients';
    try {
      const entries = await fs.readdir(clientsDir, { withFileTypes: true });
      const diskContainers = entries.filter((e) => e.isDirectory()).map((e) => e.name);

      const VALID_CONTAINER_NAME = /^[a-zA-Z0-9_-]{1,64}$/;
      for (const name of diskContainers) {
        if (!VALID_CONTAINER_NAME.test(name)) {
          logger.warn('db', `⚠️ Skipping invalid container name from filesystem: ${name}`);
          continue;
        }
        const existing = sqlite.prepare('SELECT id FROM containers WHERE name = ?').get(name);
        if (!existing) {
          logger.info('db', `📦 Syncing container from disk: ${name}`);
          await db.insert(schema.containers).values({ name, owner: 'admin', interface: 'wg0' });
        }
      }
      logger.info('db', '✅ Container synchronization complete.');
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn('db', `⚠️ Could not sync containers from disk: ${err.message}`);
      }
    }
  } catch (error) {
    logger.error('db', '❌ Database initialization failed', { err: error.message });
    throw error;
  }
}

/**
 * SRE: Automate AdGuard Home Initialization (Bug-Fix 500)
 * This ensures that the DNS menu works without manual setup.
 */
async function initializeDNS() {
  const AGH_BASE_URL = process.env.AGH_BASE_URL || 'http://adguard:3000';
  const username = process.env.AGH_USER || 'admin';
  const password = process.env.AGH_PASSWORD;

  const WEAK_PASSWORDS = new Set(['password', 'change_me', 'admin', 'admin123', '12345678', 'changeme', 'wireguard', 'wgpass']);
  if (!password || WEAK_PASSWORDS.has(password.toLowerCase())) {
    if (process.env.NODE_ENV === 'production') {
      // BUG-FIX: AdGuard is an optional feature. A missing/insecure password should
      // not crash the entire API at startup. Log the error and skip DNS init gracefully.
      logger.error(
        'dns',
        '❌ AGH_PASSWORD is not set or is insecure. Skipping AdGuard initialization.'
      );
      return;
    }
    logger.warn('dns', '⚠️ Using insecure default password for AdGuard (Non-production only)');
  }

  logger.info('dns', '🛡️ Check AdGuard Home status...');
  if (process.env.VITEST === 'true') return logger.info('dns', '🧪 VITEST: Skipping DNS init');

  const initAGH = async () => {
    if (!password || password.length < 8) {
      throw new Error('AGH_PASSWORD must be at least 8 characters');
    }
    const config = {
      web: { ip: '0.0.0.0', port: 3000 },
      dns: { ip: '0.0.0.0', port: 53 },
      username: username,
      password: password,
    };
    await axios.post(`${AGH_BASE_URL}/control/install/configure`, config);
  };

  try {
    const status = await axios.get(`${AGH_BASE_URL}/control/status`, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    if (status.status === 200 && status.data.initialized) {
      logger.info('dns', '✅ AdGuard Home is already initialized.');
      return;
    }

    logger.info('dns', '🚀 Initializing AdGuard Home with .env credentials...');
    await initAGH();
    logger.info('dns', '✅ AdGuard Home initialized successfully.');
  } catch (error) {
    if (error.response && error.response.status === 302) {
      logger.info('dns', '🚀 Initializing AdGuard Home (Wizard Bypass)...');
      try {
        await initAGH();
        logger.info('dns', '✅ AdGuard Home initialized successfully.');
      } catch (innerError) {
        logger.error('dns', '❌ Failed to initialize AdGuard Home', {
          err: innerError.response ? innerError.response.data : innerError.message,
        });
      }
    } else {
      logger.warn('dns', '⚠️ Could not connect to AdGuard Home API yet', { err: error.message });
    }
  }
}

module.exports = { initializeDatabase, initializeDNS };

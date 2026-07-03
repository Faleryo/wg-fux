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

    // Registre des VPS revendeurs (exécution SSH distante). Voir specs reseller.
    sqlite.exec(`
 CREATE TABLE IF NOT EXISTS servers (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 ownerId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 label TEXT NOT NULL,
 host TEXT NOT NULL,
 port INTEGER DEFAULT 22,
 sshUsername TEXT NOT NULL DEFAULT 'wg-fux',
 encPrivateKey TEXT,
 encKeyIv TEXT,
 encKeyAuth TEXT,
 publicKey TEXT,
 hostKey TEXT,
 pendingHostKey TEXT,
 status TEXT DEFAULT 'pending',
 consecutiveFailures INTEGER DEFAULT 0,
 lastChecked INTEGER,
 lastError TEXT,
 provisionTokenHash TEXT,
 provisionTokenExpiry INTEGER,
 scriptsVersion TEXT,
 createdAt INTEGER DEFAULT (strftime('%s', 'now'))
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
      sqlite
        .prepare('SELECT version FROM schema_version')
        .all()
        .map((r) => r.version)
    );

    const migrations = [
      // Phase 4 (legacy — already applied inline above, registered here for completeness)
      {
        version: 4,
        sql: "ALTER TABLE containers ADD COLUMN interface TEXT DEFAULT 'wg0'",
        label: 'containers.interface',
      },
      // Phase 5
      {
        version: 5,
        sql: "ALTER TABLE containers ADD COLUMN owner TEXT DEFAULT 'admin'",
        label: 'containers.owner',
      },
      // Phase 6
      {
        version: 6,
        sql: 'ALTER TABLE users ADD COLUMN enabled INTEGER DEFAULT 1',
        label: 'users.enabled',
      },
      // Phase 7 — reseller multi-tenant : un container peut vivre sur un VPS distant.
      // NULL = serveur local admin (rétrocompatible). Table servers créée ci-dessus.
      {
        version: 7,
        sql: 'ALTER TABLE containers ADD COLUMN serverId INTEGER REFERENCES servers(id) ON DELETE SET NULL',
        label: 'containers.serverId',
      },
      // Phases 8-11 — licence des instances revendeurs (revenu récurrent).
      {
        version: 8,
        sql: 'ALTER TABLE servers ADD COLUMN licenseKey TEXT',
        label: 'servers.licenseKey',
      },
      {
        version: 9,
        sql: 'ALTER TABLE servers ADD COLUMN licenseExpiry INTEGER',
        label: 'servers.licenseExpiry',
      },
      {
        version: 10,
        sql: 'ALTER TABLE servers ADD COLUMN lastHeartbeat INTEGER',
        label: 'servers.lastHeartbeat',
      },
      {
        version: 11,
        sql: 'ALTER TABLE servers ADD COLUMN clientCount INTEGER DEFAULT 0',
        label: 'servers.clientCount',
      },
      // Phase 12 — réglages plateforme (Telegram, contact paiement, Stripe).
      {
        version: 12,
        sql: `CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT,
          secret INTEGER DEFAULT 0,
          updatedAt INTEGER DEFAULT (strftime('%s','now'))
        )`,
        label: 'app_settings table',
      },
      // Phases 13-16 — réseau de distribution : crédits, hiérarchie, marge.
      {
        version: 13,
        sql: 'ALTER TABLE users ADD COLUMN parentId INTEGER REFERENCES users(id) ON DELETE SET NULL',
        label: 'users.parentId',
      },
      {
        version: 14,
        sql: 'ALTER TABLE users ADD COLUMN sellPriceCents INTEGER',
        label: 'users.sellPriceCents',
      },
      {
        version: 15,
        sql: `CREATE TABLE IF NOT EXISTS wallets (
          userId INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          balance INTEGER NOT NULL DEFAULT 0,
          updatedAt INTEGER
        )`,
        label: 'wallets table',
      },
      {
        version: 16,
        sql: `CREATE TABLE IF NOT EXISTS ledger (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          userId INTEGER NOT NULL REFERENCES users(id),
          delta INTEGER NOT NULL,
          reason TEXT NOT NULL,
          priceCents INTEGER,
          counterpartyId INTEGER,
          ref TEXT,
          createdAt INTEGER DEFAULT (strftime('%s','now'))
        )`,
        label: 'ledger table',
      },
      // Phase 17 — white-label (habillage par compte revendeur).
      {
        version: 17,
        sql: `CREATE TABLE IF NOT EXISTS brands (
          userId INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
          name TEXT,
          logoUrl TEXT,
          primaryColor TEXT,
          customDomain TEXT
        )`,
        label: 'brands table',
      },
      // Phase 18 — idempotence des webhooks Stripe (un event.id traité 1 seule fois).
      {
        version: 18,
        sql: `CREATE TABLE IF NOT EXISTS stripe_events (
          id TEXT PRIMARY KEY,
          processedAt INTEGER DEFAULT (strftime('%s','now'))
        )`,
        label: 'stripe_events table',
      },
    ];

    for (const m of migrations) {
      if (appliedVersions.has(m.version)) continue;
      try {
        sqlite.exec(m.sql);
        sqlite.prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)').run(m.version);
        logger.info('db', `✅ Migration v${m.version} applied: ${m.label}`);
      } catch (e) {
        if (e.message.includes('duplicate column name')) {
          // Column already exists from old inline path — mark as applied
          sqlite
            .prepare('INSERT OR IGNORE INTO schema_version (version) VALUES (?)')
            .run(m.version);
        } else {
          logger.error('db', `❌ Migration v${m.version} FAILED: ${e.message}`);
          throw e;
        }
      }
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
 CREATE INDEX IF NOT EXISTS server_owner_idx ON servers(ownerId);
 CREATE UNIQUE INDEX IF NOT EXISTS server_host_idx ON servers(ownerId, host, port);
 CREATE INDEX IF NOT EXISTS user_parent_idx ON users(parentId);
 CREATE INDEX IF NOT EXISTS ledger_user_idx ON ledger(userId);
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

  const WEAK_PASSWORDS = new Set([
    'password',
    'change_me',
    'admin',
    'admin123',
    '12345678',
    'changeme',
    'wireguard',
    'wgpass',
  ]);
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

  // AdGuard usually boots slower than the API. Retry until it answers, otherwise
  // the DNAT redirect (wg-postup.sh) points clients at a dead resolver and any
  // VPN client that probes DNS on connect (e.g. WG Tunnel) hangs on "resolving DNS".
  const MAX_ATTEMPTS = Number(process.env.AGH_INIT_ATTEMPTS) || 30;
  const DELAY_MS = Number(process.env.AGH_INIT_DELAY_MS) || 2000;
  const HTTP_TIMEOUT = 5000;

  // /control/status returns 200 + JSON once configured, or 302 → install.html
  // while the setup wizard is still pending. maxRedirects:0 lets us tell them apart.
  const isInitialized = async () => {
    const res = await axios.get(`${AGH_BASE_URL}/control/status`, {
      maxRedirects: 0,
      timeout: HTTP_TIMEOUT,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return res.status === 200 && res.data !== null && typeof res.data === 'object';
  };

  const initAGH = async () => {
    if (!password || password.length < 8) {
      throw new Error('AGH_PASSWORD must be at least 8 characters');
    }
    const config = {
      web: { ip: '0.0.0.0', port: 3000 },
      dns: { ip: '0.0.0.0', port: 53 },
      username,
      password,
    };
    try {
      await axios.post(`${AGH_BASE_URL}/control/install/configure`, config, {
        timeout: HTTP_TIMEOUT,
      });
    } catch (e) {
      // 422 = "instance already configured": race with another init, treat as done.
      if (e.response && e.response.status === 422) return;
      throw e;
    }
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      if (await isInitialized()) {
        logger.info('dns', '✅ AdGuard Home is already initialized.');
        return;
      }
      logger.info('dns', `🚀 Initializing AdGuard Home (attempt ${attempt}/${MAX_ATTEMPTS})...`);
      await initAGH();
      logger.info('dns', '✅ AdGuard Home initialized successfully.');
      return;
    } catch (error) {
      const code = error.code || (error.response && error.response.status);
      logger.warn('dns', `⏳ AdGuard not ready yet (attempt ${attempt}/${MAX_ATTEMPTS})`, {
        err: error.message,
        code,
      });
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
    }
  }

  logger.error(
    'dns',
    `❌ AdGuard Home init failed after ${MAX_ATTEMPTS} attempts. ` +
      'DNS filtering will not work until it is initialized (re-run setup or POST /control/install/configure).'
  );
}

module.exports = { initializeDatabase, initializeDNS };

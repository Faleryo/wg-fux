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
      // Phase 19 — anti-abus d'essai : 1 seul essai gratuit par host, à vie.
      // (supprimer/recréer un serveur ne re-mint PAS 30 jours gratuits)
      {
        version: 19,
        sql: `CREATE TABLE IF NOT EXISTS trial_grants (
          host TEXT PRIMARY KEY,
          firstOwnerId INTEGER,
          grantedAt INTEGER DEFAULT (strftime('%s','now'))
        )`,
        label: 'trial_grants table',
      },
      // Phase 20 — palier de licence : plafond de clients par instance (NULL = illimité).
      {
        version: 20,
        sql: 'ALTER TABLE servers ADD COLUMN maxClients INTEGER',
        label: 'servers.maxClients',
      },
      // Phase 21 — canal de mise à jour de la flotte : stable | canary | hold.
      {
        version: 21,
        sql: "ALTER TABLE servers ADD COLUMN updateChannel TEXT DEFAULT 'stable'",
        label: 'servers.updateChannel',
      },
      // Phases 22-23 — cycle de vie compte : email de contact + acceptation CGU.
      {
        version: 22,
        sql: 'ALTER TABLE users ADD COLUMN email TEXT',
        label: 'users.email',
      },
      {
        version: 23,
        sql: 'ALTER TABLE users ADD COLUMN acceptedTermsAt INTEGER',
        label: 'users.acceptedTermsAt',
      },
      // Phase 24 — inscription par invitation (croissance du réseau revendeurs).
      {
        version: 24,
        sql: `CREATE TABLE IF NOT EXISTS invites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tokenHash TEXT NOT NULL UNIQUE,
          inviterId INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          createdAt INTEGER DEFAULT (strftime('%s','now')),
          expiresAt INTEGER NOT NULL,
          usedAt INTEGER,
          usedByUserId INTEGER
        )`,
        label: 'invites table',
      },
      // Phase 25 — déploiement gouverné : version approuvée par l'admin pour
      // chaque instance (NULL = aucune mise à jour offerte au heartbeat/bundle).
      {
        version: 25,
        sql: 'ALTER TABLE servers ADD COLUMN targetVersion TEXT',
        label: 'servers.targetVersion',
      },
      // Phase 26 — mode de déploiement par instance : 'auto' (appliqué par le
      // cron sous ~6 h) ou 'instant' (offert immédiatement, l'opérateur de
      // l'instance confirme l'installation depuis son UI).
      {
        version: 26,
        sql: "ALTER TABLE servers ADD COLUMN updateMode TEXT DEFAULT 'auto'",
        label: 'servers.updateMode',
      },
      // Phase 27 — métadonnées de flotte (organisation d'un parc de VPS).
      { version: 27, sql: 'ALTER TABLE servers ADD COLUMN region TEXT', label: 'servers.region' },
      {
        version: 28,
        sql: 'ALTER TABLE servers ADD COLUMN provider TEXT',
        label: 'servers.provider',
      },
      {
        version: 29,
        sql: 'ALTER TABLE servers ADD COLUMN tags TEXT',
        label: 'servers.tags (CSV)',
      },
      { version: 30, sql: 'ALTER TABLE servers ADD COLUMN notes TEXT', label: 'servers.notes' },
      // Phase 31-35 — télémétrie machine remontée par le heartbeat de l'instance.
      {
        version: 31,
        sql: 'ALTER TABLE servers ADD COLUMN cpuPct REAL',
        label: 'servers.cpuPct',
      },
      {
        version: 32,
        sql: 'ALTER TABLE servers ADD COLUMN memPct REAL',
        label: 'servers.memPct',
      },
      {
        version: 33,
        sql: 'ALTER TABLE servers ADD COLUMN diskPct REAL',
        label: 'servers.diskPct',
      },
      {
        version: 34,
        sql: 'ALTER TABLE servers ADD COLUMN uptimeSec INTEGER',
        label: 'servers.uptimeSec',
      },
      {
        version: 35,
        sql: 'ALTER TABLE servers ADD COLUMN healthAt INTEGER',
        label: 'servers.healthAt',
      },
      // Phase 36-37 — seuils d'alerte par serveur (évalués par le job flotte).
      {
        version: 36,
        sql: 'ALTER TABLE servers ADD COLUMN alertOfflineMin INTEGER',
        label: 'servers.alertOfflineMin',
      },
      {
        version: 37,
        sql: 'ALTER TABLE servers ADD COLUMN alertLicenseDays INTEGER',
        label: 'servers.alertLicenseDays',
      },
      // Phase 38 — historique de santé/disponibilité (courbe uptime + métriques).
      {
        version: 38,
        sql: `CREATE TABLE IF NOT EXISTS server_health_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          serverId INTEGER NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
          ts INTEGER DEFAULT (strftime('%s','now')),
          status TEXT,
          cpuPct REAL,
          memPct REAL,
          diskPct REAL,
          clientCount INTEGER
        )`,
        label: 'server_health_history table',
      },
      // Phase 39 — le Blackbox Log affichait l'heure du POLL (cycle logTrafficHistory,
      // toutes les 60s) comme si c'était l'heure de connexion du peer. On stocke
      // désormais le vrai timestamp de handshake WireGuard séparément.
      {
        version: 39,
        sql: 'ALTER TABLE logs ADD COLUMN handshakeAt INTEGER',
        label: 'logs.handshakeAt',
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
 CREATE INDEX IF NOT EXISTS health_server_ts_idx ON server_health_history(serverId, ts);
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

  // /control/status : 200 + JSON une fois configuré (avec Basic auth), 302 →
  // install.html tant que l'assistant est en attente, 401/403 si configuré
  // mais credentials refusés. AVANT, l'appel était fait SANS auth → un AdGuard
  // configuré répondait 403 → interprété « pas prêt » → boucle infinie et
  // filtrage DNS déclaré mort alors qu'il tournait.
  // Renvoie : 'ready' | 'wizard' | 'auth_mismatch'.
  const aghState = async () => {
    const res = await axios.get(`${AGH_BASE_URL}/control/status`, {
      maxRedirects: 0,
      timeout: HTTP_TIMEOUT,
      auth: { username, password: password || '' },
      validateStatus: (s) => (s >= 200 && s < 400) || s === 401 || s === 403,
    });
    if (res.status === 200 && res.data && typeof res.data === 'object') return 'ready';
    if (res.status === 401 || res.status === 403) return 'auth_mismatch';
    return 'wizard'; // 302 → assistant d'installation en attente
  };

  // Upstreams à faible latence : Google DNS (anycast, très rapide) + Cloudflare,
  // interrogés en mode fastest_addr (AdGuard course les upstreams et sert la
  // réponse la plus rapide) + cache optimiste → latence de résolution minimale
  // pour le gaming. Poussé à chaque boot (idempotent).
  const tuneDns = async () => {
    try {
      await axios.post(
        `${AGH_BASE_URL}/control/dns_config`,
        {
          upstream_dns: ['8.8.8.8', '8.8.4.4', '1.1.1.1'],
          bootstrap_dns: ['8.8.8.8', '1.1.1.1'],
          upstream_mode: 'fastest_addr',
          cache_size: 4194304,
          cache_optimistic: true,
        },
        { auth: { username, password }, timeout: HTTP_TIMEOUT }
      );
      logger.info('dns', '🚀 Upstreams DNS optimisés (Google/Cloudflare, fastest_addr, cache).');
    } catch (e) {
      logger.warn('dns', 'Tuning des upstreams AdGuard échoué (non bloquant)', {
        err: e.message,
      });
    }
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
      const state = await aghState();
      if (state === 'ready') {
        logger.info('dns', '✅ AdGuard Home is already initialized.');
        await tuneDns();
        return;
      }
      if (state === 'auth_mismatch') {
        // Configuré, mais avec d'AUTRES credentials (ex. volume AdGuard ayant
        // survécu à une réinstallation alors que .env a été regénéré). Inutile
        // de boucler : rien ne changera tout seul.
        logger.error(
          'dns',
          '❌ AdGuard est configuré mais refuse AGH_USER/AGH_PASSWORD (.env ≠ AdGuardHome.yaml). ' +
            'Le filtrage DNS tourne mais l’API ne peut pas le piloter. ' +
            'Réparation : bash scripts/wg-fix-adguard.sh (réinitialise la conf AdGuard avec les credentials du .env).'
        );
        return;
      }
      logger.info('dns', `🚀 Initializing AdGuard Home (attempt ${attempt}/${MAX_ATTEMPTS})...`);
      await initAGH();
      logger.info('dns', '✅ AdGuard Home initialized successfully.');
      await tuneDns();
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

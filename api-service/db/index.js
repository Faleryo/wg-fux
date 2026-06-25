const { drizzle } = require('drizzle-orm/better-sqlite3');
const Database = require('better-sqlite3');
const path = require('path');
const schema = require('./schema');

const fs = require('fs');
let DB_PATH = process.env.DB_PATH;

if (process.env.NODE_ENV === 'test' && !DB_PATH) {
  DB_PATH = ':memory:';
}

if (!DB_PATH) {
  DB_PATH = path.join(__dirname, '../data/wg-fux.db');
}

// Ensure database directory exists (only for file-based DB)
if (DB_PATH !== ':memory:') {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}

const log = require('../src/services/logger');

const sqliteRaw = new Database(DB_PATH);

// SQLite does not enforce foreign keys by default. The schema declares
// `onDelete: 'cascade'` on usage.publicKey → clients.publicKey, so we need
// this on for the cascade to fire. Applied to both file and :memory: DBs.
sqliteRaw.pragma('foreign_keys = ON');

// Hyper-Optimization: Enable WAL mode for high performance concurrency (Skip in memory/test)
if (process.env.NODE_ENV !== 'test') {
  sqliteRaw.pragma('journal_mode = WAL');
}

// SRE Protocol: Latency monitoring Proxy (Disabled in test env for stability)
const sqlite =
  process.env.NODE_ENV === 'test'
    ? sqliteRaw
    : new Proxy(sqliteRaw, {
        get(target, prop) {
          let original = target[prop];
          if (typeof original === 'function') {
            original = original.bind(target);
          }
          if (typeof original === 'function' && prop === 'prepare') {
            return (...args) => {
              const stmt = original.apply(target, args);
              return new Proxy(stmt, {
                get(s, p) {
                  let m = s[p];
                  if (typeof m === 'function') {
                    m = m.bind(s);
                  }
                  if (typeof m === 'function' && ['run', 'all', 'get', 'iterate'].includes(p)) {
                    return (...a) => {
                      const start = Date.now();
                      try {
                        return m.apply(s, a);
                      } finally {
                        const duration = Date.now() - start;
                        if (log && typeof log.recordLatency === 'function') {
                          log.recordLatency(duration); // Track SQL latency in p95 pool
                        }
                        if (duration >= 50 && log && typeof log.warn === 'function') {
                          // Log slow queries (>50ms)
                          log.warn('db', `Slow SQL ${p.toUpperCase()}`, { ms: duration });
                        }
                      }
                    };
                  }
                  return m;
                },
              });
            };
          }
          return original;
        },
      });

const db = drizzle(sqlite, { schema });

module.exports = {
  db,
  schema,
  sqlite, // Exporting proxied sqlite
};

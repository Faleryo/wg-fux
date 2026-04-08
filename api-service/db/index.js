const { drizzle } = require('drizzle-orm/better-sqlite3');
const Database = require('better-sqlite3');
const path = require('path');
const schema = require('./schema');

const fs = require('fs');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/wg-fux.db');

// Ensure database directory exists
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(DB_PATH);

// Hyper-Optimization: Enable WAL mode for high performance concurrency
sqlite.pragma('journal_mode = WAL');

const db = drizzle(sqlite, { schema });

module.exports = {
  db,
  schema,
  sqlite, // Exporting raw better-sqlite3 for maintenance tasks
};

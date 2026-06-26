const { sqliteTable, text, integer, index, uniqueIndex } = require('drizzle-orm/sqlite-core');
const { sql } = require('drizzle-orm');

const users = sqliteTable(
  'users',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    username: text('username').notNull().unique(),
    hash: text('hash').notNull(),
    salt: text('salt').notNull(),
    role: text('role').default('viewer'),
    twoFactorSecret: text('twoFactorSecret'),
    expiry: text('expiry'),
  },
  (table) => ({
    usernameIdx: uniqueIndex('username_idx').on(table.username),
  })
);

const containers = sqliteTable(
  'containers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    owner: text('owner').default('admin'), // The user who owns this container (for resellers)
    interface: text('interface').default('wg0'), // Mapping to WireGuard interface (wg0, wg1, etc.)
    createdAt: integer('createdAt', { mode: 'timestamp' }).default(
      sql`(cast(strftime('%s','now') as int))`
    ),
  },
  (table) => ({
    containerNameIdx: uniqueIndex('container_name_idx').on(table.name),
  })
);

const clients = sqliteTable(
  'clients',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    container: text('container').notNull(),
    name: text('name').notNull(),
    ip: text('ip'),
    publicKey: text('publicKey').notNull().unique(),
    expiry: text('expiry'),
    quota: integer('quota').default(0),
    uploadLimit: integer('uploadLimit').default(0),
    createdAt: integer('createdAt', { mode: 'timestamp' }).default(
      sql`(cast(strftime('%s','now') as int))`
    ),
    enabled: integer('enabled', { mode: 'boolean' }).default(true),
  },
  (table) => ({
    pubKeyIdx: uniqueIndex('pubkey_idx').on(table.publicKey),
    containerIdx: index('container_idx').on(table.container),
  })
);

const usage = sqliteTable(
  'usage',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    publicKey: text('publicKey')
      .notNull()
      .unique()
      .references(() => clients.publicKey, { onDelete: 'cascade' }),
    total: integer('total').default(0),
    daily: text('daily'), // Store JSON as text
  },
  (table) => ({
    usagePubKeyIdx: uniqueIndex('usage_pubkey_idx').on(table.publicKey),
  })
);

const logs = sqliteTable(
  'logs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    timestamp: integer('timestamp', { mode: 'timestamp' }).default(
      sql`(cast(strftime('%s','now') as int))`
    ),
    type: text('type').default('snapshot'), // 'snapshot', 'auth', 'system', 'maintenance'
    status: text('status'),
    container: text('container'),
    name: text('name'), // name field is used for publicKey in snapshots, or username in auth logs
    virtualIp: text('virtualIp'),
    realIp: text('realIp'),
    usageDaily: integer('usageDaily').default(0),
    usageTotal: integer('usageTotal').default(0),
  },
  (table) => ({
    logTimestampIdx: index('log_timestamp_idx').on(table.timestamp),
    logTypeTimestampIdx: index('log_type_timestamp_idx').on(table.type, table.timestamp),
    logStatusIdx: index('log_status_idx').on(table.status),
    logNameIdx: index('log_name_idx').on(table.name),
  })
);

const auditLogs = sqliteTable(
  'auditLogs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    timestamp: integer('timestamp', { mode: 'timestamp' }).default(
      sql`(cast(strftime('%s','now') as int))`
    ),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    targetType: text('targetType').notNull(),
    targetName: text('targetName'),
    details: text('details'),
    ip: text('ip'),
  },
  (table) => ({
    auditTimestampIdx: index('audit_timestamp_idx').on(table.timestamp),
    auditActorIdx: index('audit_actor_idx').on(table.actor),
    auditActionIdx: index('audit_action_idx').on(table.action),
  })
);

module.exports = {
  users,
  containers,
  clients,
  usage,
  logs,
  auditLogs,
};

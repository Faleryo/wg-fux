const { sqliteTable, text, integer, index, uniqueIndex } = require('drizzle-orm/sqlite-core');

const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  hash: text('hash').notNull(),
  salt: text('salt').notNull(),
  role: text('role').default('viewer'),
  twoFactorSecret: text('twoFactorSecret'),
  expiry: text('expiry'),
}, (table) => ({
  usernameIdx: uniqueIndex('username_idx').on(table.username),
}));

const containers = sqliteTable('containers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  createdAt: integer('createdAt', { mode: 'timestamp' }).default(new Date()),
}, (table) => ({
  containerNameIdx: uniqueIndex('container_name_idx').on(table.name),
}));

const clients = sqliteTable('clients', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  container: text('container').notNull(),
  name: text('name').notNull(),
  ip: text('ip'),
  publicKey: text('publicKey').notNull().unique(),
  expiry: text('expiry'),
  quota: integer('quota').default(0),
  uploadLimit: integer('uploadLimit').default(0),
  createdAt: integer('createdAt', { mode: 'timestamp' }).default(new Date()),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
}, (table) => ({
  pubKeyIdx: uniqueIndex('pubkey_idx').on(table.publicKey),
  containerIdx: index('container_idx').on(table.container),
}));

const usage = sqliteTable('usage', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  publicKey: text('publicKey').notNull().unique().references(() => clients.publicKey, { onDelete: 'cascade' }),
  total: integer('total').default(0),
  daily: text('daily'), // Store JSON as text
}, (table) => ({
  usagePubKeyIdx: uniqueIndex('usage_pubkey_idx').on(table.publicKey),
}));

const logs = sqliteTable('logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  timestamp: integer('timestamp', { mode: 'timestamp' }).default(new Date()),
  type: text('type').default('snapshot'), // 'snapshot', 'auth', 'system', 'maintenance'
  status: text('status'),
  container: text('container'),
  name: text('name'), // name field is used for publicKey in snapshots, or username in auth logs
  virtualIp: text('virtualIp'),
  realIp: text('realIp'),
  usageDaily: integer('usageDaily').default(0),
  usageTotal: integer('usageTotal').default(0),
}, (table) => ({
  logTimestampIdx: index('log_timestamp_idx').on(table.timestamp),
  logTypeTimestampIdx: index('log_type_timestamp_idx').on(table.type, table.timestamp),
  logStatusIdx: index('log_status_idx').on(table.status),
  logNameIdx: index('log_name_idx').on(table.name),
}));

const tickets = sqliteTable('tickets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull(),
  title: text('title').notNull(),
  status: text('status').default('open'),
  messages: text('messages'), // Store JSON as text
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).default(new Date()),
}, (table) => ({
  ticketUsernameIdx: index('ticket_username_idx').on(table.username),
  ticketStatusIdx: index('ticket_status_idx').on(table.status),
}));

module.exports = {
  users,
  containers,
  clients,
  usage,
  logs,
  tickets
};

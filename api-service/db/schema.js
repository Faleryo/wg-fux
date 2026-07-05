const { sqliteTable, text, integer, real, index, uniqueIndex } = require('drizzle-orm/sqlite-core');
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
    enabled: integer('enabled', { mode: 'boolean' }).default(true),
    // Réseau de distribution (white-label multi-niveau). NULL = créé par l'admin
    // (revendeur niveau 1 ou rôle historique) ; = id revendeur → sous-revendeur N2.
    parentId: integer('parentId').references(() => users.id, { onDelete: 'set null' }),
    // Prix de revente d'1 crédit aux enfants, en centimes (marge = revente − acquisition).
    sellPriceCents: integer('sellPriceCents'),
    // Contact (reçus, alertes de licence, reset). Optionnel mais fortement conseillé.
    email: text('email'),
    // Horodatage d'acceptation des CGU (exigée à l'inscription si terms_url configuré).
    acceptedTermsAt: integer('acceptedTermsAt', { mode: 'timestamp' }),
  },
  (table) => ({
    usernameIdx: uniqueIndex('username_idx').on(table.username),
    userParentIdx: index('user_parent_idx').on(table.parentId),
  })
);

// Portefeuille de crédits (1:1 user). balance = CACHE dénormalisé ; la vérité
// comptable est SUM(ledger.delta). Maintenu en transaction avec le ledger.
const wallets = sqliteTable('wallets', {
  userId: integer('userId')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  balance: integer('balance').notNull().default(0),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }),
});

// Grand livre immuable (append-only) : source de vérité des crédits. Un transfert
// produit 2 lignes de deltas opposés corrélées par `ref`.
const ledger = sqliteTable(
  'ledger',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userId: integer('userId')
      .notNull()
      .references(() => users.id),
    delta: integer('delta').notNull(), // > 0 crédit, < 0 débit
    reason: text('reason').notNull(), // topup|transfer_in|transfer_out|monthly|refund
    priceCents: integer('priceCents'), // prix unitaire appliqué (calcul de marge)
    counterpartyId: integer('counterpartyId'), // l'autre partie d'un transfert
    ref: text('ref'), // transferId / serverId / paymentId…
    createdAt: integer('createdAt', { mode: 'timestamp' }).default(
      sql`(cast(strftime('%s','now') as int))`
    ),
  },
  (t) => ({
    ledgerUserIdx: index('ledger_user_idx').on(t.userId),
  })
);

const containers = sqliteTable(
  'containers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    name: text('name').notNull().unique(),
    owner: text('owner').default('admin'), // The user who owns this container (for resellers)
    interface: text('interface').default('wg0'), // Mapping to WireGuard interface (wg0, wg1, etc.)
    serverId: integer('serverId').references(() => servers.id, { onDelete: 'set null' }), // NULL = serveur local admin (rétrocompatible)
    createdAt: integer('createdAt', { mode: 'timestamp' }).default(
      sql`(cast(strftime('%s','now') as int))`
    ),
  },
  (table) => ({
    containerNameIdx: uniqueIndex('container_name_idx').on(table.name),
  })
);

// Registre des VPS revendeurs (cibles d'exécution distante). Voir specs
// 2026-06-27 (socle SSH) et 2026-06-30 (provisioning one-liner).
const servers = sqliteTable(
  'servers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerId: integer('ownerId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    host: text('host').notNull(),
    port: integer('port').default(22),
    sshUsername: text('sshUsername').notNull().default('wg-fux'),
    // Clé privée SSH chiffrée AES-256-GCM (services/crypto.js). Jamais en clair.
    encPrivateKey: text('encPrivateKey'),
    encKeyIv: text('encKeyIv'),
    encKeyAuth: text('encKeyAuth'),
    publicKey: text('publicKey'), // clé publique SSH (sert le templating du bootstrap)
    hostKey: text('hostKey'), // host key VÉRIFIÉE (pin anti-MITM)
    pendingHostKey: text('pendingHostKey'), // host key annoncée au callback, avant vérif
    status: text('status').default('pending'), // pending|provisioning|online|error|offline
    consecutiveFailures: integer('consecutiveFailures').default(0),
    lastChecked: integer('lastChecked', { mode: 'timestamp' }),
    lastError: text('lastError'),
    // Provisioning one-liner
    provisionTokenHash: text('provisionTokenHash'), // sha256 du token (usage unique)
    provisionTokenExpiry: integer('provisionTokenExpiry', { mode: 'timestamp' }),
    scriptsVersion: text('scriptsVersion'),
    // Licence (revenu récurrent) : l'instance installée sur le VPS revendeur
    // phone-home avec sa clé ; expirée = création de clients bloquée là-bas.
    licenseKey: text('licenseKey'),
    licenseExpiry: integer('licenseExpiry', { mode: 'timestamp' }),
    lastHeartbeat: integer('lastHeartbeat', { mode: 'timestamp' }), // dernier phone-home de l'instance
    clientCount: integer('clientCount').default(0), // télémétrie (tarification par palier)
    maxClients: integer('maxClients'), // palier de licence : plafond de clients (NULL = illimité)
    updateChannel: text('updateChannel').default('stable'), // stable | canary | hold (maj flotte)
    // Déploiement gouverné : version APPROUVÉE par l'admin pour cette instance
    // (NULL = aucune maj offerte). L'offre n'est servie que si elle égale la
    // version courante de la plateforme (une release ultérieure invalide
    // l'approbation — l'admin ré-approuve depuis la modale Déployer).
    targetVersion: text('targetVersion'),
    // Mode de déploiement de la maj approuvée : 'auto' (cron ~6 h) ou
    // 'instant' (immédiat, confirmé par l'opérateur de l'instance).
    updateMode: text('updateMode').default('auto'),
    // Métadonnées de flotte (organisation d'un parc de VPS, purement descriptif).
    region: text('region'),
    provider: text('provider'),
    tags: text('tags'), // CSV léger
    notes: text('notes'),
    // Télémétrie machine remontée par le heartbeat de l'instance.
    cpuPct: real('cpuPct'),
    memPct: real('memPct'),
    diskPct: real('diskPct'),
    uptimeSec: integer('uptimeSec'),
    healthAt: integer('healthAt', { mode: 'timestamp' }),
    // Seuils d'alerte par serveur (évalués par le job flotte ; NULL = désactivé).
    alertOfflineMin: integer('alertOfflineMin'),
    alertLicenseDays: integer('alertLicenseDays'),
    createdAt: integer('createdAt', { mode: 'timestamp' }).default(
      sql`(cast(strftime('%s','now') as int))`
    ),
  },
  (table) => ({
    serverOwnerIdx: index('server_owner_idx').on(table.ownerId),
    serverHostIdx: uniqueIndex('server_host_idx').on(table.ownerId, table.host, table.port),
  })
);

// Historique de santé/disponibilité échantillonné par le job flotte : sert la
// courbe d'uptime et les mini-graphes de charge dans le détail d'un serveur.
const serverHealthHistory = sqliteTable(
  'server_health_history',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    serverId: integer('serverId')
      .notNull()
      .references(() => servers.id, { onDelete: 'cascade' }),
    ts: integer('ts', { mode: 'timestamp' }).default(sql`(cast(strftime('%s','now') as int))`),
    status: text('status'),
    cpuPct: real('cpuPct'),
    memPct: real('memPct'),
    diskPct: real('diskPct'),
    clientCount: integer('clientCount'),
  },
  (t) => ({
    healthServerTsIdx: index('health_server_ts_idx').on(t.serverId, t.ts),
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

// Réglages plateforme (clé/valeur) : config Telegram, contact de paiement,
// clés Stripe. Les valeurs sensibles sont chiffrées (secret=1) via crypto.js —
// jamais renvoyées en clair par l'API.
const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value'), // clair OU JSON chiffré {encPrivateKey,encKeyIv,encKeyAuth} si secret=1
  secret: integer('secret', { mode: 'boolean' }).default(false),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).default(
    sql`(cast(strftime('%s','now') as int))`
  ),
});

// Anti-abus d'essai : un host donné n'obtient les 30 jours gratuits qu'UNE fois,
// même après suppression/recréation du serveur (ré-enrôlement = licence courte).
const trialGrants = sqliteTable('trial_grants', {
  host: text('host').primaryKey(),
  firstOwnerId: integer('firstOwnerId'),
  grantedAt: integer('grantedAt', { mode: 'timestamp' }).default(
    sql`(cast(strftime('%s','now') as int))`
  ),
});

// Invitations d'inscription : un revendeur top-level (ou l'admin) génère un lien ;
// l'invité crée son compte rattaché à l'inviteur. Token stocké HACHÉ, usage unique.
const invites = sqliteTable(
  'invites',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    tokenHash: text('tokenHash').notNull().unique(),
    inviterId: integer('inviterId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: integer('createdAt', { mode: 'timestamp' }).default(
      sql`(cast(strftime('%s','now') as int))`
    ),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    usedAt: integer('usedAt', { mode: 'timestamp' }),
    usedByUserId: integer('usedByUserId'),
  },
  (t) => ({
    inviteTokenIdx: uniqueIndex('invite_token_idx').on(t.tokenHash),
  })
);

// White-label : habillage d'un compte revendeur (résolu au plus proche ancêtre).
const brands = sqliteTable('brands', {
  userId: integer('userId')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: text('name'),
  logoUrl: text('logoUrl'),
  primaryColor: text('primaryColor'),
  customDomain: text('customDomain'),
});

module.exports = {
  users,
  containers,
  clients,
  usage,
  logs,
  auditLogs,
  servers,
  appSettings,
  wallets,
  ledger,
  brands,
  trialGrants,
  invites,
  serverHealthHistory,
};

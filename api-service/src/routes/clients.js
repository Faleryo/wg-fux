const express = require('express');
const router = express.Router();
const path = require('path');
const fsPromises = require('fs').promises;
const { db, schema } = require('../../db');
const { eq, and, desc, inArray, sql } = require('drizzle-orm');
const {
  clientSchema,
  clientPatchSchema,
  toggleSchema,
  bulkUpdateSchema,
  bulkDeleteSchema,
  moveClientSchema,
  containerSchema,
  paginationSchema,
} = require('../../db/validation');
const { auth, requireManager, requireAdmin } = require('../middleware/auth');
const {
  runSystemCommand,
  writeFileAsRoot,
  unlinkAsRoot,
  readFileAsRoot,
} = require('../services/shell');
const { resolveExecutor } = require('../services/executors');
const { getWireGuardStats, getClientDir, parseWireGuardDump } = require('../services/system');
const { getScriptPath } = require('../services/config');
const { invalidateSharedPeersCache } = require('../services/jobs');
const { auditLog } = require('../services/audit');
const log = require('../services/logger');
const { asyncWrap, createError } = require('../utils/errors');
const { rateLimit } = require('express-rate-limit');

// BUG-FIX: Use the WG_BIN env var so the binary is configurable and consistent
// with how system.js resolves it. Avoids hardcoding 'wg' as a relative name.
const WG_BIN = process.env.WG_BIN || 'wg';

const creationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Trop de requêtes. Veuillez patienter 1 minute.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const identifierRegex = /^[a-zA-Z0-9_-]+$/;

// Gate de licence (instances revendeurs uniquement — no-op sans clé configurée).
// Bloque SEULEMENT la création : les clients existants ne sont jamais coupés.
const requireLicense = (req, res, next) => {
  const { isLicensed } = require('../services/license');
  if (isLicensed()) return next();
  return res
    .status(403)
    .json(
      createError(
        'Licence expirée — renouvelez votre abonnement pour créer de nouveaux clients.',
        null,
        'LICENSE_EXPIRED'
      )
    );
};

// Palier de licence : plafond de clients de l'instance (poussé par la plateforme
// au heartbeat). Appliqué UNIQUEMENT à la création de client — les clients
// existants ne sont jamais touchés. null = illimité (dont instance mère).
const requireClientCapacity = async (req, res, next) => {
  try {
    const { clientLimit } = require('../services/license');
    const limit = clientLimit();
    if (limit == null) return next();
    const [row] = await db.select({ n: sql`count(*)` }).from(schema.clients);
    if ((Number(row?.n) || 0) < limit) return next();
    return res
      .status(403)
      .json(
        createError(
          `Plafond de clients atteint (${limit}) — passez au palier supérieur pour en créer davantage.`,
          null,
          'CLIENT_LIMIT_REACHED'
        )
      );
  } catch (e) {
    return next(e);
  }
};

// 🛡️ OBSIDIAN-HARDENING: Global parameter validation and RBAC
router.param('container', async (req, res, next, val) => {
  if (!identifierRegex.test(val))
    return res.status(400).json(createError('Invalid container identifier'));

  try {
    if (!(await verifyOwnership(req, val))) {
      return res.status(403).json(createError('Forbidden: Vous ne possédez pas ce conteneur.'));
    }
    next();
  } catch (err) {
    next(err);
  }
});
router.param('name', (req, res, next, val) => {
  if (!identifierRegex.test(val))
    return res.status(400).json(createError('Invalid client identifier'));
  next();
});

// --- Container Routes ---

async function verifyOwnership(req, containerName) {
  if (req.user.role === 'admin' || req.user.role === 'manager') return true;
  const [container] = await db
    .select()
    .from(schema.containers)
    .where(eq(schema.containers.name, containerName))
    .limit(1);
  return container && container.owner === req.user.username;
}

// Lit le contenu d'une config client via le proxy sécurisé (local OU SSH distant
// selon l'executor). Renvoie le texte ou null si absent/illisible.
async function readClientConfig(container, name, executor) {
  const configPath = path.join(getClientDir(container, name), `${name}.conf`);
  const { success, content } = await readFileAsRoot(configPath, { executor });
  return success ? content : null;
}

// Calcule les allowed-ips (CIDR /32|/128) pour un peer. Source primaire : la
// colonne clients.ip (persistée à la création) — fonctionne local ET distant
// sans I/O. Repli : lecture de la config (pour les clients legacy sans ip en DB).
async function resolveAllowedIps(client, container, name, executor) {
  let raw = client.ip;
  if (!raw) {
    const conf = await readClientConfig(container, name, executor);
    const m = conf && conf.match(/^\s*Address\s*=\s*([^#\n]+)/m);
    if (m) raw = m[1];
  }
  if (!raw) return null;
  return raw
    .split(',')
    .map((ip) => ip.trim().split('/')[0])
    .filter(Boolean)
    .map((ip) => (ip.includes(':') ? `${ip}/128` : `${ip}/32`))
    .join(',');
}

router.get(
  '/containers',
  auth,
  asyncWrap(async (req, res) => {
    const isReseller = req.user.role !== 'admin' && req.user.role !== 'manager';

    // Cible distante (req.serverId posé par resolveServer) : la source de vérité
    // est la DB filtrée par serveur — pas le filesystem local. On y ajoute le
    // filtre de propriété pour les revendeurs.
    if (req.serverId) {
      const where = isReseller
        ? and(
            eq(schema.containers.serverId, req.serverId),
            eq(schema.containers.owner, req.user.username)
          )
        : eq(schema.containers.serverId, req.serverId);
      const rows = await db
        .select({ name: schema.containers.name })
        .from(schema.containers)
        .where(where);
      return res.json(rows.map((c) => c.name));
    }

    // Contexte LOCAL (serveur historique) : filesystem comme avant.
    const dir = process.env.WG_CLIENTS_DIR || '/etc/wireguard/clients';
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      let containers = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

      if (isReseller) {
        // Filter by ownership for viewers (resellers)
        const userContainers = await db
          .select({ name: schema.containers.name })
          .from(schema.containers)
          .where(eq(schema.containers.owner, req.user.username));
        const ownedNames = new Set(userContainers.map((c) => c.name));
        containers = containers.filter((name) => ownedNames.has(name));
      }

      res.json(containers);
    } catch (error) {
      if (error.code === 'ENOENT') return res.json([]);
      throw error;
    }
  })
);

router.post(
  '/containers',
  auth,
  requireLicense,
  creationLimiter,
  asyncWrap(async (req, res) => {
    const parsed = containerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Validation error for container name'));
    }
    const { name } = parsed.data;
    const executor = await resolveExecutor(req);
    const { success, error } = await runSystemCommand(
      getScriptPath('wg-create-container.sh'),
      [name],
      null,
      { executor }
    );
    if (!success) {
      throw createError(error, 'Failed to create container', 'SYSTEM_ERROR');
    }

    // 🛡️ Sync DB — serverId rattache le conteneur à son VPS (NULL = local).
    await db
      .insert(schema.containers)
      .values({
        name,
        owner: req.user.username,
        interface: 'wg0',
        serverId: req.serverId || null,
      })
      .onConflictDoNothing();

    await auditLog({
      actor: req.user.username,
      action: 'create_container',
      targetType: 'container',
      targetName: name,
    });
    res.json({ success: true });
  })
);

router.delete(
  '/containers/:name',
  auth,
  asyncWrap(async (req, res) => {
    const { name } = req.params;

    // BUG-4 FIX: Validate the container name parameter
    if (!identifierRegex.test(name))
      return res.status(400).json(createError('Invalid container identifier'));

    if (!(await verifyOwnership(req, name))) {
      return res.status(403).json(createError('Forbidden: Vous ne possédez pas ce conteneur.'));
    }

    const executor = await resolveExecutor(req);
    const { success, error } = await runSystemCommand(
      getScriptPath('wg-remove-container.sh'),
      [name],
      null,
      { executor }
    );
    if (!success) {
      throw createError(error, 'Failed to delete container', 'SYSTEM_ERROR');
    }

    // 🛡️ Sync DB
    await db.delete(schema.containers).where(eq(schema.containers.name, name));

    await auditLog({
      actor: req.user.username,
      action: 'delete_container',
      targetType: 'container',
      targetName: name,
    });
    res.json({ success: true });
  })
);

// --- Client Routes ---

router.get(
  '/',
  auth,
  asyncWrap(async (req, res) => {
    // Stats live `wg show` : LOCAL uniquement. Pour un VPS distant on ne lit pas
    // l'état temps réel ici (déféré) — la liste vient de la DB scopée par serveur.
    const wgStats = {};
    if (!req.serverId) {
      const { getInterfaces } = require('../services/system');
      const allInterfaces = await getInterfaces();
      const wgInterfaces = allInterfaces.filter((i) => i.type === 'WireGuard').map((i) => i.name);
      for (const iface of wgInterfaces) {
        const stdout = await getWireGuardStats(iface);
        const peers = parseWireGuardDump(stdout);
        peers.forEach((p) => {
          wgStats[p.publicKey] = { ...p, interface: iface };
        });
      }
    }

    let dbClients = await db.select().from(schema.clients);

    // Scope par serveur : on filtre les clients via leurs conteneurs.
    //   - cible distante  → conteneurs du serveur (serverId == req.serverId)
    //   - contexte local  → conteneurs locaux (serverId IS NULL)
    const scopeWhere = req.serverId
      ? eq(schema.containers.serverId, req.serverId)
      : sql`${schema.containers.serverId} IS NULL`;
    const scopedContainers = await db
      .select({ name: schema.containers.name, owner: schema.containers.owner })
      .from(schema.containers)
      .where(scopeWhere);
    const isReseller = req.user.role !== 'admin' && req.user.role !== 'manager';
    const scopedNames = new Set(
      (isReseller
        ? scopedContainers.filter((c) => c.owner === req.user.username)
        : scopedContainers
      ).map((c) => c.name)
    );
    dbClients = dbClients.filter((c) => scopedNames.has(c.container));

    const clients = dbClients.map((c) => {
      const stat = wgStats[c.publicKey];
      return {
        ...c,
        id: c.id,
        interface: stat ? stat.interface : 'wg0',
        lastHandshake: stat ? stat.lastHandshake : 0,
        downloadBytes: stat ? stat.tx : 0,
        uploadBytes: stat ? stat.rx : 0,
        isOnline: stat ? stat.isOnline : false,
        endpoint: stat ? stat.endpoint : '',
      };
    });

    // Filtering
    let filtered = clients;
    const { container: containerFilter, status, search } = req.query;
    if (containerFilter) filtered = filtered.filter((c) => c.container === containerFilter);
    if (status === 'online') filtered = filtered.filter((c) => c.isOnline);
    if (status === 'offline') filtered = filtered.filter((c) => !c.isOnline);
    if (search) {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.ip?.includes(q) ||
          c.container?.toLowerCase().includes(q)
      );
    }

    // Pagination — when ?page is provided, cap page size to a sensible default
    // (50) and validate against the schema; otherwise return the full list.
    const PAGE_SIZE_DEFAULT = 50;
    const PAGE_SIZE_MAX = 500;
    const pageParsed = paginationSchema.safeParse(req.query);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const requestedLimit = pageParsed.success ? pageParsed.data.limit : null;
    const pageSize = Math.min(PAGE_SIZE_MAX, requestedLimit || PAGE_SIZE_DEFAULT);

    const total = filtered.length;
    const paginated = req.query.page
      ? filtered.slice((page - 1) * pageSize, page * pageSize)
      : filtered;

    res.json(
      req.query.page
        ? {
            clients: paginated,
            pagination: { page, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) },
          }
        : filtered
    );
  })
);

router.get(
  '/export',
  auth,
  asyncWrap(async (req, res) => {
    const format = req.query.format === 'json' ? 'json' : 'csv';
    let allClients = await db.select().from(schema.clients);

    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      const ownedContainers = await db
        .select({ name: schema.containers.name })
        .from(schema.containers)
        .where(eq(schema.containers.owner, req.user.username));
      const ownedNames = new Set(ownedContainers.map((c) => c.name));
      allClients = allClients.filter((c) => ownedNames.has(c.container));
    }

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="wg-clients-${Date.now()}.json"`);
      return res.json(allClients);
    }

    const headers = [
      'name',
      'container',
      'ip',
      'publicKey',
      'expiry',
      'quota',
      'uploadLimit',
      'createdAt',
    ];
    const rows = allClients.map((c) =>
      headers
        .map((h) => `"${String(c[h] !== undefined ? c[h] : '').replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="wg-clients-${Date.now()}.csv"`);
    res.send('\uFEFF' + csv);
  })
);

router.post(
  '/',
  auth,
  requireLicense,
  requireClientCapacity,
  creationLimiter,
  asyncWrap(async (req, res) => {
    const result = clientSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(createError(result.error, 'Validation failed'));
    }

    const { container, name, expiry, quota, uploadLimit } = result.data;

    // Check ownership before proceeding
    const [existingContainer] = await db
      .select()
      .from(schema.containers)
      .where(eq(schema.containers.name, container))
      .limit(1);

    if (existingContainer) {
      if (
        req.user.role !== 'admin' &&
        req.user.role !== 'manager' &&
        existingContainer.owner !== req.user.username
      ) {
        return res.status(403).json(createError('Forbidden: Vous ne possédez pas ce conteneur.'));
      }
    } else {
      // Container doesn't exist yet — admin/manager, ou un REVENDEUR (il devient
      // propriétaire du conteneur créé : c'est son espace de travail). Un simple
      // viewer reste bloqué.
      if (
        req.user.role !== 'admin' &&
        req.user.role !== 'manager' &&
        req.user.role !== 'reseller'
      ) {
        return res
          .status(403)
          .json(createError('Forbidden: Conteneur inexistant ou accès refusé.'));
      }
    }

    // Early duplicate check — avoids running the WG script unnecessarily and
    // gives a clear French error message instead of a raw SQLITE_CONSTRAINT later.
    const [existingClient] = await db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)))
      .limit(1);
    if (existingClient) {
      return res
        .status(409)
        .json(
          createError(
            `Un client nommé '${name}' existe déjà dans le conteneur '${container}'`,
            'Client already exists',
            'CONFLICT'
          )
        );
    }

    // Exécuteur cible (local ou SSH distant selon req.serverId).
    const executor = await resolveExecutor(req);

    // Auto-create container if missing (idempotent). En LOCAL on confirme via le
    // filesystem (gère la dérive DB/FS) ; en DISTANT la DB fait foi (pas de fs).
    let containerExists = !!existingContainer;
    if (!req.serverId) {
      const clientsBaseDir = process.env.WG_CLIENTS_DIR || '/etc/wireguard/clients';
      const containerDir = path.join(clientsBaseDir, container);
      try {
        const stat = await fsPromises.stat(containerDir);
        containerExists = stat.isDirectory();
      } catch (_err) {
        containerExists = false;
      }
    }
    if (!containerExists) {
      const { success, error } = await runSystemCommand(
        getScriptPath('wg-create-container.sh'),
        [container],
        null,
        { executor }
      );
      if (!success) {
        return res
          .status(500)
          .json(
            createError(
              `Failed to auto-create container ${container}: ${error}`,
              null,
              'CONTAINER_CREATE_FAILED'
            )
          );
      }
    }
    await db
      .insert(schema.containers)
      .values({
        name: container,
        owner: req.user.username,
        interface: 'wg0',
        serverId: req.serverId || null,
      })
      .onConflictDoNothing();

    const { success, error, code, stdout } = await runSystemCommand(
      getScriptPath('wg-create-client.sh'),
      [container, name, expiry || '', quota || 0, uploadLimit || 0],
      null,
      { executor }
    );

    if (!success) {
      if (code === 'EPERM_SAFE_EXEC') {
        return res
          .status(403)
          .json(createError(error, 'Hardening policy violation', 'EPERM_SAFE_EXEC'));
      }
      throw createError(error, 'Client creation failed', 'SYSTEM_ERROR');
    }

    // 🛡️ OBSIDIAN-HARDENING: Capture public key from script output or generated file
    let publicKey = '';
    const pkMatch =
      (stdout || '').match(/PublicKey\s*=\s*(\S+)/i) || (stdout || '').match(/^(\S{43}=)$/m);

    if (pkMatch) {
      publicKey = pkMatch[1];
    } else {
      // SRE FIX: Read the CLIENT's public key from its own public.key file
      // NOT from the .conf (which contains the SERVER's PublicKey in [Peer])
      // Lectures via le proxy sécurisé (local OU SSH distant via {executor}).
      const clientDir = getClientDir(container, name);
      const publicKeyPath = path.join(clientDir, 'public.key');
      const pkRead = await readFileAsRoot(publicKeyPath, { executor });
      if (pkRead.success && pkRead.content && pkRead.content.trim()) {
        publicKey = pkRead.content.trim();
      } else {
        // Secondary fallback: try reading PrivateKey from .conf and derive pubkey
        log.warn('clients', `public.key not found for ${name}, trying .conf fallback`, {
          err: pkRead.error,
        });
        try {
          const config = await readClientConfig(container, name, executor);
          // Extract PrivateKey (client's own key) from [Interface] section
          const privMatch = config && config.match(/PrivateKey\s*=\s*([a-zA-Z0-9+/=]{44})/);
          if (privMatch) {
            // Derive public key from private key using wg pubkey via stdin.
            // Crypto pure → reste LOCAL (pas d'{executor}), même pour un VPS distant.
            const { stdout: derivedPk } = await runSystemCommand(WG_BIN, ['pubkey'], privMatch[1]);
            if (derivedPk && derivedPk.trim().length === 44) {
              publicKey = derivedPk.trim();
            }
          }
        } catch (e2) {
          log.warn('clients', `Could not derive publicKey for ${name}`, { err: e2.message });
        }
        // Final emergency fallback
        if (!publicKey) {
          throw createError(
            'Failed to extract client public key. Cannot create client without valid key.',
            null,
            'SYSTEM_ERROR'
          );
        }
      }
    }

    // Extract the client's assigned IP from its config file (wg-create-client.sh
    // writes it there but doesn't output it to stdout/stderr in a parseable way).
    let clientIp = null;
    try {
      const confText = await readClientConfig(container, name, executor);
      const addrMatch =
        confText && confText.match(/^\s*Address\s*=\s*([0-9]{1,3}(?:\.[0-9]{1,3}){3})/m);
      if (addrMatch) clientIp = addrMatch[1];
    } catch {
      /* non-blocking — ip stays null */
    }

    let newClient;
    try {
      [newClient] = await db
        .insert(schema.clients)
        .values({
          container,
          name,
          publicKey,
          ip: clientIp,
          expiry: expiry || null,
          quota,
          uploadLimit,
          enabled: true,
        })
        .returning();
    } catch (dbErr) {
      if (
        dbErr.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        dbErr.message?.includes('UNIQUE constraint')
      ) {
        // Race condition: two concurrent requests passed the early check simultaneously.
        // Return a clear French message — the client was created by the first request.
        return res
          .status(409)
          .json(
            createError(
              `Un client nommé '${name}' existe déjà dans le conteneur '${container}'`,
              'Client already exists',
              'CONFLICT'
            )
          );
      }
      throw dbErr;
    }

    await auditLog({
      actor: req.user.username,
      action: 'create',
      targetType: 'client',
      targetName: `${container}/${name}`,
      details: { quota, expiry },
      ip: req.ip,
    });

    res.json(newClient);
  })
);

router.post(
  '/:container/:name/toggle',
  auth,
  asyncWrap(async (req, res) => {
    const parsed = toggleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Validation failed'));
    }

    const { container, name } = req.params;
    const { enabled } = parsed.data;
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)))
      .limit(1);
    if (!client) {
      return res.status(404).json(createError('Client not found', null, 'NOT_FOUND'));
    }

    const clientDir = getClientDir(container, name);
    const publicKey = client.publicKey;
    const executor = await resolveExecutor(req);

    if (enabled) {
      await unlinkAsRoot(path.join(clientDir, 'disabled'), { executor });
      // allowed-ips depuis la DB (clients.ip), repli config — fonctionne distant.
      const ips = await resolveAllowedIps(client, container, name, executor);
      if (!ips) {
        return res
          .status(404)
          .json(createError(`Adresse introuvable pour ${name}`, null, 'CONFIG_ERROR'));
      }
      await runSystemCommand(
        getScriptPath('wg-toggle.sh'),
        [process.env.WG_INTERFACE || 'wg0', 'peer', publicKey, 'allowed-ips', ips],
        null,
        { executor }
      );
    } else {
      const { success: disabledSuccess, error: disabledError } = await writeFileAsRoot(
        path.join(clientDir, 'disabled'),
        new Date().toISOString(),
        { executor }
      );
      if (!disabledSuccess) {
        return res
          .status(500)
          .json(createError(disabledError, 'Failed to write disabled flag', 'SYSTEM_ERROR'));
      }
      await runSystemCommand(
        getScriptPath('wg-toggle.sh'),
        [process.env.WG_INTERFACE || 'wg0', 'peer', publicKey, 'remove'],
        null,
        { executor }
      );
    }

    await db
      .update(schema.clients)
      .set({ enabled: !!enabled })
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)));

    await auditLog({
      actor: req.user.username,
      action: 'toggle',
      targetType: 'client',
      targetName: `${container}/${name}`,
      details: { enabled: !!enabled },
      ip: req.ip,
    });

    res.json({ success: true });
  })
);

router.delete(
  '/:container/:name',
  auth,
  asyncWrap(async (req, res) => {
    const { container, name } = req.params;

    // BUG-1 FIX: Check DB first, return 404 if absent, then run the script
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)))
      .limit(1);
    if (!client) {
      return res.status(404).json(createError('Client not found', null, 'NOT_FOUND'));
    }

    const executor = await resolveExecutor(req);
    const { success, error } = await runSystemCommand(
      getScriptPath('wg-remove-client.sh'),
      [container, name],
      null,
      { executor }
    );
    if (!success) throw createError(error, 'Removal failed', 'SYSTEM_ERROR');

    await db.delete(schema.usage).where(eq(schema.usage.publicKey, client.publicKey));
    await db.delete(schema.clients).where(eq(schema.clients.publicKey, client.publicKey));
    invalidateSharedPeersCache();

    await auditLog({
      actor: req.user.username,
      action: 'delete',
      targetType: 'client',
      targetName: `${container}/${name}`,
      ip: req.ip,
    });
    res.json({ success: true });
  })
);

router.patch(
  '/:container/:name',
  auth,
  asyncWrap(async (req, res) => {
    const { container, name } = req.params;
    const parsed = clientPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Validation failed'));
    }
    const { expiry, quota, uploadLimit } = parsed.data;
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)))
      .limit(1);
    if (!client) {
      return res.status(404).json(createError('Client not found', null, 'NOT_FOUND'));
    }

    const clientDir = getClientDir(container, name);
    const executor = await resolveExecutor(req);
    const updateData = {};
    if (expiry !== undefined) {
      updateData.expiry = expiry || null;
      if (expiry) {
        const { success } = await writeFileAsRoot(path.join(clientDir, 'expiry'), expiry, {
          executor,
        });
        if (!success) throw createError('Failed to write expiry flag', null, 'SYSTEM_ERROR');
      } else {
        await unlinkAsRoot(path.join(clientDir, 'expiry'), { executor }).catch(() => {});
      }
    }
    if (quota !== undefined) {
      updateData.quota = Math.max(0, parseInt(quota, 10) || 0);
      if (updateData.quota > 0) {
        // BUG-5 FIX: Write the parsed value (updateData.quota) not the raw input (quota)
        const { success } = await writeFileAsRoot(
          path.join(clientDir, 'quota'),
          String(updateData.quota),
          { executor }
        );
        if (!success) throw createError('Failed to write quota flag', null, 'SYSTEM_ERROR');
      } else {
        await unlinkAsRoot(path.join(clientDir, 'quota'), { executor }).catch(() => {});
      }
    }
    if (uploadLimit !== undefined) {
      updateData.uploadLimit = Math.max(0, parseInt(uploadLimit, 10) || 0);
      if (updateData.uploadLimit > 0) {
        const { success } = await writeFileAsRoot(
          path.join(clientDir, 'upload_limit'),
          String(updateData.uploadLimit),
          { executor }
        );
        if (!success) throw createError('Failed to write upload_limit flag', null, 'SYSTEM_ERROR');
      } else {
        await unlinkAsRoot(path.join(clientDir, 'upload_limit'), { executor }).catch(() => {});
      }

      const { success: qosSuccess, error: qosError } = await runSystemCommand(
        getScriptPath('wg-apply-qos.sh'),
        [],
        null,
        { executor }
      );
      if (!qosSuccess) log.error('clients', 'wg-apply-qos failed', { error: qosError });
    }
    await db
      .update(schema.clients)
      .set(updateData)
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)));
    const { success: enfSuccess, error: enfError } = await runSystemCommand(
      getScriptPath('wg-enforcer.sh'),
      [],
      null,
      { executor }
    );
    if (!enfSuccess) log.error('clients', 'wg-enforcer failed', { error: enfError });

    await auditLog({
      actor: req.user.username,
      action: 'patch',
      targetType: 'client',
      targetName: `${container}/${name}`,
      details: updateData,
      ip: req.ip,
    });

    res.json({ success: true });
  })
);

router.post(
  '/bulk-update',
  auth,
  asyncWrap(async (req, res) => {
    const parsed = bulkUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Validation failed'));
    }
    let { clients, update } = parsed.data;
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      const ownedContainers = new Set(
        (
          await db
            .select({ name: schema.containers.name })
            .from(schema.containers)
            .where(eq(schema.containers.owner, req.user.username))
        ).map((c) => c.name)
      );
      clients = clients.filter((c) => ownedContainers.has(c.container));
      if (clients.length === 0) return res.json({ success: 0, failed: 0 });
    }
    const executor = await resolveExecutor(req);
    // Snapshot original state before any writes so the rollback can restore the
    // exact previous value (not just delete the file). Lecture via proxy →
    // fonctionne en local comme à distance (SSH).
    const origStates = {};
    for (const client of clients) {
      const clientDir = getClientDir(client.container, client.name);
      const key = `${client.container}/${client.name}`;
      origStates[key] = {};
      if (update.expiry !== undefined) {
        const r = await readFileAsRoot(path.join(clientDir, 'expiry'), { executor });
        origStates[key].expiry = r.success ? r.content : null;
      }
      if (update.quota !== undefined) {
        const r = await readFileAsRoot(path.join(clientDir, 'quota'), { executor });
        origStates[key].quota = r.success ? r.content : null;
      }
    }

    let successCount = 0,
      failedCount = 0;
    const dbPatch = {};
    if (update.expiry !== undefined) dbPatch.expiry = update.expiry || null;
    if (update.quota !== undefined) dbPatch.quota = update.quota;
    // BUG-2 FIX: Track which clients succeeded on FS so DB only updates those
    const succeededClients = [];
    for (const client of clients) {
      try {
        const clientDir = getClientDir(client.container, client.name);
        if (update.expiry !== undefined) {
          if (update.expiry)
            await writeFileAsRoot(path.join(clientDir, 'expiry'), update.expiry, { executor });
          else await unlinkAsRoot(path.join(clientDir, 'expiry'), { executor }).catch(() => {});
        }
        if (update.quota !== undefined) {
          if (update.quota > 0)
            await writeFileAsRoot(path.join(clientDir, 'quota'), String(update.quota), {
              executor,
            });
          else await unlinkAsRoot(path.join(clientDir, 'quota'), { executor }).catch(() => {});
        }

        succeededClients.push(client);
        successCount++;
      } catch (e) {
        failedCount++;
      }
    }
    if (Object.keys(dbPatch).length > 0 && succeededClients.length > 0) {
      try {
        await db.transaction(async (tx) => {
          for (const client of succeededClients) {
            await tx
              .update(schema.clients)
              .set(dbPatch)
              .where(
                and(
                  eq(schema.clients.container, client.container),
                  eq(schema.clients.name, client.name)
                )
              );
          }
        });
      } catch (e) {
        log.error('clients', 'Bulk DB update failed, rolling back filesystem changes', {
          err: e.message,
        });
        // Rollback: restore exact original file state (not just delete)
        for (const client of succeededClients) {
          try {
            const clientDir = getClientDir(client.container, client.name);
            const orig = origStates[`${client.container}/${client.name}`] || {};
            if (update.expiry !== undefined) {
              if (orig.expiry != null)
                await writeFileAsRoot(path.join(clientDir, 'expiry'), orig.expiry, { executor });
              else await unlinkAsRoot(path.join(clientDir, 'expiry'), { executor }).catch(() => {});
            }
            if (update.quota !== undefined) {
              if (orig.quota != null)
                await writeFileAsRoot(path.join(clientDir, 'quota'), orig.quota, { executor });
              else await unlinkAsRoot(path.join(clientDir, 'quota'), { executor }).catch(() => {});
            }
          } catch (_) {
            // ignore cleanup errors during rollback
          }
        }
        failedCount += successCount;
        successCount = 0;
      }
    }
    await runSystemCommand(getScriptPath('wg-enforcer.sh'), [], null, { executor }).catch(() => {});

    await auditLog({
      actor: req.user.username,
      action: 'bulk-update',
      targetType: 'system',
      targetName: 'clients',
      details: { count: successCount, update },
      ip: req.ip,
    });

    res.json({ success: successCount, failed: failedCount });
  })
);

router.post(
  '/bulk-delete',
  auth,
  asyncWrap(async (req, res) => {
    const parsed = bulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Validation failed'));
    }
    let { clients } = parsed.data;
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      const ownedContainers = new Set(
        (
          await db
            .select({ name: schema.containers.name })
            .from(schema.containers)
            .where(eq(schema.containers.owner, req.user.username))
        ).map((c) => c.name)
      );
      clients = clients.filter((c) => ownedContainers.has(c.container));
      if (clients.length === 0) return res.json({ success: 0, failed: 0 });
    }
    const executor = await resolveExecutor(req);
    let successCount = 0,
      failedCount = 0;
    for (const client of clients) {
      try {
        const [dbClient] = await db
          .select()
          .from(schema.clients)
          .where(
            and(
              eq(schema.clients.container, client.container),
              eq(schema.clients.name, client.name)
            )
          )
          .limit(1);
        const { success } = await runSystemCommand(
          getScriptPath('wg-remove-client.sh'),
          [client.container, client.name],
          null,
          { executor }
        );
        // BUG-3 FIX: Count as success if script succeeded, regardless of dbClient
        if (success) {
          if (dbClient) {
            await db.delete(schema.usage).where(eq(schema.usage.publicKey, dbClient.publicKey));
            await db.delete(schema.clients).where(eq(schema.clients.publicKey, dbClient.publicKey));
          }
          successCount++;
        } else {
          failedCount++;
        }
      } catch (e) {
        failedCount++;
      }
    }
    await auditLog({
      actor: req.user.username,
      action: 'bulk-delete',
      targetType: 'system',
      targetName: 'clients',
      details: { count: successCount },
      ip: req.ip,
    });

    res.json({ success: successCount, failed: failedCount });
  })
);

router.post(
  '/move',
  auth,
  asyncWrap(async (req, res) => {
    const parsed = moveClientSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json(createError(parsed.error, 'Validation failed'));
    const { container, name, newContainer } = parsed.data;
    if (!(await verifyOwnership(req, container)) || !(await verifyOwnership(req, newContainer))) {
      return res.status(403).json(createError('Forbidden: Vous ne possédez pas ces conteneurs.'));
    }
    const [clientToMove] = await db
      .select({ id: schema.clients.id })
      .from(schema.clients)
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)))
      .limit(1);
    if (!clientToMove)
      return res.status(404).json(createError('Client not found', null, 'NOT_FOUND'));
    const executor = await resolveExecutor(req);
    const { success, error } = await runSystemCommand(
      getScriptPath('wg-move-client.sh'),
      [container, name, newContainer],
      null,
      { executor }
    );
    if (!success) throw createError(error, 'Move failed', 'SYSTEM_ERROR');
    await db
      .update(schema.clients)
      .set({ container: newContainer })
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)));

    await auditLog({
      actor: req.user.username,
      action: 'move',
      targetType: 'client',
      targetName: `${container}/${name}`,
      details: { from: container, to: newContainer },
      ip: req.ip,
    });

    res.json({ success: true });
  })
);

router.get(
  '/:container/:name/history',
  auth,
  asyncWrap(async (req, res) => {
    const { container, name } = req.params;
    const parsed = paginationSchema.safeParse(req.query);
    const limit = parsed.success ? parsed.data.limit : 50;
    const offset = parsed.success ? parsed.data.offset : 0;

    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)))
      .limit(1);
    if (!client) return res.status(404).json(createError('Client not found', null, 'NOT_FOUND'));

    const history = await db
      .select()
      .from(schema.logs)
      .where(and(eq(schema.logs.type, 'snapshot'), eq(schema.logs.name, client.publicKey)))
      .orderBy(desc(schema.logs.timestamp))
      .limit(limit)
      .offset(offset);
    res.json(history);
  })
);

router.get(
  '/:container/:name/history-hours',
  auth,
  asyncWrap(async (req, res) => {
    const { container, name } = req.params;
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)))
      .limit(1);
    if (!client) return res.status(404).json(createError('Client not found', null, 'NOT_FOUND'));

    const history = await db
      .select()
      .from(schema.logs)
      .where(and(eq(schema.logs.type, 'snapshot'), eq(schema.logs.name, client.publicKey)))
      .orderBy(desc(schema.logs.timestamp))
      .limit(72);

    res.json(history.map((h) => ({ time: h.timestamp, rx: h.usageDaily, tx: h.usageTotal })));
  })
);

router.get(
  '/:container/:name/config',
  auth,
  asyncWrap(async (req, res) => {
    const { container, name } = req.params;
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)))
      .limit(1);
    if (!client) return res.status(404).json(createError('Client not found', null, 'NOT_FOUND'));

    const executor = await resolveExecutor(req);
    // Lecture via proxy sécurisé → fonctionne local ET sur VPS distant (SSH).
    const configText = await readClientConfig(container, name, executor);
    if (!configText) {
      throw createError('Configuration file not found', null, 'NOT_FOUND');
    }
    await auditLog({
      actor: req.user.username,
      action: 'download_config',
      targetType: 'client',
      targetName: `${container}/${name}`,
      ip: req.ip,
    });
    res.json({ config: configText });
  })
);

// SQLite's SQLITE_MAX_VARIABLE_NUMBER is 32766 on modern versions but we use a
// conservative batch size to avoid issues on older builds or very large arrays.
const SQLITE_BATCH = 500;
const inArrayBatched = async (table, column, ids, selectFn) => {
  if (ids.length === 0) return [];
  const results = await Promise.all(
    Array.from({ length: Math.ceil(ids.length / SQLITE_BATCH) }, (_, i) =>
      selectFn(ids.slice(i * SQLITE_BATCH, (i + 1) * SQLITE_BATCH))
    )
  );
  return results.flat();
};

// Aggregate stats per container — used by the dashboard stats widget.
// Returns { [containerName]: { totalClients, activeClients, totalBytes, owner } }
router.get(
  '/stats/by-container',
  auth,
  asyncWrap(async (req, res) => {
    const allContainers = await db.select().from(schema.containers);
    const visible =
      req.user.role === 'admin' || req.user.role === 'manager'
        ? allContainers
        : allContainers.filter((c) => c.owner === req.user.username);

    if (visible.length === 0) return res.json({});

    const containerNames = visible.map((c) => c.name);
    const allClients = await inArrayBatched(
      schema.clients,
      schema.clients.container,
      containerNames,
      (chunk) => db.select().from(schema.clients).where(inArray(schema.clients.container, chunk))
    );

    const pubKeys = allClients.map((c) => c.publicKey).filter(Boolean);
    const usageRows =
      pubKeys.length > 0
        ? await inArrayBatched(schema.usage, schema.usage.publicKey, pubKeys, (chunk) =>
            db.select().from(schema.usage).where(inArray(schema.usage.publicKey, chunk))
          )
        : [];

    const usageMap = {};
    usageRows.forEach((u) => {
      usageMap[u.publicKey] = u.total || 0;
    });

    const result = {};
    for (const ctr of visible) {
      const clients = allClients.filter((c) => c.container === ctr.name);
      const totalBytes = clients.reduce((sum, c) => sum + (usageMap[c.publicKey] || 0), 0);
      result[ctr.name] = {
        totalClients: clients.length,
        activeClients: clients.filter((c) => c.enabled !== false).length,
        totalBytes,
        owner: ctr.owner,
      };
    }
    res.json(result);
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// Réconciliation DB ↔ filesystem ↔ WireGuard (contexte LOCAL uniquement).
//
// Trois sources de vérité peuvent diverger (réinstallation, volume Docker
// survivant à une désinstallation, crash pendant une création…) :
//   - la DB (clients/containers),
//   - /etc/wireguard/clients/<container>/<client>/ (clés, ip, conf),
//   - les peers effectivement chargés dans le noyau (`wg show`).
// GET  /reconcile → rapport (manager+) ; POST /reconcile → répare (admin).
// ─────────────────────────────────────────────────────────────────────────────

// Inventaire des trois mondes. Retourne aussi les orphelins croisés.
async function buildReconcileReport() {
  const clientsBaseDir = process.env.WG_CLIENTS_DIR || '/etc/wireguard/clients';

  // 1. Filesystem : container/client (répertoires).
  const fsSet = new Set(); // "container/name"
  try {
    const containers = await fsPromises.readdir(clientsBaseDir, { withFileTypes: true });
    for (const c of containers) {
      if (!c.isDirectory()) continue;
      const sub = await fsPromises
        .readdir(path.join(clientsBaseDir, c.name), { withFileTypes: true })
        .catch(() => []);
      for (const cl of sub) {
        if (cl.isDirectory()) fsSet.add(`${c.name}/${cl.name}`);
      }
    }
  } catch {
    /* dossier absent = zéro entrée */
  }

  // 2. Peers noyau : clés publiques chargées, toutes interfaces WG.
  const peerKeys = new Set();
  try {
    const { getInterfaces } = require('../services/system');
    const wgIfaces = (await getInterfaces())
      .filter((i) => i.type === 'WireGuard')
      .map((i) => i.name);
    for (const iface of wgIfaces) {
      const stdout = await getWireGuardStats(iface);
      for (const p of parseWireGuardDump(stdout)) peerKeys.add(p.publicKey);
    }
  } catch {
    /* interface down : peers = 0, le rapport le montrera */
  }

  // 3. DB : clients des conteneurs LOCAUX (serverId NULL) — les conteneurs des
  // VPS distants ont leur propre instance, hors périmètre.
  const allContainers = await db.select().from(schema.containers);
  const localNames = new Set(
    allContainers.filter((c) => c.serverId == null).map((c) => c.name)
  );
  const dbClients = (await db.select().from(schema.clients)).filter(
    (c) => localNames.has(c.container) || !allContainers.some((x) => x.name === c.container)
  );

  const dbOrphans = []; // en DB, aucun dossier sur le disque (fantômes)
  const missingPeers = []; // DB + disque OK mais absent du noyau
  for (const c of dbClients) {
    const key = `${c.container}/${c.name}`;
    if (!fsSet.has(key)) {
      dbOrphans.push({ id: c.id, container: c.container, name: c.name });
    } else if (c.enabled !== false && c.publicKey && !peerKeys.has(c.publicKey)) {
      missingPeers.push({ container: c.container, name: c.name });
    }
  }
  const dbKeys = new Set(dbClients.map((c) => `${c.container}/${c.name}`));
  const fsOrphans = [...fsSet]
    .filter((k) => !dbKeys.has(k))
    .map((k) => {
      const [container, name] = k.split('/');
      return { container, name };
    });

  return {
    counts: { db: dbClients.length, fs: fsSet.size, peers: peerKeys.size },
    dbOrphans,
    fsOrphans,
    missingPeers,
  };
}

router.get(
  '/reconcile',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
    if (req.serverId) {
      return res
        .status(400)
        .json(createError('Réconciliation locale uniquement (instance distante = sa propre UI)'));
    }
    res.json(await buildReconcileReport());
  })
);

// Répare : { purgeDbOrphans: true } supprime les fantômes DB (clients sans
// aucun fichier — typiquement une vieille base ayant survécu à une réinstall
// via le volume Docker) ; { applyPeers: true } ré-applique les peers du disque
// dans le noyau (wg-sync-peers.sh). Les listes sont TOUJOURS recalculées côté
// serveur — on ne supprime jamais sur la foi d'une liste envoyée par le client.
router.post(
  '/reconcile',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    if (req.serverId) {
      return res.status(400).json(createError('Réconciliation locale uniquement'));
    }
    const { purgeDbOrphans, applyPeers } = req.body || {};
    const report = await buildReconcileReport();
    const result = { purged: 0, peersApplied: false };

    if (purgeDbOrphans === true && report.dbOrphans.length > 0) {
      const ids = report.dbOrphans.map((o) => o.id);
      await inArrayBatched(schema.clients, schema.clients.id, ids, (chunk) =>
        db.delete(schema.clients).where(inArray(schema.clients.id, chunk))
      );
      result.purged = ids.length;

      // Conteneurs locaux devenus vides ET sans dossier disque → poussière de
      // l'ancienne base, on les retire aussi.
      const remaining = await db.select().from(schema.clients);
      const still = new Set(remaining.map((c) => c.container));
      const clientsBaseDir = process.env.WG_CLIENTS_DIR || '/etc/wireguard/clients';
      const allContainers = await db.select().from(schema.containers);
      for (const ctr of allContainers) {
        if (ctr.serverId != null || still.has(ctr.name)) continue;
        const onDisk = await fsPromises
          .stat(path.join(clientsBaseDir, ctr.name))
          .then((s) => s.isDirectory())
          .catch(() => false);
        if (!onDisk) {
          await db.delete(schema.containers).where(eq(schema.containers.name, ctr.name));
          result.purged += 1;
        }
      }
    }

    if (applyPeers === true) {
      const { success, error } = await runSystemCommand(
        getScriptPath('wg-sync-peers.sh'),
        [process.env.WG_INTERFACE || 'wg0'],
        null,
        {}
      );
      result.peersApplied = success;
      if (!success) result.peersError = error;
    }

    await auditLog({
      actor: req.user.username,
      action: 'reconcile',
      targetType: 'system',
      targetName: 'clients',
      details: { purgeDbOrphans: !!purgeDbOrphans, applyPeers: !!applyPeers, ...result },
      ip: req.ip,
    });

    res.json({ success: true, ...result, after: await buildReconcileReport() });
  })
);

module.exports = router;

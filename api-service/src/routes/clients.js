const express = require('express');
const router = express.Router();
const path = require('path');
const fsPromises = require('fs').promises;
const { db, schema } = require('../../db');
const { eq, and, desc } = require('drizzle-orm');
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
const { auth, requireManager } = require('../middleware/auth');
const { runSystemCommand, writeFileAsRoot, unlinkAsRoot } = require('../services/shell');
const { getWireGuardStats, getClientDir, parseWireGuardDump } = require('../services/system');
const { getScriptPath } = require('../services/config');
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

// 🛡️ OBSIDIAN-HARDENING: Global parameter validation
router.param('container', (req, res, next, val) => {
  if (!identifierRegex.test(val))
    return res.status(400).json(createError('Invalid container identifier'));
  next();
});
router.param('name', (req, res, next, val) => {
  if (!identifierRegex.test(val))
    return res.status(400).json(createError('Invalid client identifier'));
  next();
});

// --- Container Routes ---

router.get(
  '/containers',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
    const dir = process.env.WG_CLIENTS_DIR || '/etc/wireguard/clients';
    try {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });
      const containers = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
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
  requireManager,
  creationLimiter,
  asyncWrap(async (req, res) => {
    const parsed = containerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Validation error for container name'));
    }
    const { name } = parsed.data;
    const { success, error } = await runSystemCommand(getScriptPath('wg-create-container.sh'), [
      name,
    ]);
    if (!success) {
      throw createError(error, 'Failed to create container', 'SYSTEM_ERROR');
    }

    // 🛡️ Sync DB
    await db.insert(schema.containers).values({ name, interface: 'wg0' }).onConflictDoNothing();

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
  requireManager,
  asyncWrap(async (req, res) => {
    const { name } = req.params;
    const { success, error } = await runSystemCommand(getScriptPath('wg-remove-container.sh'), [
      name,
    ]);
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
  requireManager,
  asyncWrap(async (req, res) => {
    const { getInterfaces } = require('../services/system');
    const allInterfaces = await getInterfaces();
    const wgInterfaces = allInterfaces.filter((i) => i.type === 'WireGuard').map((i) => i.name);

    const wgStats = {};
    for (const iface of wgInterfaces) {
      const stdout = await getWireGuardStats(iface);
      const peers = parseWireGuardDump(stdout);
      peers.forEach((p) => {
        wgStats[p.publicKey] = { ...p, interface: iface };
      });
    }

    const dbClients = await db.select().from(schema.clients);

    const clients = dbClients.map((c) => {
      const stat = wgStats[c.publicKey];
      return {
        ...c,
        id: c.id,
        interface: stat ? stat.interface : 'wg0',
        lastHandshake: stat ? stat.lastSeen : 0,
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
  requireManager,
  asyncWrap(async (req, res) => {
    const format = req.query.format === 'json' ? 'json' : 'csv';
    const allClients = await db.select().from(schema.clients);

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
  requireManager,
  creationLimiter,
  asyncWrap(async (req, res) => {
    const result = clientSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(createError(result.error, 'Validation failed'));
    }

    const { container, name, expiry, quota, uploadLimit } = result.data;

    // Auto-create container on filesystem+DB if missing (idempotent)
    const clientsBaseDir = process.env.WG_CLIENTS_DIR || '/etc/wireguard/clients';
    const containerDir = path.join(clientsBaseDir, container);
    try {
      const stat = await fsPromises.stat(containerDir);
      if (!stat.isDirectory()) throw new Error('not a directory');
    } catch (_err) {
      const { success, error } = await runSystemCommand(getScriptPath('wg-create-container.sh'), [
        container,
      ]);
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
      .values({ name: container, interface: 'wg0' })
      .onConflictDoNothing();

    const { success, error, code, stdout } = await runSystemCommand(
      getScriptPath('wg-create-client.sh'),
      [container, name, expiry || '', quota || 0, uploadLimit || 0]
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
      const clientDir = getClientDir(container, name);
      const publicKeyPath = path.join(clientDir, 'public.key');
      try {
        publicKey = (await fsPromises.readFile(publicKeyPath, 'utf8')).trim();
      } catch (e1) {
        // Secondary fallback: try reading PrivateKey from .conf and derive pubkey
        log.warn('clients', `public.key not found for ${name}, trying .conf fallback`, {
          err: e1.message,
        });
        try {
          const configPath = path.join(clientDir, `${name}.conf`);
          const config = await fsPromises.readFile(configPath, 'utf8');
          // Extract PrivateKey (client's own key) from [Interface] section
          const privMatch = config.match(/PrivateKey\s*=\s*([a-zA-Z0-9+/=]{44})/);
          if (privMatch) {
            // Derive public key from private key using wg pubkey via stdin
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

    let newClient;
    try {
      [newClient] = await db
        .insert(schema.clients)
        .values({ container, name, publicKey, expiry, quota, uploadLimit, enabled: true })
        .returning();
    } catch (dbErr) {
      if (
        dbErr.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
        dbErr.message?.includes('UNIQUE constraint')
      ) {
        return res
          .status(409)
          .json(
            createError(
              `Client '${name}' already exists in database`,
              'Duplicate client entry',
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
  requireManager,
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

    if (enabled) {
      await unlinkAsRoot(path.join(clientDir, 'disabled'));
      let config;
      try {
        config = await fsPromises.readFile(path.join(clientDir, `${name}.conf`), 'utf8');
      } catch (err) {
        return res
          .status(404)
          .json(createError(`Config file for ${name} not found`, null, 'NOT_FOUND'));
      }
      const addressMatch = config.match(/^\s*Address\s*=\s*([^#\n]+)/m);
      if (!addressMatch) {
        throw createError(`Invalid configuration file for ${name}`, null, 'CONFIG_ERROR');
      }
      const ips = addressMatch?.[1]
        .trim()
        .split(',')
        .map((ip) => ip.trim().split('/')?.[0])
        .map((ip) => (ip.includes(':') ? `${ip}/128` : `${ip}/32`))
        .join(',');
      await runSystemCommand(getScriptPath('wg-toggle.sh'), [
        process.env.WG_INTERFACE || 'wg0',
        'peer',
        publicKey,
        'allowed-ips',
        ips,
      ]);
    } else {
      const { success: disabledSuccess, error: disabledError } = await writeFileAsRoot(
        path.join(clientDir, 'disabled'),
        new Date().toISOString()
      );
      if (!disabledSuccess) {
        return res
          .status(500)
          .json(createError(disabledError, 'Failed to write disabled flag', 'SYSTEM_ERROR'));
      }
      await runSystemCommand(getScriptPath('wg-toggle.sh'), [
        process.env.WG_INTERFACE || 'wg0',
        'peer',
        publicKey,
        'remove',
      ]);
    }

    await db
      .update(schema.clients)
      .set({ enabled: !!enabled })
      .where(eq(schema.clients.publicKey, publicKey));

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
  requireManager,
  asyncWrap(async (req, res) => {
    const { container, name } = req.params;
    const { success, error } = await runSystemCommand(getScriptPath('wg-remove-client.sh'), [
      container,
      name,
    ]);
    if (!success) throw createError(error, 'Removal failed', 'SYSTEM_ERROR');

    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)))
      .limit(1);
    if (client) {
      await db.delete(schema.usage).where(eq(schema.usage.publicKey, client.publicKey));
      await db.delete(schema.clients).where(eq(schema.clients.publicKey, client.publicKey));

      await auditLog({
        actor: req.user.username,
        action: 'delete',
        targetType: 'client',
        targetName: `${container}/${name}`,
        ip: req.ip,
      });
    }
    res.json({ success: true });
  })
);

router.patch(
  '/:container/:name',
  auth,
  requireManager,
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
    const updateData = {};
    if (expiry !== undefined) {
      updateData.expiry = expiry || null;
      if (expiry) {
        const { success } = await writeFileAsRoot(path.join(clientDir, 'expiry'), expiry);
        if (!success) throw createError('Failed to write expiry flag', null, 'SYSTEM_ERROR');
      } else {
        await unlinkAsRoot(path.join(clientDir, 'expiry')).catch(() => {});
      }
    }
    if (quota !== undefined) {
      updateData.quota = Math.max(0, parseInt(quota, 10) || 0);
      if (updateData.quota > 0) {
        const { success } = await writeFileAsRoot(path.join(clientDir, 'quota'), String(quota));
        if (!success) throw createError('Failed to write quota flag', null, 'SYSTEM_ERROR');
      } else {
        await unlinkAsRoot(path.join(clientDir, 'quota')).catch(() => {});
      }
    }
    if (uploadLimit !== undefined) {
      updateData.uploadLimit = Math.max(0, parseInt(uploadLimit, 10) || 0);
      if (updateData.uploadLimit > 0) {
        const { success } = await writeFileAsRoot(
          path.join(clientDir, 'upload_limit'),
          String(uploadLimit)
        );
        if (!success) throw createError('Failed to write upload_limit flag', null, 'SYSTEM_ERROR');
      } else {
        await unlinkAsRoot(path.join(clientDir, 'upload_limit')).catch(() => {});
      }

      const { success: qosSuccess, error: qosError } = await runSystemCommand(
        getScriptPath('wg-apply-qos.sh'),
        []
      );
      if (!qosSuccess) log.error('clients', 'wg-apply-qos failed', { error: qosError });
    }
    await db
      .update(schema.clients)
      .set(updateData)
      .where(eq(schema.clients.publicKey, client.publicKey));
    const { success: enfSuccess, error: enfError } = await runSystemCommand(
      getScriptPath('wg-enforcer.sh'),
      []
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
  requireManager,
  asyncWrap(async (req, res) => {
    const parsed = bulkUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Validation failed'));
    }
    const { clients, update } = parsed.data;
    let successCount = 0,
      failedCount = 0;
    const dbPatch = {};
    if (update.expiry !== undefined) dbPatch.expiry = update.expiry || null;
    if (update.quota !== undefined) dbPatch.quota = update.quota;
    for (const client of clients) {
      try {
        const clientDir = getClientDir(client.container, client.name);
        if (update.expiry !== undefined) {
          if (update.expiry) await writeFileAsRoot(path.join(clientDir, 'expiry'), update.expiry);
          else await unlinkAsRoot(path.join(clientDir, 'expiry')).catch(() => {});
        }
        if (update.quota !== undefined) {
          if (update.quota > 0)
            await writeFileAsRoot(path.join(clientDir, 'quota'), String(update.quota));
          else await unlinkAsRoot(path.join(clientDir, 'quota')).catch(() => {});
        }

        successCount++;
      } catch (e) {
        failedCount++;
      }
    }
    if (Object.keys(dbPatch).length > 0 && successCount > 0) {
      try {
        await db.transaction(async (tx) => {
          for (const client of clients) {
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
        // Rollback filesystem changes to avoid desync
        for (const client of clients) {
          try {
            const clientDir = getClientDir(client.container, client.name);
            if (update.expiry !== undefined) {
              await unlinkAsRoot(path.join(clientDir, 'expiry')).catch(() => {});
            }
            if (update.quota !== undefined) {
              await unlinkAsRoot(path.join(clientDir, 'quota')).catch(() => {});
            }
          } catch (_) {
            // ignore cleanup errors during rollback
          }
        }
        failedCount += successCount;
        successCount = 0;
      }
    }
    await runSystemCommand(getScriptPath('wg-enforcer.sh'), []).catch(() => {});

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
  requireManager,
  asyncWrap(async (req, res) => {
    const parsed = bulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Validation failed'));
    }
    const { clients } = parsed.data;
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
        const { success } = await runSystemCommand(getScriptPath('wg-remove-client.sh'), [
          client.container,
          client.name,
        ]);
        if (success && dbClient) {
          await db.delete(schema.usage).where(eq(schema.usage.publicKey, dbClient.publicKey));
          await db.delete(schema.clients).where(eq(schema.clients.publicKey, dbClient.publicKey));
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
  requireManager,
  asyncWrap(async (req, res) => {
    const parsed = moveClientSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json(createError(parsed.error, 'Validation failed'));
    const { container, name, newContainer } = parsed.data;
    const { success, error } = await runSystemCommand(getScriptPath('wg-move-client.sh'), [
      container,
      name,
      newContainer,
    ]);
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
  requireManager,
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
  requireManager,
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
  requireManager,
  asyncWrap(async (req, res) => {
    const { container, name } = req.params;
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)))
      .limit(1);
    if (!client) return res.status(404).json(createError('Client not found', null, 'NOT_FOUND'));

    const clientDir = getClientDir(container, name);
    const configPath = path.join(clientDir, `${name}.conf`);
    try {
      const configText = await fsPromises.readFile(configPath, 'utf8');
      res.json({ config: configText });
    } catch (err) {
      if (err.code === 'ENOENT') {
        throw createError('Configuration file not found', null, 'NOT_FOUND');
      }
      throw err;
    }
  })
);

module.exports = router;

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
} = require('../../db/validation');
const { auth, requireManager } = require('../middleware/auth');
const { runSystemCommand, writeFileAsRoot, unlinkAsRoot } = require('../services/shell');
const {
  getWireGuardStats,
  getClientDir,
  isValidName,
  parseWireGuardDump,
  waitForFile,
} = require('../services/system');
const { getScriptPath } = require('../services/config');
const { auditLog } = require('../services/audit');
const log = require('../services/logger');
const { asyncWrap } = require('../utils/errors');


// --- Container Routes ---

router.get('/containers', auth, asyncWrap(async (req, res) => {
  const dir = process.env.WG_CLIENTS_DIR || '/etc/wireguard/clients';
  try {
    const entries = await fsPromises.readdir(dir, { withFileTypes: true });
    const containers = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    res.json(containers);
  } catch (error) {
    if (error.code === 'ENOENT') return res.json([]);
    throw error; // Let asyncWrap + global handler log it
  }
}));

router.post('/containers', auth, requireManager, asyncWrap(async (req, res) => {
  // Validation Zod sur le nom du container
  const parsed = containerSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: parsed.error.errors?.[0]?.message || 'Validation failed' });
  const { name } = parsed.data;
  const { success, error } = await runSystemCommand(getScriptPath('wg-create-container.sh'), [
    name,
  ]);
  if (!success) {
    const err = new Error(error);
    err.status = 500;
    throw err;
  }

  await auditLog({
    actor: req.user.username,
    action: 'create_container',
    target: name,
    status: 'success',
  });
  res.json({ success: true });
}));

router.delete('/containers/:name', auth, requireManager, asyncWrap(async (req, res) => {
  const { name } = req.params;
  const { success, error } = await runSystemCommand(getScriptPath('wg-delete-container.sh'), [
    name,
  ]);
  if (!success) {
    const err = new Error(error);
    err.status = 500;
    throw err;
  }

  await auditLog({
    actor: req.user.username,
    action: 'delete_container',
    target: name,
    status: 'success',
  });
  res.json({ success: true });
}));

// --- Client Routes ---

router.get('/', auth, asyncWrap(async (req, res) => {
  const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 10000), 10000);
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const today = new Date().toISOString().split('T')?.[0];

  const stdout = await getWireGuardStats();
  const peers = parseWireGuardDump(stdout);
  const wgStats = Object.fromEntries(peers.map((p) => [p.publicKey, p]));

  const dbClients = await db
    .select()
    .from(schema.clients);

  const clients = dbClients.map((c) => {
    const stat = wgStats[c.publicKey];
    return {
      ...c,
      id: `${c.container}-${c.name}`,
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

  // Pagination
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(req.query.limit) || filtered.length));
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
}));

// GET /api/clients/export — Export CSV ou JSON de tous les clients
router.get('/export', auth, async (req, res) => {
  try {
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
    res.send('\uFEFF' + csv); // BOM UTF-8 pour compatibilité Excel
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', auth, requireManager, async (req, res) => {
  try {
    const result = clientSchema.safeParse(req.body);
    if (!result.success) return res.status(400).json({ error: result.error.errors?.[0].message });

    const { name, container, expiry, quota, uploadLimit } = result.data;
    const cleanExpiry = expiry || '';

    // 💠 SRE: L'orchestration concurrente est déléguée au lock OS (flock) du script Bash.
    const getClientData = async () => {
      const { success, error } = await runSystemCommand(getScriptPath('wg-create-client.sh'), [
        container,
        name,
        cleanExpiry,
        String(quota || ''),
        String(uploadLimit || '0'),
      ]);
      if (!success) throw new Error(error || 'Script execution failed');

      const clientDir = getClientDir(container, name);
      const pubKeyFile = path.join(clientDir, 'public.key');
      const confFile = path.join(clientDir, `${name}.conf`);

      // WAIT-FOR-FILE: replacement for brittle setTimeout loop
      const synced = await waitForFile(pubKeyFile);
      if (!synced)
        throw new Error(
          `FileSystem sync failed for ${name} in ${container} (timeout waiting for public.key)`
        );

      const publicKey = await fsPromises.readFile(pubKeyFile, 'utf8').then((s) => s.trim());
      const conf = await fsPromises.readFile(confFile, 'utf8');
      const ipMatch = conf.match(/Address\s*=\s*([^#\n]+)/m);
      const ip = ipMatch ? ipMatch?.[1].split(',')?.[0].trim() : '';

      return { publicKey, ip };
    };

    const clientData = await getClientData();

    await db
      .insert(schema.clients)
      .values({
        container,
        name,
        publicKey: clientData.publicKey,
        ip: clientData.ip,
        expiry: cleanExpiry,
        quota: quota || 0,
        uploadLimit: uploadLimit || 0,
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.clients.publicKey,
        set: {
          name,
          container,
          expiry: cleanExpiry,
          quota: quota || 0,
          uploadLimit: uploadLimit || 0,
        },
      });
    await db
      .insert(schema.usage)
      .values({ publicKey: clientData.publicKey, total: 0, daily: '{}' })
      .onConflictDoNothing();

    await auditLog({
      actor: req.user.username,
      action: 'create',
      targetType: 'client',
      targetName: `${container}/${name}`,
      details: { ip: clientData.ip, publicKey: clientData.publicKey, expiry: cleanExpiry },
      ip: req.ip,
    });

    res.json({ success: true });
  } catch (e) {
    const status = e.message.includes('en cours') || e.code === 'MUTEX_LOCKED' ? 409 : 500;
    log.error('clients', `Client creation failed for ${req.body.name}`, {
      error: e.message,
      code: e.code,
      stack: e.stack,
    });
    res.status(status).json({
      error: e.message,
      code: e.code || 'CREATION_FAILED',
      details: process.env.NODE_ENV === 'development' ? e.stack : undefined,
    });
  }
});

router.post('/:container/:name/toggle', auth, requireManager, async (req, res) => {
  // Validation Zod sur le body
  const parsed = toggleSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: parsed.error.errors?.[0]?.message || 'Validation failed' });

  try {
    const { container, name } = req.params;
    const { enabled } = parsed.data;
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)))
      .limit(1);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const clientDir = getClientDir(container, name);
    const publicKey = client.publicKey;

    if (enabled) {
      await unlinkAsRoot(path.join(clientDir, 'disabled'));
      let config;
      try {
        config = await fsPromises.readFile(path.join(clientDir, `${name}.conf`), 'utf8');
      } catch (err) {
        return res.status(404).json({ error: `Config file for ${name} not found` });
      }
      const addressMatch = config.match(/^\s*Address\s*=\s*([^#\n]+)/m);
      if (!addressMatch) throw new Error(`Invalid configuration file for ${name}`);
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
      if (!disabledSuccess)
        console.error('[API] Warning: Failed to write disabled flag:', disabledError);
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:container/:name', auth, requireManager, async (req, res) => {
  const { container, name } = req.params;
  const { success, error } = await runSystemCommand(getScriptPath('wg-remove-client.sh'), [
    container,
    name,
  ]);
  if (!success) return res.status(500).json({ error });

  try {
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:container/:name', auth, requireManager, async (req, res) => {
  const { container, name } = req.params;
  // Validation Zod sur le patch
  const parsed = clientPatchSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: parsed.error.errors?.[0]?.message || 'Validation failed' });
  const { expiry, quota, uploadLimit } = parsed.data;
  try {
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)))
      .limit(1);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const clientDir = getClientDir(container, name);
    const updateData = {};
    if (expiry !== undefined) {
      updateData.expiry = expiry || null;
      if (expiry) {
        const { success } = await writeFileAsRoot(path.join(clientDir, 'expiry'), expiry);
        if (!success) throw new Error('Failed to write expiry flag');
      } else {
        await unlinkAsRoot(path.join(clientDir, 'expiry')).catch(() => {});
      }
    }
    if (quota !== undefined) {
      updateData.quota = parseInt(quota) || 0;
      if (updateData.quota > 0) {
        const { success } = await writeFileAsRoot(path.join(clientDir, 'quota'), String(quota));
        if (!success) throw new Error('Failed to write quota flag');
      } else {
        await unlinkAsRoot(path.join(clientDir, 'quota')).catch(() => {});
      }
    }
    if (uploadLimit !== undefined) {
      updateData.uploadLimit = parseInt(uploadLimit) || 0;
      if (updateData.uploadLimit > 0) {
        const { success } = await writeFileAsRoot(
          path.join(clientDir, 'upload_limit'),
          String(uploadLimit)
        );
        if (!success) throw new Error('Failed to write upload_limit flag');
      } else {
        await unlinkAsRoot(path.join(clientDir, 'upload_limit')).catch(() => {});
      }

      // BUG-FIX: await corrigé — extraction de error au lieu de .catch() sans rejet
      const { success: qosSuccess, error: qosError } = await runSystemCommand(
        getScriptPath('wg-apply-qos.sh'),
        []
      );
      if (!qosSuccess) console.error('[AUDIT] wg-apply-qos failed:', qosError);
    }
    await db
      .update(schema.clients)
      .set(updateData)
      .where(eq(schema.clients.publicKey, client.publicKey));
    const { success: enfSuccess, error: enfError } = await runSystemCommand(
      getScriptPath('wg-enforcer.sh'),
      []
    );
    if (!enfSuccess) console.error('[AUDIT] wg-enforcer failed:', enfError);

    await auditLog({
      actor: req.user.username,
      action: 'patch',
      targetType: 'client',
      targetName: `${container}/${name}`,
      details: updateData,
      ip: req.ip,
    });

    res.json({ success: true });
  } catch (e) {
    console.error(`[ERROR] Failed to update client ${name}:`, e.message);
    res.status(500).json({ error: e.message || 'Failed to update client' });
  }
});

router.post('/bulk-update', auth, requireManager, async (req, res) => {
  // Validation Zod
  const parsed = bulkUpdateSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: parsed.error.errors?.[0]?.message || 'Validation failed' });
  const { clients, update } = parsed.data;
  let successCount = 0,
    failedCount = 0;
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
  // BUG-FIX: await ajouté et erreur traitée correctement sur le bulk enforcer
  const { success: blkSuccess, error: blkError } = await runSystemCommand(
    getScriptPath('wg-enforcer.sh'),
    []
  );
  if (!blkSuccess) console.error('[AUDIT] bulk enforcer failed:', blkError);

  await auditLog({
    actor: req.user.username,
    action: 'bulk-update',
    targetType: 'system',
    targetName: 'clients',
    details: { count: successCount, update },
    ip: req.ip,
  });

  res.json({ success: successCount, failed: failedCount });
});

router.post('/bulk-delete', auth, requireManager, async (req, res) => {
  // Validation Zod
  const parsed = bulkDeleteSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json({ error: parsed.error.errors?.[0]?.message || 'Validation failed' });
  const { clients } = parsed.data;
  let successCount = 0,
    failedCount = 0;
  for (const client of clients) {
    try {
      const [dbClient] = await db
        .select()
        .from(schema.clients)
        .where(
          and(eq(schema.clients.container, client.container), eq(schema.clients.name, client.name))
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
});

router.post('/move', auth, requireManager, async (req, res) => {
  // Validation Zod
  const parsed = moveClientSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.errors?.[0].message });
  const { container, name, newContainer } = parsed.data;
  const { success, error } = await runSystemCommand(getScriptPath('wg-move-client.sh'), [
    container,
    name,
    newContainer,
  ]);
  if (!success) return res.status(500).json({ error });
  try {
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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/:container/:name/history', auth, requireManager, async (req, res) => {
  const { container, name } = req.params;
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  try {
    const history = await db
      .select()
      .from(schema.logs)
      .where(and(eq(schema.logs.container, container), eq(schema.logs.name, name)))
      .orderBy(desc(schema.logs.timestamp))
      .limit(limit)
      .offset(offset);
    res.json(history);
  } catch (e) {
    console.error(`[ERROR] Failed to fetch history for ${name}:`, e.message);
    res.json([]);
  }
});

router.get('/:container/:name/history-hours', auth, requireManager, async (req, res) => {
  const { container, name } = req.params;
  try {
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)))
      .limit(1);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const history = await db
      .select()
      .from(schema.logs)
      .where(and(eq(schema.logs.type, 'snapshot'), eq(schema.logs.name, client.publicKey)))
      .orderBy(desc(schema.logs.timestamp))
      .limit(72);
    res.json(history.map((h) => ({ time: h.timestamp, rx: h.usageDaily, tx: h.usageTotal })));
  } catch (e) {
    console.error(`[ERROR] Failed to fetch hourly history for ${name}:`, e.message);
    res.json([]);
  }
});

router.get('/:container/:name/config', auth, requireManager, async (req, res) => {
  try {
    const { container, name } = req.params;
    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)))
      .limit(1);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const clientDir = getClientDir(container, name);
    const configPath = path.join(clientDir, `${name}.conf`);
    try {
      const configText = await fsPromises.readFile(configPath, 'utf8');
      res.json({ config: configText });
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'Configuration file not found' });
      }
      throw err;
    }
  } catch (e) {
    console.error(`[ERROR] Failed to fetch config for ${req.params.name}:`, e.message);
    res.status(500).json({ error: 'Failed to fetch configuration' });
  }
});

module.exports = router;

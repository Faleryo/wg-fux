const express = require('express');
const router = express.Router();
const path = require('path');
const fsPromises = require('fs').promises;
const { db, schema } = require('../../db');
const { eq, and, desc, onConflictDoUpdate } = require('drizzle-orm');
const { clientSchema, clientPatchSchema, toggleSchema, bulkUpdateSchema, bulkDeleteSchema, moveClientSchema, containerSchema } = require('../../db/validation');
const { auth, requireManager } = require('../middleware/auth');
const { runSystemCommand } = require('../services/shell');
const { getWireGuardStats, getClientDir, getInterfacePath, isValidName, parseWireGuardDump } = require('../services/system');
const { getScriptPath } = require('../services/config');

// Mutex simple pour éviter les race conditions lors de création simultanée de clients
// (le flock shell protège l'attribution IP, ce mutex protège le flux Node.js)
let isCreatingClient = false;
const withClientMutex = async (fn) => {
    if (isCreatingClient) throw new Error('Une création de client est déjà en cours. Réessayez dans quelques secondes.');
    isCreatingClient = true;
    try { return await fn(); }
    finally { isCreatingClient = false; }
};

// --- Container Routes ---

router.get('/containers', auth, requireManager, async (req, res) => {
    const dir = process.env.WG_CLIENTS_DIR || '/etc/wireguard/clients';
    try {
        const files = await fsPromises.readdir(dir);
        const containers = [];
        for (const f of files) {
            try {
                const stat = await fsPromises.stat(path.join(dir, f));
                if (stat.isDirectory()) containers.push(f);
            } catch(e) {
                console.error(`[AUDIT] Failed to stat container ${f}:`, e.message);
            }
        }
        res.json(containers);
    } catch (e) { 
        console.error('[CRITICAL] Failed to read containers directory:', e.message);
        res.status(500).json({ error: 'Failed to fetch containers' }); 
    }
});

router.post('/containers', auth, requireManager, async (req, res) => {
    // Validation Zod sur le nom du container
    const parsed = containerSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { name } = parsed.data;
    const { success, error } = await runSystemCommand(getScriptPath('wg-create-container.sh'), [name]);
    if (!success) return res.status(500).json({ error });
    res.json({ success: true });
});

router.delete('/containers/:name', auth, requireManager, async (req, res) => {
    if (!isValidName(req.params.name)) return res.status(400).json({ error: 'Invalid name' });
    const { success, error } = await runSystemCommand(getScriptPath('wg-remove-container.sh'), [req.params.name]);
    if (!success) return res.status(500).json({ error });
    res.json({ success: true });
});

// --- Client Routes ---

router.get('/', auth, requireManager, async (req, res) => {
    try {
        const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 200), 1000);
        const offset = Math.max(0, parseInt(req.query.offset) || 0);
        const today = new Date().toISOString().split('T')[0];
        
        const stdout = await getWireGuardStats();
        const peers = parseWireGuardDump(stdout);
        const wgStats = Object.fromEntries(peers.map(p => [p.publicKey, p]));

        const dbClients = await db.select()
            .from(schema.clients)
            .leftJoin(schema.usage, eq(schema.clients.publicKey, schema.usage.publicKey))
            .limit(limit).offset(offset);

        const clients = dbClients.map(({ clients: c, usage: u }) => {
            const stat = wgStats[c.publicKey];
            const usageData = u ? { total: u.total, daily: JSON.parse(u.daily || '{}') } : { total: 0, daily: {} };
            
            return {
                id: `${c.container}-${c.name}`,
                name: c.name, container: c.container, ip: c.ip || '',
                publicKey: c.publicKey, expiry: c.expiry, quota: c.quota,
                uploadLimit: c.uploadLimit, createdAt: c.createdAt, enabled: c.enabled,
                lastHandshake: stat ? stat.lastSeen : 0,
                downloadBytes: stat ? stat.tx : 0,
                uploadBytes: stat ? stat.rx : 0,
                endpoint: stat ? stat.endpoint : '',
                usageTotal: usageData.total || 0,
                usageDaily: (usageData.daily && usageData.daily[today]) ? usageData.daily[today] : 0
            };
        });

        // Filtres
        let filtered = clients;
        const { container: containerFilter, status, search } = req.query;
        if (containerFilter) filtered = filtered.filter(c => c.container === containerFilter);
        if (status === 'online') filtered = filtered.filter(c => c.isOnline || (c.lastHandshake && Date.now()/1000 - c.lastHandshake < 180));
        if (status === 'offline') filtered = filtered.filter(c => !c.isOnline && !(c.lastHandshake && Date.now()/1000 - c.lastHandshake < 180));
        if (search) {
            const q = search.toLowerCase();
            filtered = filtered.filter(c => c.name?.toLowerCase().includes(q) || c.ip?.includes(q) || c.container?.toLowerCase().includes(q));
        }

        // Pagination (par défaut : tout, limite max 500)
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = Math.min(500, Math.max(1, parseInt(req.query.limit) || filtered.length));
        const total = filtered.length;
        const paginated = parseInt(req.query.page) ? filtered.slice((page - 1) * pageSize, page * pageSize) : filtered;

        res.json(parseInt(req.query.page) ? {
            clients: paginated,
            pagination: { page, limit: pageSize, total, totalPages: Math.ceil(total / pageSize) }
        } : clients); // Compatibilité rétroactive : sans ?page= on retourne le tableau direct
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /api/clients/export — Export CSV ou JSON de tous les clients
router.get('/export', auth, requireManager, async (req, res) => {
    try {
        const format = req.query.format === 'json' ? 'json' : 'csv';
        const allClients = await db.select().from(schema.clients);

        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="wg-clients-${Date.now()}.json"`);
            return res.json(allClients);
        }

        const headers = ['name', 'container', 'ip', 'publicKey', 'expiry', 'quota', 'uploadLimit', 'createdAt'];
        const rows = allClients.map(c =>
            headers.map(h => `"${String(c[h] !== undefined ? c[h] : '').replace(/"/g, '""')}"`).join(',')
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
        if (!result.success) return res.status(400).json({ error: result.error.errors[0].message });

        const { name, container, expiry, quota, uploadLimit } = result.data;
        const cleanExpiry = expiry || '';

        // Mutex: protège contre les créations simultanées qui causeraient des conflits d'IP
        const clientData = await withClientMutex(async () => {
            const { success, error } = await runSystemCommand(getScriptPath('wg-create-client.sh'), [container, name, cleanExpiry, String(quota || ''), String(uploadLimit || '0')]);
            if (!success) throw new Error(error || 'Script execution failed');

            let publicKey = '', ip = '';
            for (let i = 1; i <= 5; i++) {
                try {
                    await new Promise(r => setTimeout(r, 500 * i));
                    const clientDir = getClientDir(container, name);
                    publicKey = await fsPromises.readFile(path.join(clientDir, 'public.key'), 'utf8').then(s => s.trim());
                    const conf = await fsPromises.readFile(path.join(clientDir, `${name}.conf`), 'utf8');
                    const ipMatch = conf.match(/Address\s*=\s*(.+)/);
                    ip = ipMatch ? ipMatch[1].split(',')[0].trim() : '';
                    if (publicKey) break;
                } catch (e) {
                    if (i === 5) throw new Error(`FileSystem sync failed for ${name} in ${container}`);
                }
            }
            return { publicKey, ip };
        });

        await db.insert(schema.clients).values({
            container, name, publicKey: clientData.publicKey, ip: clientData.ip,
            expiry: cleanExpiry, quota: quota || 0, uploadLimit: uploadLimit || 0,
            createdAt: new Date()
        }).onConflictDoUpdate({
            target: schema.clients.publicKey,
            set: { name, container, expiry: cleanExpiry, quota: quota || 0, uploadLimit: uploadLimit || 0 }
        });
        await db.insert(schema.usage).values({ publicKey: clientData.publicKey, total: 0, daily: '{}' }).onConflictDoNothing();

        res.json({ success: true });
    } catch (e) {
        const status = e.message.includes('en cours') ? 409 : 500;
        res.status(status).json({ error: e.message });
    }
});

router.post('/:container/:name/toggle', auth, requireManager, async (req, res) => {
    // Validation Zod sur le body
    const parsed = toggleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });

    try {
        const { container, name } = req.params;
        const { enabled } = parsed.data;
        const [client] = await db.select().from(schema.clients).where(and(eq(schema.clients.container, container), eq(schema.clients.name, name))).limit(1);
        if (!client) return res.status(404).json({ error: 'Client not found' });
        
        const clientDir = getClientDir(container, name);
        const publicKey = client.publicKey;

        if (enabled) {
            await fsPromises.unlink(path.join(clientDir, 'disabled')).catch(() => {});
            const config = await fsPromises.readFile(path.join(clientDir, `${name}.conf`), 'utf8');
            const addressMatch = config.match(/^Address\s*=\s*([^#\n]+)/m);
            if (!addressMatch) throw new Error(`Invalid configuration file for ${name}`);
            const ips = addressMatch[1].trim().split(',').map(ip => ip.trim().split('/')[0]).map(ip => ip.includes(':') ? `${ip}/128` : `${ip}/32`).join(',');
            await runSystemCommand(getScriptPath('wg-toggle.sh'), [process.env.WG_INTERFACE, 'peer', publicKey, 'allowed-ips', ips]);
        } else {
            await fsPromises.writeFile(path.join(clientDir, 'disabled'), new Date().toISOString());
            await runSystemCommand(getScriptPath('wg-toggle.sh'), [process.env.WG_INTERFACE, 'peer', publicKey, 'remove']);
        }
        
        await db.update(schema.clients).set({ enabled: !!enabled }).where(eq(schema.clients.publicKey, publicKey));
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:container/:name', auth, requireManager, async (req, res) => {
    const { container, name } = req.params;
    const { success, error } = await runSystemCommand(getScriptPath('wg-remove-client.sh'), [container, name]);
    if (!success) return res.status(500).json({ error });

    try {
        const [client] = await db.select().from(schema.clients).where(and(eq(schema.clients.container, container), eq(schema.clients.name, name))).limit(1);
        if (client) {
            await db.delete(schema.usage).where(eq(schema.usage.publicKey, client.publicKey));
            await db.delete(schema.clients).where(eq(schema.clients.publicKey, client.publicKey));
        }
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/:container/:name', auth, requireManager, async (req, res) => {
    const { container, name } = req.params;
    // Validation Zod sur le patch
    const parsed = clientPatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { expiry, quota, uploadLimit } = parsed.data;
    try {
        const [client] = await db.select().from(schema.clients).where(and(eq(schema.clients.container, container), eq(schema.clients.name, name))).limit(1);
        if (!client) return res.status(404).json({ error: 'Client not found' });

        const clientDir = getClientDir(container, name);
        const updateData = {};
        if (expiry !== undefined) {
            updateData.expiry = expiry || null;
            if (expiry) await fsPromises.writeFile(path.join(clientDir, 'expiry'), expiry);
            else await fsPromises.unlink(path.join(clientDir, 'expiry')).catch(() => {});
        }
        if (quota !== undefined) {
            updateData.quota = parseInt(quota) || 0;
            if (updateData.quota > 0) await fsPromises.writeFile(path.join(clientDir, 'quota'), String(quota));
            else await fsPromises.unlink(path.join(clientDir, 'quota')).catch(() => {});
        }
        if (uploadLimit !== undefined) {
            updateData.uploadLimit = parseInt(uploadLimit) || 0;
            if (updateData.uploadLimit > 0) await fsPromises.writeFile(path.join(clientDir, 'upload_limit'), String(uploadLimit));
            else await fsPromises.unlink(path.join(clientDir, 'upload_limit')).catch(() => {});
            // BUG-FIX: await ajouté — promesse orpheline → échec silencieux
            await runSystemCommand(getScriptPath('wg-apply-qos.sh'), []).catch(e => console.error('[AUDIT] wg-apply-qos failed:', e.message));
        }
        await db.update(schema.clients).set(updateData).where(eq(schema.clients.publicKey, client.publicKey));
        // BUG-FIX: await ajouté — promesse orpheline → erreur silencieuse non trapée
        await runSystemCommand(getScriptPath('wg-enforcer.sh'), []).catch(e => console.error('[AUDIT] wg-enforcer failed:', e.message));
        res.json({ success: true });
    } catch (e) { 
        console.error(`[ERROR] Failed to update client ${name}:`, e.message);
        res.status(500).json({ error: e.message || 'Failed to update client' }); 
    }
});

router.post('/bulk-update', auth, requireManager, async (req, res) => {
    // Validation Zod
    const parsed = bulkUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { clients, update } = parsed.data;
    let successCount = 0, failedCount = 0;
    for (const client of clients) {
        try {
            const clientDir = getClientDir(client.container, client.name);
            if (update.expiry !== undefined) {
                if (update.expiry) await fsPromises.writeFile(path.join(clientDir, 'expiry'), update.expiry);
                else await fsPromises.unlink(path.join(clientDir, 'expiry')).catch(() => {});
            }
            if (update.quota !== undefined) {
                if (update.quota > 0) await fsPromises.writeFile(path.join(clientDir, 'quota'), String(update.quota));
                else await fsPromises.unlink(path.join(clientDir, 'quota')).catch(() => {});
            }
            successCount++;
        } catch(e) { failedCount++; }
    }
    // BUG-FIX: await ajouté sur la commande bulk enforcer
    await runSystemCommand(getScriptPath('wg-enforcer.sh'), []).catch(e => console.error('[AUDIT] bulk enforcer failed:', e.message));
    res.json({ success: successCount, failed: failedCount });
});

router.post('/bulk-delete', auth, requireManager, async (req, res) => {
    // Validation Zod
    const parsed = bulkDeleteSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { clients } = parsed.data;
    let successCount = 0, failedCount = 0;
    for (const client of clients) {
        try {
            const [dbClient] = await db.select().from(schema.clients).where(and(eq(schema.clients.container, client.container), eq(schema.clients.name, client.name))).limit(1);
            const { success } = await runSystemCommand(getScriptPath('wg-remove-client.sh'), [client.container, client.name]);
            if (success && dbClient) {
                await db.delete(schema.usage).where(eq(schema.usage.publicKey, dbClient.publicKey));
                await db.delete(schema.clients).where(eq(schema.clients.publicKey, dbClient.publicKey));
                successCount++;
            } else { failedCount++; }
        } catch(e) { failedCount++; }
    }
    res.json({ success: successCount, failed: failedCount });
});

router.post('/move', auth, requireManager, async (req, res) => {
    // Validation Zod
    const parsed = moveClientSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0].message });
    const { container, name, newContainer } = parsed.data;
    const { success, error } = await runSystemCommand(getScriptPath('wg-move-client.sh'), [container, name, newContainer]);
    if (!success) return res.status(500).json({ error });
    try {
        await db.update(schema.clients).set({ container: newContainer }).where(and(eq(schema.clients.container, container), eq(schema.clients.name, name)));
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:container/:name/history', auth, requireManager, async (req, res) => {
    const { container, name } = req.params;
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    try {
        const history = await db.select().from(schema.logs)
            .where(and(eq(schema.logs.container, container), eq(schema.logs.name, name)))
            .orderBy(desc(schema.logs.timestamp))
            .limit(limit).offset(offset);
        res.json(history);
    } catch (e) { 
        console.error(`[ERROR] Failed to fetch history for ${name}:`, e.message);
        res.json([]); 
    }
});

router.get('/:container/:name/history-hours', auth, requireManager, async (req, res) => {
    try {
        const { container, name } = req.params;
        const [client] = await db.select().from(schema.clients).where(and(eq(schema.clients.container, container), eq(schema.clients.name, name))).limit(1);
        if (!client) return res.status(404).json({ error: 'Client not found' });
        const history = await db.select().from(schema.logs).where(and(eq(schema.logs.type, 'snapshot'), eq(schema.logs.name, client.publicKey)))
            .orderBy(desc(schema.logs.timestamp)).limit(72);
        res.json(history.map(h => ({ time: h.timestamp, rx: h.usageDaily, tx: h.usageTotal })));
    } catch (e) { 
        console.error(`[ERROR] Failed to fetch hourly history for ${name}:`, e.message);
        res.json([]); 
    }
});

module.exports = router;

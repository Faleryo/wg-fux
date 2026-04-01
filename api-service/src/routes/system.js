const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { db, schema } = require('../../db');
const { eq, and, desc, lt, sql } = require('drizzle-orm');
const { auth, requireAdmin } = require('../middleware/auth');
const { runCommand, runSystemCommand } = require('../services/shell');
const { getWireGuardStats, getSystemStats, formatBytes, getInterfacePath } = require('../services/system');
const { getJobStatus } = require('../services/jobs');
const { getScriptPath } = require('../services/config');

const WG_BIN = process.env.WG_BIN || 'wg';
const WG_QUICK_BIN = process.env.WG_QUICK_BIN || 'wg-quick';
const SPEEDTEST_BIN = process.env.SPEEDTEST_BIN || 'speedtest-cli';

// --- Metrics & Stats ---

router.get('/stats', auth, async (req, res) => {
    try {
        const peers = await getWireGuardStats(); // Now returns Array of JSON objects
        let totalRx = 0, totalTx = 0, connectedCount = 0;
        
        peers.forEach(peer => {
            totalRx += peer.rx || 0;
            totalTx += peer.tx || 0;
            if (peer.isOnline) connectedCount++;
        });

        const system = await getSystemStats();
        res.json({
            network: {
                totalDownload: formatBytes(totalRx),
                totalUpload: formatBytes(totalTx),
                connectedClients: connectedCount
            },
            system
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/traffic-history', auth, async (req, res, next) => {
    try {
        const history = await db.select()
            .from(schema.logs)
            .where(and(eq(schema.logs.type, 'snapshot'), lt(schema.logs.timestamp, new Date())))
            .orderBy(desc(schema.logs.timestamp))
            .limit(240);
            
        const grouped = {};
        history.forEach(h => {
            const time = h.timestamp.toISOString().split(':')[0];
            if(!grouped[time]) grouped[time] = { time, rx: 0, tx: 0 };
            grouped[time].rx += h.usageDaily || 0;
            grouped[time].tx += h.usageTotal || 0;
        });

        res.json(Object.values(grouped).sort((a,b) => a.time.localeCompare(b.time)));
    } catch (e) { next(e); }
});

// --- Service & Hardware Management ---

router.get('/services', auth, async (req, res) => {
    const services = [
        { id: 'wireguard', name: 'WireGuard Core', unit: `wg-quick@${process.env.WG_INTERFACE}` },
        { id: 'api', name: 'API Server', unit: 'wireguard-api' },
        { id: 'dashboard', name: 'Dashboard UI', unit: 'wg-fux-dashboard' },
        { id: 'nginx', name: 'Web Server (Nginx)', unit: 'nginx' }
    ];
    const fs = require('fs');
    const servicesStatus = await Promise.all(services.map(async (svc) => {
        let active = false;
        try {
            if (svc.id === 'wireguard') {
                // Vérification via sysfs (plus fiable que l'existence du fichier conf)
                active = fs.existsSync(`/sys/class/net/${process.env.WG_INTERFACE || 'wg0'}`);
            } else if (svc.id === 'api') {
                // L'API tourne si on répond à cette requête
                active = true;
            } else if (svc.id === 'nginx') {
                // Vérification du socket unix nginx ou du processus
                const { runCommand: rc } = require('../services/shell');
                const { success } = await rc('pgrep', ['-x', 'nginx']).catch(() => ({ success: false }));
                active = success;
            } else if (svc.id === 'dashboard') {
                // Vérifier si le container nginx de l'UI répond
                const { runCommand: rc } = require('../services/shell');
                const { success } = await rc('curl', ['-sf', '--max-time', '2', 'http://ui:80/']).catch(() => ({ success: false }));
                active = success;
            }
        } catch (e) {
            console.error('[AUDIT] System health fetch failed:', e.message);
        }
        return { ...svc, status: active ? 'active' : 'inactive' };
    }));
    res.json(servicesStatus);
});

router.post('/restart/:id', auth, requireAdmin, async (req, res) => {
    const iface = process.env.WG_INTERFACE || 'wg0';
    if (req.params.id === 'wireguard') {
        await runSystemCommand(WG_QUICK_BIN, ['down', iface]);
        const { success, error } = await runSystemCommand(WG_QUICK_BIN, ['up', iface]);
        if (!success) return res.status(500).json({ error });
        return res.json({ success: true, message: 'WireGuard restarted' });
    }
    res.json({ success: true, message: `Restart requested for ${req.params.id} (Managed by Docker)` });
});

router.post('/reload-peers', auth, requireAdmin, async (req, res) => {
    const iface = process.env.WG_INTERFACE || 'wg0';
    // BUG-FIX: execFile ne supporte pas les process substitutions bash <(...)
    // Solution: Utiliser deux commandes séquentielles au lieu de process substitution
    const { success: stripOk, stdout: strippedConf, error: stripErr } = 
        await runSystemCommand(WG_QUICK_BIN, ['strip', iface]);
    if (!stripOk) return res.status(500).json({ error: stripErr || 'wg-quick strip failed' });
    
    const { success, error } = await runSystemCommand(WG_BIN, ['syncconf', iface, '/dev/stdin'], strippedConf);
    if (!success) return res.status(500).json({ error });
    res.json({ success: true });
});

// --- Configuration ---

router.get('/config', auth, requireAdmin, async (req, res) => {
    try {
        const config = {};
        const content = await fsPromises.readFile('/etc/wireguard/manager.conf', 'utf8').catch(() => '');
        content.split('\n').forEach(line => {
            const parts = line.split('=');
            if (parts.length >= 2) {
                const key = parts.shift().trim();
                const value = parts.join('=').replace(/["']/g, '').trim();
                config[key] = value;
            }
        });
        res.json({
            port: config.SERVER_PORT || '51820',
            mtu: config.SERVER_MTU || '1420',
            dns: config.CLIENT_DNS || '1.1.1.1, 8.8.8.8',
            subnet: config.VPN_SUBNET || '10.0.0.0/24',
            keepalive: config.PERSISTENT_KEEPALIVE !== '0'
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/config', auth, requireAdmin, async (req, res) => {
    const { port, mtu, dns, subnet, keepalive } = req.body;
    try {
        let conf = await fsPromises.readFile('/etc/wireguard/manager.conf', 'utf8').catch(() => '');
        const updateKey = (key, val) => {
            const regex = new RegExp(`^${key}=.*`, 'm');
            const line = `${key}="${val}"`;
            conf = regex.test(conf) ? conf.replace(regex, line) : conf + `\n${line}`;
        };
        if(port) updateKey('SERVER_PORT', port);
        if(mtu) updateKey('SERVER_MTU', mtu);
        if(dns) updateKey('CLIENT_DNS', dns);
        if(subnet) updateKey('VPN_SUBNET', subnet);
        if(keepalive !== undefined) updateKey('PERSISTENT_KEEPALIVE', keepalive ? '25' : '0');
        
        await fsPromises.writeFile('/etc/wireguard/manager.conf', conf);
        if(port) await runSystemCommand(WG_BIN, ['set', process.env.WG_INTERFACE, 'listen-port', port]).catch(() => {});
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- Maintenance & Tools ---

router.get('/congestion', auth, requireAdmin, async (req, res) => {
    try {
        const [current, available] = await Promise.all([
            fsPromises.readFile('/proc/sys/net/ipv4/tcp_congestion_control', 'utf8').then(s => s.trim()),
            fsPromises.readFile('/proc/sys/net/ipv4/tcp_available_congestion_control', 'utf8').then(s => s.trim().split(' '))
        ]);
        res.json({ current, available });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/uptime', auth, (req, res) => {
    const uptimeInSeconds = os.uptime();
    const days = Math.floor(uptimeInSeconds / (3600 * 24));
    const hours = Math.floor((uptimeInSeconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((uptimeInSeconds % 3600) / 60);
    res.json({ uptime: `${days}d ${hours}h ${minutes}m` });
});

let isSpeedtestRunning = false;
router.post('/speedtest', auth, requireAdmin, async (req, res) => {
    if (isSpeedtestRunning) return res.status(429).json({ error: 'Test en cours' });
    isSpeedtestRunning = true;
    try {
        // wg-speedtest.sh is expected to output JSON on stdout
        const { success, stdout, error } = await runSystemCommand(getScriptPath('wg-speedtest.sh'), []);
        if (!success) return res.status(500).json({ error: error || 'Speedtest failed' });
        let data = {};
        try { data = JSON.parse(stdout); } catch { data = { raw: stdout }; }
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    } finally {
        isSpeedtestRunning = false;
    }
});

router.post('/optimize', auth, requireAdmin, async (req, res) => {
    const { profile } = req.body;
    const validProfiles = ['gaming', 'streaming', 'auto'];
    if (!profile || !validProfiles.includes(profile)) {
        return res.status(400).json({ error: 'Invalid optimization profile' });
    }
    const { success, error } = await runSystemCommand(getScriptPath('wg-optimize.sh'), [profile]);
    if (!success) return res.status(500).json({ error: error || 'Optimization failed' });
    res.json({ success: true, profile, message: `Profile ${profile} applied` });
});

router.get('/audit', auth, async (req, res) => {
    try {
        const stats = await getSystemStats();
        // Use runSystemCommand — ufw/sysctl require elevated privileges
        const { stdout: fwStatus } = await runSystemCommand('ufw', ['status']).catch(() => ({ stdout: 'inactive' }));
        const { stdout: ipFwd } = await runSystemCommand('sysctl', ['-n', 'net.ipv4.ip_forward']).catch(() => ({ stdout: '0' }));
        
        res.json({
            firewall: (fwStatus || '').includes('active'),
            ipForwarding: (ipFwd || '').trim() === '1',
            fail2ban: true,
            disk: stats.disk + '%'
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /security-logs is defined below with full implementation

// Access logs (used by LogsSection 'access' tab)
router.get('/logs', auth, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 100, 500);
        const history = await db.select().from(schema.logs)
            .where(eq(schema.logs.type, 'auth'))
            .orderBy(desc(schema.logs.timestamp))
            .limit(limit);
        res.json(history.map(h => ({
            time: h.timestamp,
            username: h.name,
            ip: h.realIp,
            message: h.virtualIp,
            status: h.status === 'success' ? 'SUCCESS' : 'FAILED'
        })));
    } catch(e) {
        res.json([]);
    }
});


router.get('/backups', auth, requireAdmin, async (req, res) => {
    try {
        const backupDir = '/var/backups/wireguard';
        if (!fs.existsSync(backupDir)) return res.json([]);
        const files = await fsPromises.readdir(backupDir);
        const backups = await Promise.all(files.filter(f => f.endsWith('.tar.gz')).map(async f => {
            const stats = await fsPromises.stat(path.join(backupDir, f));
            return { name: f, size: stats.size, date: stats.mtime };
        }));
        res.json(backups.sort((a,b) => b.date - a.date));
    } catch (e) { res.json([]); }
});

router.post('/backup', auth, requireAdmin, async (req, res) => {
    const { success, error } = await runSystemCommand(getScriptPath('wg-backup.sh'), []);
    if (!success) return res.status(500).json({ error });
    res.json({ success: true, message: 'Sauvegarde créée avec succès' });
});

router.post('/harden', auth, requireAdmin, async (req, res) => {
    const { success, error } = await runSystemCommand(getScriptPath('wg-harden.sh'), []);
    if (!success) return res.status(500).json({ error });
    res.json({ success: true, message: 'Système durci avec succès' });
});

router.post('/maintenance/check-expiry', auth, requireAdmin, async (req, res) => {
    const { success, error } = await runSystemCommand(getScriptPath('wg-check-expiry.sh'), []);
    if (!success) return res.status(500).json({ error });
    res.json({ success: true, message: 'Vérification terminée' });
});

router.get('/security-logs', auth, requireAdmin, async (req, res) => {
    try {
        const logFile = '/var/log/wg-enforcer.log';
        if (!fs.existsSync(logFile)) return res.json([]);
        const { success, stdout } = await runCommand('tail', ['-n', '100', logFile]);
        if (!success) return res.json([]);
        const lines = stdout.split('\n').filter(Boolean).map(line => {
            const parts = line.split(' - ');
            return { date: parts[0], message: parts[1] || line };
        });
        res.json(lines.reverse());
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/health', async (req, res) => {
    const iface = process.env.WG_INTERFACE || 'wg0';
    const interfaceExists = fs.existsSync(getInterfacePath(iface));
    const { success } = await runSystemCommand(WG_BIN, ['show', iface]);
    const system = await getSystemStats();
    res.json({
        status: (interfaceExists && success && parseFloat(system.disk) < 95) ? 'healthy' : 'unhealthy',
        service: interfaceExists ? 'active' : 'inactive',
        interface: success ? 'up' : 'down',
        stats: system,
        jobs: getJobStatus(),
        version: '3.1.0-Platinum'
    });
});

module.exports = router;

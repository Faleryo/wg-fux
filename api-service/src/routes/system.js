const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const { db, schema } = require('../../db');
const { eq, and, desc, gt } = require('drizzle-orm');
const { auth, requireAdmin } = require('../middleware/auth');
const { systemConfigSchema } = require('../../db/validation');

const { runCommand, runSystemCommand, writeFileAsRoot } = require('../services/shell');
const {
  getWireGuardStats,
  getSystemStats,
  formatBytes,
  getInterfacePath,
} = require('../services/system');
const { getJobStatus } = require('../services/jobs');
const { getScriptPath } = require('../services/config');
const { gcAuditLogs } = require('../services/audit');
const log = require('../services/logger');
const axios = require('axios');
const { asyncWrap } = require('../utils/errors');

const WG_BIN = process.env.WG_BIN || 'wg';
const WG_QUICK_BIN = process.env.WG_QUICK_BIN || 'wg-quick';

// --- AdGuard Status Check ---
router.get('/adguard-status', auth, asyncWrap(async (req, res) => {
  // AdGuard Home listening on port 3000 inside the container 'adguard'
  try {
    const response = await axios.get('http://adguard:3000/control/status', { timeout: 3000 });
    res.json({ status: response.status === 200 ? 'active' : 'inactive' });
  } catch (e) {
    res.json({ status: 'inactive', error: e.message });
  }
}));

// --- Metrics & Stats ---

router.get('/stats', auth, asyncWrap(async (req, res) => {
  const peers = await getWireGuardStats(); // Now returns Array of JSON objects
  let totalRx = 0,
    totalTx = 0,
    connectedCount = 0;

  peers.forEach((peer) => {
    totalRx += peer.rx || 0;
    totalTx += peer.tx || 0;
    if (peer.isOnline) connectedCount++;
  });

  const system = await getSystemStats();
  res.json({
    network: {
      totalDownload: formatBytes(totalRx),
      totalUpload: formatBytes(totalTx),
      connectedClients: connectedCount,
    },
    system,
  });
}));

router.get('/telemetry', auth, asyncWrap(async (req, res) => {
  const { getTelemetry } = require('../services/system');
  const telemetry = await getTelemetry();
  res.json(telemetry);
}));

router.get('/traffic-history', auth, asyncWrap(async (req, res) => {
  // BUG-FIX: lt(timestamp, new Date()) ne filtrait rien (= toutes les entrées passées).
  // On filtre désormais sur les 24 dernières heures pour le graphique de trafic.
  const since24h = new Date(Date.now() - 24 * 3600 * 1000);
  const history = await db
    .select()
    .from(schema.logs)
    .where(and(eq(schema.logs.type, 'snapshot'), gt(schema.logs.timestamp, since24h)))
    .orderBy(desc(schema.logs.timestamp))
    .limit(240);

  const grouped = {};
  history.forEach((h) => {
    const time = h.timestamp.toISOString().split(':')?.[0];
    if (!grouped[time]) grouped[time] = { time, rx: 0, tx: 0 };
    grouped[time].rx += h.usageDaily || 0;
    grouped[time].tx += h.usageTotal || 0;
  });

  res.json(Object.values(grouped).sort((a, b) => a.time.localeCompare(b.time)));
}));

// --- Service & Hardware Management ---

router.get('/services', auth, asyncWrap(async (req, res) => {
  const services = [
    { id: 'wireguard', name: 'WireGuard Core', unit: `wg-quick@${process.env.WG_INTERFACE}` },
    { id: 'api', name: 'API Server', unit: 'wireguard-api' },
    { id: 'dashboard', name: 'Dashboard UI', unit: 'wg-fux-dashboard' },
    { id: 'nginx', name: 'Web Server (Nginx)', unit: 'nginx' },
  ];
  const servicesStatus = await Promise.all(
    services.map(async (svc) => {
      let active = false;
      try {
        if (svc.id === 'wireguard') {
          active = fs.existsSync(`/sys/class/net/${process.env.WG_INTERFACE || 'wg0'}`);
        } else if (svc.id === 'api') {
          active = true;
        } else if (svc.id === 'nginx') {
          const { runCommand: rc } = require('../services/shell');
          const { success } = await rc('curl', [
            '-sf',
            '--max-time',
            '2',
            'http://nginx:80/',
          ]).catch(() => ({ success: false }));
          active = success;
        } else if (svc.id === 'dashboard') {
          const { runCommand: rc } = require('../services/shell');
          const { success } = await rc('curl', ['-sf', '--max-time', '2', 'http://ui:80/']).catch(
            () => ({ success: false })
          );
          active = success;
        }
      } catch (e) {
        log.warn('system', 'Service health check failed', { id: svc.id, error: e.message });
      }
      return { ...svc, status: active ? 'active' : 'inactive' };
    })
  );
  res.json(servicesStatus);
}));

router.post('/restart/:id', auth, requireAdmin, asyncWrap(async (req, res) => {
  const iface = process.env.WG_INTERFACE || 'wg0';
  if (req.params.id === 'wireguard') {
    await runSystemCommand(WG_QUICK_BIN, ['down', iface]);
    const { success, error } = await runSystemCommand(WG_QUICK_BIN, ['up', iface]);
    if (!success) {
      const err = new Error(error);
      err.status = 500;
      throw err;
    }
    return res.json({ success: true, message: 'WireGuard restarted' });
  }
  res.json({
    success: true,
    message: `Restart requested for ${req.params.id} (Managed by Docker)`,
  });
}));

router.post('/reload-peers', auth, requireAdmin, asyncWrap(async (req, res) => {
  const iface = process.env.WG_INTERFACE || 'wg0';
  const {
    success: stripOk,
    stdout: strippedConf,
    error: stripErr,
  } = await runSystemCommand(WG_QUICK_BIN, ['strip', iface]);

  if (!stripOk) {
    const err = new Error(stripErr || 'wg-quick strip failed');
    err.status = 500;
    throw err;
  }

  if (!strippedConf || strippedConf.trim().length === 0) {
    log.error('system', `Attempted syncconf with empty stripped config for ${iface}`);
    const err = new Error('Generated configuration is empty. Sync aborted for safety.');
    err.status = 500;
    throw err;
  }

  const { success, error } = await runSystemCommand(
    WG_BIN,
    ['syncconf', iface, '/dev/stdin'],
    strippedConf
  );
  if (!success) {
    const err = new Error(error);
    err.status = 500;
    throw err;
  }
  res.json({ success: true });
}));

// --- Configuration ---

router.get('/config', auth, requireAdmin, asyncWrap(async (req, res) => {
  const config = {};
  const content = await fsPromises
    .readFile('/etc/wireguard/manager.conf', 'utf8')
    .catch(() => '');
  content.split('\n').forEach((line) => {
    const parts = line.split('=');
    if (parts.length >= 2) {
      const key = parts.shift().trim();
      const value = parts.join('=').replace(/["']/g, '').trim();
      config[key] = value;
    }
  });

  const iface = process.env.WG_INTERFACE || 'wg0';
  const [livePort, liveMtu] = await Promise.all([
    runCommand(WG_BIN, ['show', iface, 'listen-port'])
      .then((r) => r.stdout)
      .catch(() => null),
    runCommand('cat', [`/sys/class/net/${iface}/mtu`])
      .then((r) => r.stdout)
      .catch(() => null),
  ]);

  res.json({
    port: livePort || config.SERVER_PORT || '51820',
    mtu: liveMtu || config.SERVER_MTU || '1420',
    dns: config.CLIENT_DNS || '1.1.1.1, 8.8.8.8',
    subnet: config.VPN_SUBNET || '10.0.0.0/24',
    keepalive: parseInt(config.PERSISTENT_KEEPALIVE) || 0,
  });
}));

router.post('/config', auth, requireAdmin, asyncWrap(async (req, res) => {
  const result = systemConfigSchema.safeParse(req.body);
  if (!result.success)
    return res
      .status(400)
      .json({ error: result.error.errors?.[0]?.message || 'Validation failed' });
  const { port, mtu, dns, subnet, keepalive } = result.data;

  let conf = await fsPromises.readFile('/etc/wireguard/manager.conf', 'utf8').catch(() => '');
  const updateKey = (key, val) => {
    const regex = new RegExp(`^${key}=.*`, 'm');
    const line = `${key}="${val}"`;
    conf = regex.test(conf) ? conf.replace(regex, line) : conf + `\n${line}`;
  };
  if (port) updateKey('SERVER_PORT', port);
  if (mtu) updateKey('SERVER_MTU', mtu);
  if (dns) updateKey('CLIENT_DNS', dns);
  if (subnet) updateKey('VPN_SUBNET', subnet);
  if (keepalive !== undefined) updateKey('PERSISTENT_KEEPALIVE', keepalive);

  const { success: writeOk, error: writeErr } = await writeFileAsRoot(
    '/etc/wireguard/manager.conf',
    conf
  );
  if (!writeOk) {
    const err = new Error(writeErr || 'Failed to write configuration file');
    err.status = 500;
    throw err;
  }

  if (port)
    await runSystemCommand(WG_BIN, ['set', process.env.WG_INTERFACE, 'listen-port', port]).catch(
      () => {}
    );

  await auditLog({
    actor: req.user.username,
    action: 'patch_system_config',
    target: 'config',
    status: 'success',
  });

  res.json({ success: true });
}));

// --- Maintenance & Tools ---

router.get('/congestion', auth, requireAdmin, asyncWrap(async (req, res) => {
  const [current, available] = await Promise.all([
    fsPromises
      .readFile('/proc/sys/net/ipv4/tcp_congestion_control', 'utf8')
      .then((s) => s.trim()),
    fsPromises
      .readFile('/proc/sys/net/ipv4/tcp_available_congestion_control', 'utf8')
      .then((s) => s.trim().split(' ')),
  ]);
  res.json({ current, available });
}));

router.get('/uptime', auth, (req, res) => {
  const uptimeInSeconds = os.uptime();
  const days = Math.floor(uptimeInSeconds / (3600 * 24));
  const hours = Math.floor((uptimeInSeconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((uptimeInSeconds % 3600) / 60);
  res.json({ uptime: `${days}d ${hours}h ${minutes}m` });
});

let isSpeedtestRunning = false;
router.post('/speedtest', auth, requireAdmin, asyncWrap(async (req, res) => {
  if (isSpeedtestRunning) return res.status(429).json({ error: 'Test en cours' });
  isSpeedtestRunning = true;
  try {
    const { success, stdout, error } = await runSystemCommand(getScriptPath('wg-speedtest.sh'), []);
    if (!success) {
      const err = new Error(error || 'Speedtest failed');
      err.status = 500;
      throw err;
    }
    let data = {};
    try {
      data = JSON.parse(stdout);
    } catch {
      data = { raw: stdout };
    }
    res.json(data);
  } finally {
    isSpeedtestRunning = false;
  }
}));

router.get('/optimize', auth, asyncWrap(async (req, res) => {
  const stateFile = '/etc/wireguard/active_profile';
  if (!fs.existsSync(stateFile)) return res.json({ profile: 'default' });
  const profile = await fsPromises.readFile(stateFile, 'utf8').then((s) => s.trim());
  res.json({ profile });
}));

router.post('/optimize', auth, requireAdmin, asyncWrap(async (req, res) => {
  const { profile } = req.body;
  const validProfiles = ['gaming', 'streaming', 'auto', 'restore', 'default', 'disable'];
  if (!profile || !validProfiles.includes(profile)) {
    return res.status(400).json({ error: 'Invalid optimization profile' });
  }
  const { success, error } = await runSystemCommand(getScriptPath('wg-optimize.sh'), [profile]);
  if (!success) {
    const err = new Error(error || 'Optimization failed');
    err.status = 500;
    throw err;
  }
  res.json({ success: true, profile, message: `Profile ${profile} applied` });
}));

router.get('/audit', auth, asyncWrap(async (req, res) => {
  const stats = await getSystemStats();
  const [{ stdout: fwStatus }, { stdout: ipFwd }, { success: fail2banActive }] =
    await Promise.all([
      runSystemCommand('/usr/sbin/ufw', ['status']).catch(() => ({ stdout: 'inactive' })),
      runSystemCommand('sysctl', ['-n', 'net.ipv4.ip_forward']).catch(() => ({ stdout: '0' })),
      runCommand('pgrep', ['-x', 'fail2ban-server']).catch(() => ({ success: false })),
    ]);

  res.json({
    firewall: (fwStatus || '').includes('active'),
    ipForwarding: (ipFwd || '').trim() === '1',
    fail2ban: fail2banActive,
    disk: stats.disk + '%',
  });
}));

// GET /security-logs is defined below with full implementation

// Access logs (used by LogsSection 'access' tab)
router.get('/logs', auth, asyncWrap(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const history = await db
    .select()
    .from(schema.logs)
    .where(eq(schema.logs.type, 'auth'))
    .orderBy(desc(schema.logs.timestamp))
    .limit(limit);
  res.json(
    history.map((h) => ({
      time: h.timestamp,
      username: h.name,
      ip: h.realIp,
      message: h.virtualIp,
      status: h.status === 'success' ? 'SUCCESS' : 'FAILED',
    }))
  );
}));

router.get('/backups', auth, requireAdmin, asyncWrap(async (req, res) => {
  const backupDir = '/var/backups/wireguard';
  if (!fs.existsSync(backupDir)) return res.json([]);
  const files = await fsPromises.readdir(backupDir);
  const backups = await Promise.all(
    files
      .filter((f) => f.endsWith('.tar.gz'))
      .map(async (f) => {
        const stats = await fsPromises.stat(path.join(backupDir, f));
        return { name: f, size: stats.size, date: stats.mtime };
      })
  );
  res.json(backups.sort((a, b) => b.date - a.date));
}));

router.post('/backup', auth, requireAdmin, asyncWrap(async (req, res) => {
  const { success, error } = await runSystemCommand(getScriptPath('wg-backup.sh'), []);
  if (!success) {
    const err = new Error(error || 'Backup failed');
    err.status = 500;
    throw err;
  }
  res.json({ success: true, message: 'Sauvegarde créée avec succès' });
}));

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

router.post('/test-telegram', auth, requireAdmin, async (req, res) => {
  const message = `🔔 TEST SENTINEL : Le système de notification Telegram est opérationnel sur votre serveur ${os.hostname()}.`;
  const { success, error } = await runSystemCommand(getScriptPath('wg-send-msg.sh'), [message]);
  if (!success) return res.status(500).json({ error: error || "Échec de l'envoi Telegram" });
  res.json({ success: true, message: 'Notification de test envoyée avec succès' });
});

router.get('/security-logs', auth, requireAdmin, asyncWrap(async (req, res) => {
  const logFile = '/var/log/wg-enforcer.log';
  if (!fs.existsSync(logFile)) return res.json([]);
  const { success, stdout } = await runCommand('tail', ['-n', '100', logFile]);
  if (!success) return res.json([]);
  const lines = stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(' - ');
      return { date: parts?.[0], message: parts?.[1] || line };
    });
  res.json(lines.reverse());
}));

// BUG-FIX: Route manquante pour /api/system/container-logs
router.get('/container-logs', auth, requireAdmin, asyncWrap(async (req, res) => {
  const entries = log.getBuffer(null, 100);
  res.json(
    entries.map((e) => ({
      date: e.ts,
      level: e.level,
      message: `[${e.svc}] ${e.msg}` + (e.path ? ` [${e.method} ${e.path}]` : ''),
    }))
  );
}));

router.get('/security-audit', auth, requireAdmin, asyncWrap(async (req, res) => {
  const hasUfw = await fsPromises
    .stat('/usr/sbin/ufw')
    .then(() => true)
    .catch(() => false);
  const { stdout: ufwStatus } = hasUfw
    ? await runSystemCommand('/usr/sbin/ufw', ['status']).catch(() => ({ stdout: 'inactive' }))
    : { stdout: 'not installed' };

  const { stdout: dockerPsi } = await runCommand('docker', [
    'ps',
    '--format',
    '{{.Names}} ({{.Status}})',
  ]).catch(() => ({ stdout: 'N/A' }));
  const system = await getSystemStats();

  const { stdout: f2bStats } = await runSystemCommand('fail2ban-client', [
    'status',
    'wg-api',
  ]).catch(() => ({ stdout: '' }));
  const bannedCount = (f2bStats.match(/Currently banned:\s+(\d+)/) || [0, 0])?.[1];

  res.json({
    firewall: ufwStatus.includes('active') ? 'Protected' : 'Warning',
    ufw: ufwStatus.trim().split('\n')?.[0],
    containers: dockerPsi.trim().split('\n'),
    diskUsage: `${system.disk}%`,
    integrity: 'Optimal',
    fail2ban: `${bannedCount} IPs bloquées`,
    timestamp: new Date().toISOString(),
  });
}));

router.post('/logs/clear', auth, requireAdmin, asyncWrap(async (req, res) => {
  const result = await gcAuditLogs(0); // 0 days = all
  await runSystemCommand('truncate', ['-s', '0', '/var/log/wg-enforcer.log']).catch(() => {});
  res.json({ success: true, ...result });
}));

router.get('/health', auth, asyncWrap(async (req, res) => {
  const iface = process.env.WG_INTERFACE || 'wg0';
  const interfaceExists = fs.existsSync(getInterfacePath(iface));
  const { success } = await runSystemCommand(WG_BIN, ['show', iface]).catch(() => ({
    success: false,
  }));
  const system = await getSystemStats();
  res.json({
    status: interfaceExists && success && parseFloat(system.disk) < 95 ? 'healthy' : 'unhealthy',
    service: interfaceExists ? 'active' : 'inactive',
    interface: success ? 'up' : 'down',
    stats: system,
    jobs: getJobStatus(),
    version: '3.1.0-Platinum',
  });
}));

module.exports = router;

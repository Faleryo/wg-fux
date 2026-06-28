const express = require('express');
const router = express.Router();
const os = require('os');
const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');

const { db, schema } = require('../../db');
const { eq, and, desc, gt } = require('drizzle-orm');
const { auth, requireAdmin, requireManager } = require('../middleware/auth');
const {
  systemConfigSchema,
  optimizeSchema,
  restartSchema,
  logsQuerySchema,
} = require('../../db/validation');

const { runCommand, runSystemCommand, writeFileAsRoot } = require('../services/shell');
const {
  getWireGuardStats,
  getSystemStats,
  formatBytes,
  getInterfacePath,
} = require('../services/system');
const { getJobStatus } = require('../services/jobs');
const { getScriptPath } = require('../services/config');
const { auditLog, gcAuditLogs } = require('../services/audit');
const log = require('../services/logger');
const axios = require('axios');
const { asyncWrap, createError } = require('../utils/errors');

const WG_BIN = process.env.WG_BIN || 'wg';
const WG_QUICK_BIN = process.env.WG_QUICK_BIN || 'wg-quick';

// --- AdGuard Status Check ---
// BUG-FIX: Use env var with fallback (consistent with dns.js) instead of hardcoded URL.
const AGH_BASE_URL = process.env.AGH_BASE_URL || 'http://adguard:3000';
const AGH_USER = (process.env.AGH_USER || '').trim();
const AGH_PASS = (process.env.AGH_PASSWORD || '').trim();

router.get(
  '/adguard-status',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
    try {
      if (AGH_PASS.length < 8) {
        return res
          .status(500)
          .json({ error: 'AdGuard password misconfigured (minimum 8 characters required)' });
      }

      const authHeader = `Basic ${Buffer.from(`${AGH_USER}:${AGH_PASS}`).toString('base64')}`;

      const response = await axios.get(`${AGH_BASE_URL}/control/status`, {
        headers: { Authorization: authHeader },
        timeout: 3000,
      });
      res.json({ status: response.status === 200 ? 'active' : 'inactive' });
    } catch (e) {
      log.warn('system', 'AdGuard health check failed', { error: e.message });
      res.json({ status: 'inactive' });
    }
  })
);

// --- Metrics & Stats ---

router.get(
  '/stats',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
    const iface = req.query.interface || process.env.WG_INTERFACE || 'wg0';
    const peers = await getWireGuardStats(iface);
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
      interface: iface,
      network: {
        totalDownload: formatBytes(totalRx),
        totalUpload: formatBytes(totalTx),
        connectedClients: connectedCount,
      },
      system,
    });
  })
);

router.get(
  '/telemetry',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
    const { getTelemetry } = require('../services/system');
    const iface = req.query.interface || process.env.WG_INTERFACE || 'wg0';
    const telemetry = await getTelemetry(iface);
    res.json(telemetry);
  })
);

router.get(
  '/interfaces',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
    const { getInterfaces } = require('../services/system');
    const interfaces = await getInterfaces();
    res.json(interfaces);
  })
);

router.get(
  '/traffic-history',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
    const since24h = new Date(Date.now() - 24 * 3600 * 1000);
    const history = await db
      .select()
      .from(schema.logs)
      .where(and(eq(schema.logs.type, 'snapshot'), gt(schema.logs.timestamp, since24h)))
      .orderBy(desc(schema.logs.timestamp))
      .limit(240);

    const grouped = {};
    history.forEach((h) => {
      const time = h.timestamp ? h.timestamp.toISOString().split(':')?.[0] : '';
      if (!grouped[time]) grouped[time] = { time, rx: 0, tx: 0 };
      grouped[time].rx += h.usageDaily || 0;
      grouped[time].tx += h.usageTotal || 0;
    });

    res.json(Object.values(grouped).sort((a, b) => a.time.localeCompare(b.time)));
  })
);

// --- Service & Hardware Management ---

router.get(
  '/services',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
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
            const { success } = await runCommand('curl', [
              '-sf',
              '--max-time',
              '2',
              'http://nginx:80/',
            ]).catch(() => ({ success: false }));
            active = success;
          } else if (svc.id === 'dashboard') {
            const { success } = await runCommand('curl', [
              '-sf',
              '--max-time',
              '2',
              'http://ui:80/',
            ]).catch(() => ({ success: false }));
            active = success;
          }
        } catch (e) {
          log.warn('system', 'Service health check failed', { id: svc.id, error: e.message });
        }
        return { ...svc, status: active ? 'active' : 'inactive' };
      })
    );
    res.json(servicesStatus);
  })
);

router.post(
  '/restart/:id',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const iface = process.env.WG_INTERFACE || 'wg0';
    const parsed = restartSchema.safeParse(req.params);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Format ID invalide'));
    }
    const { id } = parsed.data;

    if (id === 'wireguard') {
      await runSystemCommand(WG_QUICK_BIN, ['down', iface]);
      const { success, error } = await runSystemCommand(WG_QUICK_BIN, ['up', iface]);
      if (!success) {
        throw createError(error, 'WireGuard restart failed', 'SYSTEM_ERROR');
      }
      return res.json({ success: true, message: 'WireGuard restarted' });
    }
    res.json({
      success: true,
      message: `Restart requested for ${id} (Managed by Docker)`,
    });
  })
);

router.post(
  '/reload-peers',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const iface = process.env.WG_INTERFACE || 'wg0';
    const {
      success: stripOk,
      stdout: strippedConf,
      error: stripErr,
    } = await runSystemCommand(WG_QUICK_BIN, ['strip', iface]);

    if (!stripOk) {
      throw createError(stripErr, 'wg-quick strip failed', 'SYSTEM_ERROR');
    }

    if (!strippedConf || strippedConf.trim().length === 0) {
      throw createError(
        'Generated configuration is empty. Sync aborted for safety.',
        null,
        'CONFIG_ERROR'
      );
    }

    const { success, error } = await runSystemCommand(
      WG_BIN,
      ['syncconf', iface, '/dev/stdin'],
      strippedConf
    );
    if (!success) {
      throw createError(error, 'syncconf failed', 'SYSTEM_ERROR');
    }
    res.json({ success: true });
  })
);

// --- Configuration ---

router.get(
  '/config',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
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
      runSystemCommand(WG_BIN, ['show', iface, 'listen-port'])
        .then((r) => r.stdout)
        .catch(() => null),
      runSystemCommand('ip', ['-j', 'link', 'show', iface])
        .then((r) => {
          try {
            const data = JSON.parse(r.stdout);
            return data[0]?.mtu?.toString() || null;
          } catch {
            return null;
          }
        })
        .catch(() => null),
    ]);

    res.json({
      port: livePort || config.SERVER_PORT || '51820',
      mtu: liveMtu || config.SERVER_MTU || '1420',
      dns: config.CLIENT_DNS || '1.1.1.1, 8.8.8.8',
      subnet: config.VPN_SUBNET || '10.0.0.0/24',
      keepalive: parseInt(config.PERSISTENT_KEEPALIVE) || 0,
      wg_endpoint: config.SERVER_DOMAIN || config.SERVER_IP || '',
    });
  })
);

router.post(
  '/config',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const result = systemConfigSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(createError(result.error, 'Validation failed'));
    }
    const { port, mtu, dns, subnet, keepalive, wg_endpoint } = result.data;

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
    if (wg_endpoint !== undefined) updateKey('SERVER_DOMAIN', wg_endpoint);

    const { success: writeOk, error: writeErr } = await writeFileAsRoot(
      '/etc/wireguard/manager.conf',
      conf
    );
    if (!writeOk) {
      throw createError(writeErr, 'Failed to write configuration file', 'EACCES');
    }

    const wgIface = process.env.WG_INTERFACE || 'wg0';
    if (port) await runSystemCommand(WG_BIN, ['set', wgIface, 'listen-port', port]).catch(() => {});

    await auditLog({
      actor: req.user.username,
      action: 'patch_system_config',
      targetType: 'system',
      targetName: 'config',
    });

    res.json({ success: true });
  })
);

// --- Maintenance & Tools ---

router.get(
  '/congestion',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const [current, available] = await Promise.all([
      fsPromises
        .readFile('/proc/sys/net/ipv4/tcp_congestion_control', 'utf8')
        .then((s) => s.trim()),
      fsPromises
        .readFile('/proc/sys/net/ipv4/tcp_available_congestion_control', 'utf8')
        .then((s) => s.trim().split(' ')),
    ]);
    res.json({ current, available });
  })
);

router.get(
  '/uptime',
  auth,
  asyncWrap(async (req, res) => {
    const uptimeInSeconds = os.uptime();
    const days = Math.floor(uptimeInSeconds / (3600 * 24));
    const hours = Math.floor((uptimeInSeconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((uptimeInSeconds % 3600) / 60);
    res.json({ uptime: `${days}d ${hours}h ${minutes}m` });
  })
);

let isSpeedtestRunning = false;
let speedtestTimeout = null;
router.post(
  '/speedtest',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    if (isSpeedtestRunning) {
      return res
        .status(429)
        .json(createError('Speedtest already running', null, 'CONCURRENCY_ERROR'));
    }
    isSpeedtestRunning = true;
    speedtestTimeout = setTimeout(() => {
      isSpeedtestRunning = false;
      speedtestTimeout = null;
    }, 120000);
    try {
      const { success, stdout, error } = await runSystemCommand(
        getScriptPath('wg-speedtest.sh'),
        []
      );
      if (!success) {
        throw createError(error, 'Speedtest failed', 'SYSTEM_ERROR');
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
      if (speedtestTimeout) {
        clearTimeout(speedtestTimeout);
        speedtestTimeout = null;
      }
    }
  })
);

router.get(
  '/optimize',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
    const stateFile = '/etc/wireguard/active_profile';
    if (!fs.existsSync(stateFile)) return res.json({ profile: 'default' });
    const profile = await fsPromises.readFile(stateFile, 'utf8').then((s) => s.trim());
    res.json({ profile });
  })
);

router.post(
  '/optimize',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const result = optimizeSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json(createError(result.error, 'Validation failed'));
    }
    const { profile } = result.data;
    const cmdResult = await runSystemCommand(getScriptPath('wg-optimize.sh'), [profile]);
    if (!cmdResult.success) {
      log.error('optimize', `Script failed: ${cmdResult.error}`, {
        stderr: cmdResult.stderr,
        stdout: cmdResult.stdout,
        code: cmdResult.code,
      });
      throw createError(null, `Optimization failed: ${cmdResult.error}`, 'SYSTEM_ERROR');
    }
    res.json({ success: true, profile, message: `Profile ${profile} applied` });
  })
);

router.get(
  '/audit',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
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
  })
);

router.get(
  '/logs',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
    const parsed = logsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json(createError(parsed.error, 'Paramètres de logs invalides'));
    }
    const { level } = parsed.data;
    const limit = Math.min(500, Math.max(1, parseInt(parsed.data.limit) || 100));
    const offset = Math.max(0, parseInt(parsed.data.offset) || 0);

    let query = db.select().from(schema.logs);

    if (level) {
      query = query.where(eq(schema.logs.type, level.toLowerCase()));
    }

    const history = await query.orderBy(desc(schema.logs.timestamp)).limit(limit).offset(offset);
    res.json(
      history.map((h) => ({
        time: h.timestamp,
        username: h.name,
        ip: h.realIp,
        message: h.virtualIp,
        status: h.status === 'success' ? 'SUCCESS' : 'FAILED',
      }))
    );
  })
);

router.get(
  '/backups',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const backupDir = process.env.BACKUP_DIR || '/app/data/backups';
    if (!fs.existsSync(backupDir)) return res.json([]);
    const entries = await fsPromises.readdir(backupDir, { withFileTypes: true });
    const backups = await Promise.all(
      entries
        .filter((e) => e.isFile() && e.name.endsWith('.tar.gz'))
        .map(async (e) => {
          const stats = await fsPromises.stat(path.join(backupDir, e.name));
          return { name: e.name, size: stats.size, date: stats.mtime };
        })
    );
    res.json(backups.sort((a, b) => b.date - a.date));
  })
);

router.post(
  '/backup',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const { success, error } = await runSystemCommand(getScriptPath('wg-backup.sh'), []);
    if (!success) {
      throw createError(error, 'Backup failed', 'SYSTEM_ERROR');
    }
    res.json({ success: true, message: 'Sauvegarde créée avec succès' });
  })
);

router.post(
  '/harden',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const { success, error } = await runSystemCommand(getScriptPath('wg-harden.sh'), []);
    if (!success) throw createError(error, 'Hardening failed', 'SYSTEM_ERROR');
    res.json({ success: true, message: 'Système durci avec succès' });
  })
);

router.post(
  '/maintenance/check-expiry',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const { success, error } = await runSystemCommand(getScriptPath('wg-check-expiry.sh'), []);
    if (!success) throw createError(error, 'Expiry check failed', 'SYSTEM_ERROR');
    res.json({ success: true, message: 'Vérification terminée' });
  })
);

router.post(
  '/test-telegram',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const message = `🔔 TEST SENTINEL : Le système de notification Telegram est opérationnel sur votre serveur ${os.hostname()}.`;
    const { success, error } = await runSystemCommand(getScriptPath('wg-send-msg.sh'), [message]);
    if (!success)
      throw createError(error || "Échec de l'envoi Telegram", null, 'EXTERNAL_SERVICE_ERROR');
    res.json({ success: true, message: 'Notification de test envoyée avec succès' });
  })
);

router.get(
  '/security-logs',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
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
  })
);

router.get(
  '/container-logs',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const entries = log.getBuffer(null, 100);
    res.json(
      entries.map((e) => ({
        date: e.ts,
        level: e.level,
        message: `[${e.svc}] ${e.msg}` + (e.path ? ` [${e.method} ${e.path}]` : ''),
      }))
    );
  })
);

router.get(
  '/security-audit',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const hasUfw = await fsPromises
      .stat('/usr/sbin/ufw')
      .then(() => true)
      .catch(() => false);
    const { stdout: ufwStatus } = hasUfw
      ? await runSystemCommand('/usr/sbin/ufw', ['status']).catch(() => ({ stdout: 'inactive' }))
      : { stdout: 'not installed' };

    const dockerResult = await runCommand('docker', [
      'ps',
      '--format',
      '{{.Names}} ({{.Status}})',
    ]).catch(() => ({ stdout: 'N/A' }));
    const dockerPsi = dockerResult && dockerResult.stdout != null ? dockerResult.stdout : 'N/A';
    const system = await getSystemStats();

    const f2bResult = await runSystemCommand('fail2ban-client', ['status', 'wg-api']).catch(() => ({
      stdout: '',
    }));
    const f2bStats = f2bResult && f2bResult.stdout != null ? f2bResult.stdout : '';
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
  })
);

router.post(
  '/logs/clear',
  auth,
  requireAdmin,
  asyncWrap(async (req, res) => {
    const result = await gcAuditLogs(0, 0);
    try {
      await writeFileAsRoot('/var/log/wg-enforcer.log', '');
    } catch (_) {
      log.warn('system', 'Failed to clear enforcer log');
    }
    res.json({ success: true, ...result });
  })
);

router.get(
  '/health',
  auth,
  requireManager,
  asyncWrap(async (req, res) => {
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
      version: '3.1.0',
    });
  })
);

module.exports = router;

const path = require('path');
const fsPromises = require('fs').promises;
const schedule = require('node-schedule');
const { db, schema, sqlite } = require('../../db');
const { eq, and, lt } = require('drizzle-orm');
const { runCommand, runSystemCommand, appendFileAsRoot } = require('./shell');
const { getWireGuardStats } = require('./system');
const log = require('./logger');
const { getScriptPath } = require('./config');
const { auditLog } = require('./audit');
const notify = require('./notifications');

const DATA_DIR = path.join(__dirname, '../../data');
const SCHEDULE_FILE = path.join(DATA_DIR, 'optimization_schedule.json');

let scheduledJobs = {};
let lastSeenStats = {};
let isUpdatingUsage = false;
let isLoggingTraffic = false;
let lastUsageUpdate = null;
let lastTrafficLog = null;

const loadSchedules = async () => {
  Object.keys(scheduledJobs).forEach((id) => scheduledJobs[id]?.cancel?.());
  scheduledJobs = {};

  try {
    const data = await fsPromises.readFile(SCHEDULE_FILE, 'utf8');
    const tasks = JSON.parse(data);
    if (!Array.isArray(tasks)) return;

    tasks.forEach((task) => {
      const parts = (task.time || '').split(':');
      if (parts.length < 2) return;
      const hour = parseInt(parts[0]);
      const minute = parseInt(parts[1]);
      if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        log.warn('jobs', 'Invalid schedule time, skipping', { task: task.id, time: task.time });
        return;
      }

      const rule = new schedule.RecurrenceRule();
      rule.hour = hour;
      rule.minute = minute;

      const job = schedule.scheduleJob(rule, () => {
        runSystemCommand(getScriptPath('wg-optimize.sh'), [task.profile || 'default']).catch((e) =>
          log.error('jobs', 'Scheduled optimization failed', { err: e.message })
        );
      });
      scheduledJobs[task.id] = job;
    });
  } catch (e) {
    if (e.code !== 'ENOENT') log.error('jobs', 'Error loading schedules', { err: e.message });
  }
};

const pruneSeenStats = async () => {
  try {
    const allClients = await db
      .select({ publicKey: schema.clients.publicKey })
      .from(schema.clients);
    const validKeys = new Set(allClients.map((c) => c.publicKey));
    for (const key of Object.keys(lastSeenStats)) {
      if (!validKeys.has(key)) {
        delete lastSeenStats[key];
      }
    }
  } catch (e) {
    log.error('jobs', 'Error pruning seen stats', { err: e.message });
  }
};

const updateUsage = async () => {
  if (isUpdatingUsage) return;
  isUpdatingUsage = true;
  try {
    const peers = await getWireGuardStats();
    const today = new Date().toISOString().split('T')?.[0];
    lastUsageUpdate = new Date();

    for (const peer of peers || []) {
      const currentTotal = (peer.rx || 0) + (peer.tx || 0);
      const pubKey = peer.publicKey;
      if (!pubKey) continue;

      const lastSession = lastSeenStats[pubKey] || 0;
      const delta = currentTotal >= lastSession ? currentTotal - lastSession : currentTotal;
      lastSeenStats[pubKey] = currentTotal;

      if (delta > 0) {
        try {
          await db.transaction(async (tx) => {
            const usageResults = await tx
              .select()
              .from(schema.usage)
              .where(eq(schema.usage.publicKey, pubKey))
              .limit(1);
            const existingUsage = usageResults?.[0];

            let daily = {};
            if (existingUsage?.daily) {
              try {
                daily =
                  typeof existingUsage.daily === 'string'
                    ? JSON.parse(existingUsage.daily)
                    : existingUsage.daily;
              } catch {
                daily = {};
              }
            }

            daily[today] = (Number(daily[today]) || 0) + delta;
            const newTotal = (Number(existingUsage?.total) || 0) + delta;

            await tx
              .insert(schema.usage)
              .values({
                publicKey: pubKey,
                total: newTotal,
                daily: JSON.stringify(daily),
              })
              .onConflictDoUpdate({
                target: schema.usage.publicKey,
                set: { total: newTotal, daily: JSON.stringify(daily) },
              });
          });
        } catch (e) {
          log.error('jobs', 'Usage update transaction failed', { pubKey, err: e.message });
        }
      }
    }

    await pruneSeenStats();

    const enfResult = await runSystemCommand(getScriptPath('wg-enforcer.sh'), []).catch((e) => ({
      success: false,
      error: e.message,
      stdout: '',
      stderr: '',
    }));

    const output = (enfResult.stdout || enfResult.stderr || '').trim();
    if (output) {
      const logContent = `${new Date().toISOString()} - ${output.replace(/\n/g, ' ')}\n`;
      await appendFileAsRoot('/var/log/wg-enforcer.log', logContent).catch(() => {});
    }
  } catch (e) {
    log.error('jobs', 'Usage Update Error', { err: e.message });
  } finally {
    isUpdatingUsage = false;
  }
};

const logTrafficHistory = async () => {
  if (isLoggingTraffic) return;
  isLoggingTraffic = true;
  try {
    const peers = await getWireGuardStats();
    const timestamp = new Date();
    lastTrafficLog = timestamp;

    for (const peer of peers || []) {
      if (!peer.publicKey) continue;
      await db
        .insert(schema.logs)
        .values({
          timestamp,
          type: 'snapshot',
          status: 'captured',
          name: peer.publicKey,
          realIp: peer.endpoint || null,
          // BUG-FIX: In WireGuard, rx = bytes received by the SERVER (client upload),
          //           tx = bytes transmitted by the SERVER (client download).
          // usageDaily stores the latest rx snapshot; usageTotal stores the tx snapshot.
          usageDaily: peer.rx || 0,
          usageTotal: peer.tx || 0,
        })
        .catch((e) => log.error('jobs', 'Traffic snapshot DB insert failed', { err: e.message }));
    }

    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
    await db
      .delete(schema.logs)
      .where(and(eq(schema.logs.type, 'snapshot'), lt(schema.logs.timestamp, seventyTwoHoursAgo)))
      .catch(() => {});

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await db
      .delete(schema.logs)
      .where(and(eq(schema.logs.type, 'auth'), lt(schema.logs.timestamp, thirtyDaysAgo)))
      .catch(() => {});
  } catch (e) {
    log.error('jobs', 'Traffic Log Error', { err: e.message });
  } finally {
    isLoggingTraffic = false;
  }
};

// State machine for the interface watchdog so we don't spam logs/notifs
// every cycle when wg0 stays down. Emits ONE alert on transition and goes
// silent until recovery or manual intervention.
let _watchdogRunning = false;
const _watchdogState = { status: 'up', alertedAt: 0, alertedKernel: false };
const ALERT_BACKOFF_MS = 60 * 60 * 1000; // re-alert at most once per hour

const interfaceWatchdog = async () => {
  if (_watchdogRunning) return;
  _watchdogRunning = true;
  const interfaceName = process.env.WG_INTERFACE || 'wg0';
  try {
    const check = await runSystemCommand('ip', ['link', 'show', interfaceName]);
    if (check.success) {
      // Transition DOWN → UP : log + reset state
      if (_watchdogState.status === 'down') {
        log.info('sre', `Interface ${interfaceName} is back UP.`);
        _watchdogState.status = 'up';
        _watchdogState.alertedAt = 0;
      }
      return;
    }

    const now = Date.now();

    // Periodically re-check kernel module when previously missing
    if (_watchdogState.alertedKernel) {
      const backoffExpired = now - _watchdogState.alertedAt > ALERT_BACKOFF_MS;
      if (!backoffExpired) return;
      const modCheck = await runCommand('grep', ['-q', 'wireguard', '/proc/modules']);
      if (modCheck.success) {
        log.info('sre', 'WireGuard kernel module now available. Resuming watchdog.');
        _watchdogState.alertedKernel = false;
        _watchdogState.alertedAt = 0;
      } else {
        _watchdogState.alertedAt = now;
        return;
      }
    }

    // Warn once and give up if kernel module is missing
    if (!_watchdogState.alertedKernel) {
      const modCheck = await runCommand('grep', ['-q', 'wireguard', '/proc/modules']);
      if (!modCheck.success) {
        log.warn(
          'sre',
          `WireGuard kernel module not loaded on host. Auto-healing disabled for ${interfaceName}.`
        );
        _watchdogState.alertedKernel = true;
        _watchdogState.alertedAt = now;
        return;
      }
    }
    const isNewIncident = _watchdogState.status !== 'down';
    const isBackoffExpired = now - _watchdogState.alertedAt > ALERT_BACKOFF_MS;
    if (!isNewIncident && !isBackoffExpired) return; // stay quiet until backoff

    log.warn(
      'sre',
      `Watchdog detected interface ${interfaceName} is DOWN. Attempting auto-healing...`
    );
    _watchdogState.status = 'down';
    _watchdogState.alertedAt = now;

    await runSystemCommand(getScriptPath('wg-send-msg.sh'), [
      `🚨 ALERTE SRE: Interface ${interfaceName} détectée DOWN. Tentative d'auto-réparation en cours...`,
    ]).catch(() => {});

    const repair = await runSystemCommand('wg-quick', ['up', interfaceName]);
    const healed = repair.success;
    const error = repair.error;

    try {
      await auditLog({
        actor: 'sre-watchdog',
        action: 'auto-healing',
        targetType: 'interface',
        targetName: interfaceName,
        details: { success: healed, error: healed ? null : error },
        ip: '127.0.0.1',
      });
    } catch (e) {
      log.error('sre', 'Watchdog audit failed', { err: e.message });
    }

    if (healed) {
      log.info('sre', `Interface ${interfaceName} restored successfully.`);
      _watchdogState.status = 'up';
      _watchdogState.alertedAt = 0;
    } else {
      log.error('sre', `Auto-healing failed for ${interfaceName}: ${error}`);
    }
  } catch (e) {
    log.error('sre', 'Watchdog execution error', { err: e.message });
  } finally {
    _watchdogRunning = false;
  }
};

const adguardWatchdog = async () => {
  const axios = require('axios');
  const AGH_BASE_URL = process.env.AGH_BASE_URL || 'http://adguard:3000';
  const AGH_USER = (process.env.AGH_USER || '').trim();
  const AGH_PASS = (process.env.AGH_PASSWORD || '').trim();
  if (!AGH_USER || !AGH_PASS) {
    log.warn('sre', 'AdGuard credentials not configured; skipping watchdog');
    return;
  }
  if (AGH_PASS.length < 8) {
    log.warn('sre', 'AdGuard password too short, skipping watchdog');
    return;
  }
  const authHeader = `Basic ${Buffer.from(`${AGH_USER}:${AGH_PASS}`).toString('base64')}`;

  try {
    await axios.get(`${AGH_BASE_URL}/control/status`, {
      headers: { Authorization: authHeader },
      timeout: 5000,
    });
  } catch (e) {
    log.warn('sre', 'AdGuard Home health check failed. Attempting restart via Sentinel API...');
    // In Docker, we can't easily restart another container without Docker socket.
    // However, the Sentinel Watchdog (Python) on the host manages this.
    // We log it and send a notification.
    await notify.send(
      'sre',
      '🚨 ALERTE DNS: AdGuard Home ne répond plus. Intervention Sentinel requise.',
      { error: e.message }
    );
  }
};

const startJobs = () => {
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') return;
  loadSchedules();
  setInterval(updateUsage, 60000);
  setInterval(logTrafficHistory, 60000);
  setInterval(interfaceWatchdog, 30000);
  setInterval(adguardWatchdog, 60000);
  setInterval(rotateEnforcerLogs, 3600000);
  setInterval(vacuumDatabase, 86400000 * 7); // Weekly maintenance
  scheduleAutomaticBackup();
};

const rotateEnforcerLogs = async () => {
  const logFile = '/var/log/wg-enforcer.log';
  const maxSize = 100 * 1024 * 1024;

  try {
    const stats = await fsPromises.stat(logFile);
    if (stats.size > maxSize) {
      log.info('sre', `Rotating ${logFile} (size: ${stats.size} bytes)`);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = `${logFile}.${timestamp}.bak`;

      await fsPromises.copyFile(logFile, backupFile);
      await fsPromises.truncate(logFile, 0);

      await runSystemCommand('gzip', [backupFile]).catch(() => {});

      const allLogs = await fsPromises.readdir('/var/log/').catch(() => []);
      const rotatedLogs = allLogs
        .filter((f) => f.startsWith('wg-enforcer.log.') && f.endsWith('.gz'))
        .sort()
        .reverse();
      if (rotatedLogs.length > 5) {
        for (let i = 5; i < rotatedLogs.length; i++) {
          const fileToRemove = path.join('/var/log/', rotatedLogs?.[i]);
          await fsPromises.unlink(fileToRemove).catch(() => {});
        }
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') log.error('sre', 'Log rotation failed', { err: e.message });
  }
};

const scheduleAutomaticBackup = () => {
  const rule = new schedule.RecurrenceRule();
  rule.hour = 3;
  rule.minute = 0;
  schedule.scheduleJob(rule, async () => {
    const result = await runSystemCommand(getScriptPath('wg-backup.sh'), []).catch((e) => ({
      success: false,
      error: e.message,
    }));
    if (!result.success) log.error('jobs', 'Automatic backup failed', { err: result.error });
  });
};

const vacuumDatabase = async () => {
  log.info('db', '📦 Running database maintenance (VACUUM)...');
  try {
    sqlite.exec('VACUUM');
    log.info('db', '✅ Database VACUUM complete.');
  } catch (e) {
    log.error('db', '❌ Database VACUUM failed', { err: e.message });
  }
};

const getJobStatus = () => ({
  usageUpdate: { lastRun: lastUsageUpdate, status: isUpdatingUsage ? 'running' : 'idle' },
  trafficLog: { lastRun: lastTrafficLog, status: isLoggingTraffic ? 'running' : 'idle' },
});

module.exports = {
  startJobs,
  loadSchedules,
  getJobStatus,
  updateUsage,
  logTrafficHistory,
  rotateEnforcerLogs,
  pruneSeenStats,
  SCHEDULE_FILE,
};

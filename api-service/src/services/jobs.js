const path = require('path');
const fsPromises = require('fs').promises;
const schedule = require('node-schedule');
const { db, schema } = require('../../db');
const { eq, and, lt } = require('drizzle-orm');
const { runSystemCommand, appendFileAsRoot } = require('./shell');
const { getWireGuardStats } = require('./system');
const log = require('./logger');
const { getScriptPath } = require('./config');

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
        const usageResults = await db
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

        await db
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
      }
    }

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

const interfaceWatchdog = async () => {
  const interfaceName = process.env.WG_INTERFACE || 'wg0';
  try {
    const check = await runSystemCommand('ip', ['link', 'show', interfaceName]);
    if (!check.success) {
      log.warn(
        'sre',
        `Watchdog detected interface ${interfaceName} is DOWN. Attempting auto-healing...`
      );

      await runSystemCommand(getScriptPath('wg-send-msg.sh'), [
        `🚨 ALERTE SRE: Interface ${interfaceName} détectée DOWN. Tentative d'auto-réparation en cours...`,
      ]).catch(() => {});

      const repair = await runSystemCommand('wg-quick', ['up', interfaceName]);
      const healed = repair.success;
      const error = repair.error;

      try {
        const { auditLog } = require('./audit');
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

      if (healed) log.info('sre', `Interface ${interfaceName} restored successfully.`);
      else log.error('sre', `Auto-healing failed for ${interfaceName}: ${error}`);
    }
  } catch (e) {
    log.error('sre', 'Watchdog execution error', { err: e.message });
  }
};

const startJobs = () => {
  loadSchedules();
  setInterval(updateUsage, 60000);
  setInterval(logTrafficHistory, 60000);
  setInterval(interfaceWatchdog, 30000);
  setInterval(rotateEnforcerLogs, 3600000);
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

const getJobStatus = () => ({
  usageUpdate: { lastRun: lastUsageUpdate, status: isUpdatingUsage ? 'running' : 'idle' },
  trafficLog: { lastRun: lastTrafficLog, status: isLoggingTraffic ? 'running' : 'idle' },
});

module.exports = {
  startJobs,
  loadSchedules,
  getJobStatus,
  SCHEDULE_FILE,
};

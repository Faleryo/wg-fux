const path = require('path');
const fsPromises = require('fs').promises;
const schedule = require('node-schedule');
const { db, schema } = require('../../db');
const { eq, and, lt } = require('drizzle-orm');
const { runSystemCommand, appendFileAsRoot } = require('./shell');
const { getWireGuardStats } = require('./system');
const log = require('./logger');
// BUG-FIX: Utiliser getScriptPath pour une résolution cohérente des scripts (comme clients.js)
const { getScriptPath } = require('./config');

const DATA_DIR = path.join(__dirname, '../../data');
const SCHEDULE_FILE = path.join(DATA_DIR, 'optimization_schedule.json');

let scheduledJobs = {};
let lastSeenStats = {};
let isUpdatingUsage = false;
let isLoggingTraffic = false;
let lastUsageUpdate = null;
let lastTrafficLog = null;

/**
 * Load optimization schedules from JSON file
 */
const loadSchedules = async () => {
  Object.keys(scheduledJobs).forEach(id => scheduledJobs[id].cancel());
  scheduledJobs = {};

  try {
    const data = await fsPromises.readFile(SCHEDULE_FILE, 'utf8');
    const tasks = JSON.parse(data);
    tasks.forEach(task => {
      const [hour, minute] = task.time.split(':');
      const rule = new schedule.RecurrenceRule();
      rule.hour = parseInt(hour);
      rule.minute = parseInt(minute);

      const job = schedule.scheduleJob(rule, () => {
        // BUG-FIX: Utiliser getScriptPath au lieu du chemin /usr/local/bin hardcodé
        runSystemCommand(getScriptPath('wg-optimize.sh'), [task.profile])
          .catch(e => console.error('[JOB] Scheduled optimization failed:', e.message));
      });
      scheduledJobs[task.id] = job;
    });
  } catch (e) { 
    if (e.code !== 'ENOENT') console.error('[JOB] Error loading schedules:', e); 
  }
};

/**
 * Update data usage in database based on WG stats
 */
const updateUsage = async () => {
  if (isUpdatingUsage) return;
  isUpdatingUsage = true;
  try {
    const peers = await getWireGuardStats();
    const today = new Date().toISOString().split('T')[0];
    lastUsageUpdate = new Date();

    for (const peer of peers) {
      const currentTotal = peer.rx + peer.tx;
      const pubKey = peer.publicKey;
            
      const lastSession = lastSeenStats[pubKey] || 0;
      const delta = currentTotal >= lastSession ? currentTotal - lastSession : currentTotal;
      lastSeenStats[pubKey] = currentTotal;

      if (delta > 0) {
        const [existingUsage] = await db.select().from(schema.usage).where(eq(schema.usage.publicKey, pubKey)).limit(1);
                
        let daily = {};
        if (existingUsage && existingUsage.daily) {
          try { 
            daily = typeof existingUsage.daily === 'string' ? JSON.parse(existingUsage.daily) : existingUsage.daily;
          } catch(e) {
            console.error('[AUDIT] Failed to parse daily usage JSON:', e.message);
            daily = {};
          }
        }
                
        daily[today] = (daily[today] || 0) + delta;
        const newTotal = (existingUsage ? existingUsage.total : 0) + delta;

        await db.insert(schema.usage).values({
          publicKey: pubKey,
          total: newTotal,
          daily: JSON.stringify(daily)
        }).onConflictDoUpdate({
          target: schema.usage.publicKey,
          set: { total: newTotal, daily: JSON.stringify(daily) }
        });
      }
    }
    // BUG-FIX: Output redirected to /var/log/wg-enforcer.log for the "Security" tab visibility
    const { success: enfOk, stdout: enfOut, stderr: enfErr } = await runSystemCommand(getScriptPath('wg-enforcer.sh'), [])
      .catch(e => ({ success: false, error: e.message, stdout: '', stderr: e.message }));
    
    if (enfOut || enfErr) {
      const logContent = `${new Date().toISOString()} - ${(enfOut || enfErr).trim().replace(/\n/g, ' ')}\n`;
      await appendFileAsRoot('/var/log/wg-enforcer.log', logContent).catch(() => {});
    }
  } catch (e) {
    console.error('[JOB] Usage Update Error:', e);
  } finally {
    isUpdatingUsage = false;
  }
};

/**
 * Log hourly traffic snapshots for history charts
 */
const logTrafficHistory = async () => {
  if (isLoggingTraffic) return;
  isLoggingTraffic = true;
  try {
    const peers = await getWireGuardStats();
    const timestamp = new Date();
    lastTrafficLog = timestamp;

    for (const peer of peers) {
      await db.insert(schema.logs).values({
        timestamp,
        type: 'snapshot',
        status: 'captured',
        name: peer.publicKey, 
        realIp: peer.endpoint || null,
        usageDaily: peer.rx,   // rx = bytes received by server from peer (peer's upload)
        usageTotal: peer.tx    // tx = bytes sent by server to peer (peer's download)
      });
    }
        
    const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
    await db.delete(schema.logs).where(and(eq(schema.logs.type, 'snapshot'), lt(schema.logs.timestamp, seventyTwoHoursAgo)));
        
    // SRE Hardening: Purge old auth logs (30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await db.delete(schema.logs).where(and(eq(schema.logs.type, 'auth'), lt(schema.logs.timestamp, thirtyDaysAgo)));
  } catch (e) {
    console.error('[JOB] Traffic Log Error:', e);
  } finally {
    isLoggingTraffic = false;
  }
};

/**
 * Autonomic SRE Watchdog: Ensure WireGuard interface is UP
 */
const interfaceWatchdog = async () => {
  const interfaceName = process.env.WG_INTERFACE || 'wg0';
  try {
    const { success: isUp } = await runSystemCommand('ip', ['link', 'show', interfaceName]);
    if (!isUp) {
      log.warn('sre', `Watchdog detected interface ${interfaceName} is DOWN. Attempting auto-healing...`);
      
      // 💠 SRE Alert: Notify admin via Telegram/Messenger script
      await runSystemCommand(getScriptPath('wg-send-msg.sh'), [`🚨 ALERTE SRE: Interface ${interfaceName} détectée DOWN. Tentative d'auto-réparation en cours...`]).catch(() => {});

      // FIX: Use wg-quick via sudo if needed, but in container it should be fine if privileged or cap_add
      const { success: healed, error } = await runSystemCommand('wg-quick', ['up', interfaceName]);

      
      const { auditLog } = require('./audit');
      await auditLog({
        actor: 'sre-watchdog',
        action: 'auto-healing',
        targetType: 'interface',
        targetName: interfaceName,
        details: { success: healed, error: healed ? null : error },
        ip: '127.0.0.1'
      });

      if (healed) log.info('sre', `Interface ${interfaceName} restored successfully.`);
      else log.error('sre', `Auto-healing failed for ${interfaceName}: ${error}`);
    }
  } catch (e) {
    log.error('sre', 'Watchdog execution error', { err: e.message });
  }
};


/**
 * Start all recurring jobs
 */
const startJobs = () => {
  loadSchedules();
  setInterval(updateUsage, 60000);
  setInterval(logTrafficHistory, 60000); // 1 minute frequency for "Live" data
  // SRE Watchdog Pulse (toutes les 30s)
  setInterval(interfaceWatchdog, 30000);
  // Rotation des logs toutes les heures
  setInterval(rotateEnforcerLogs, 3600000);
  // Job backup automatique quotidien à 3h00 du matin
  scheduleAutomaticBackup();
};

/**
 * Rotate wg-enforcer.log if it exceeds 100MB
 */
const rotateEnforcerLogs = async () => {
  const logFile = '/var/log/wg-enforcer.log';
  const maxSize = 100 * 1024 * 1024; // 100 MB

  try {
    const stats = await fsPromises.stat(logFile);
    if (stats.size > maxSize) {
      log.info('sre', `Rotating ${logFile} (size: ${stats.size} bytes)`);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFile = `${logFile}.${timestamp}.bak`;
      
      // Copy and truncate to keep the file handle valid if open
      await runSystemCommand('cp', [logFile, backupFile]);
      await runSystemCommand('truncate', ['-s', '0', logFile]);
      
      // Compress the backup
      await runSystemCommand('gzip', [backupFile]);
      
      // Cleanup: Keep only last 5 rotated logs
      const { files: allLogs } = await runSystemCommand('ls', ['-1', '/var/log/']).then(r => ({ files: r.stdout.split('\n') }));
      const rotatedLogs = allLogs.filter(f => f.startsWith('wg-enforcer.log.') && f.endsWith('.gz')).sort().reverse();
      if (rotatedLogs.length > 5) {
        for (let i = 5; i < rotatedLogs.length; i++) {
          await runSystemCommand('rm', [path.join('/var/log/', rotatedLogs[i])]);
        }
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') log.error('sre', 'Log rotation failed', { err: e.message });
  }
};

/**
 * Schedule automatic daily backup at 03:00
 */
const scheduleAutomaticBackup = () => {
  const rule = new schedule.RecurrenceRule();
  rule.hour = 3;
  rule.minute = 0;
  schedule.scheduleJob(rule, async () => {
    console.log('[JOB] Backup automatique quotidien à 03:00...');
    const result = await runSystemCommand(getScriptPath('wg-backup.sh'), [])
      .catch(e => ({ success: false, error: e.message }));
    if (result.success) {
      console.log('[JOB] Backup créé avec succès.');
    } else {
      console.error('[JOB] Échec du backup automatique:', result.error);
    }
  });
  console.log('[JOB] Backup automatique planifié quotidiennement à 03:00.');
};

const getJobStatus = () => ({
  usageUpdate: { lastRun: lastUsageUpdate, status: isUpdatingUsage ? 'running' : 'idle' },
  trafficLog: { lastRun: lastTrafficLog, status: isLoggingTraffic ? 'running' : 'idle' }
});

module.exports = {
  startJobs,
  loadSchedules,
  getJobStatus,
  SCHEDULE_FILE
};

const path = require('path');
const fsPromises = require('fs').promises;
const schedule = require('node-schedule');
const { db, schema } = require('../../db');
const { eq, and, lt } = require('drizzle-orm');
const { runSystemCommand } = require('./shell');
const { getWireGuardStats } = require('./system');
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
                        daily = JSON.parse(existingUsage.daily); 
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
        // BUG-FIX: await ajouté + .catch pour éviter les promesses orphelines et erreurs silencieuses
        await runSystemCommand(getScriptPath('wg-enforcer.sh'), [])
            .catch(e => console.error('[JOB] Enforcer failed during usage update:', e.message));
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
                usageDaily: peer.rx,
                usageTotal: peer.tx
            });
        }
        
        const seventyTwoHoursAgo = new Date(Date.now() - 72 * 60 * 60 * 1000);
        await db.delete(schema.logs).where(and(eq(schema.logs.type, 'snapshot'), lt(schema.logs.timestamp, seventyTwoHoursAgo)));
    } catch (e) {
        console.error('[JOB] Traffic Log Error:', e);
    } finally {
        isLoggingTraffic = false;
    }
};

/**
 * Start all recurring jobs
 */
const startJobs = () => {
    loadSchedules();
    setInterval(updateUsage, 60000);
    setInterval(logTrafficHistory, 3600000);
    // Job backup automatique quotidien à 3h00 du matin
    scheduleAutomaticBackup();
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

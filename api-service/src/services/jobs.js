const path = require('path');
const fsPromises = require('fs').promises;
const schedule = require('node-schedule');
const { db, schema, sqlite } = require('../../db');
const { eq, and, lt, lte, gte } = require('drizzle-orm');
const { runCommand, runSystemCommand, appendFileAsRoot } = require('./shell');
const { getExecutorForServer } = require('./executors');
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

// Shared WireGuard peer snapshot — both updateUsage and logTrafficHistory
// previously called getWireGuardStats() independently each minute, doubling
// the number of `wg show dump` subprocess invocations. Now one call serves both.
let _sharedPeers = null;
let _sharedPeersTs = 0;
let _sharedPeersPromise = null;
const SHARED_PEERS_TTL = 55000; // 55s — safe within the 60s job interval

const getSharedPeers = async () => {
  const now = Date.now();
  if (_sharedPeers && now - _sharedPeersTs < SHARED_PEERS_TTL) return _sharedPeers;
  // Coalesce concurrent callers onto a single in-flight request (promise-singleton)
  if (!_sharedPeersPromise) {
    _sharedPeersPromise = getWireGuardStats()
      .then((peers) => {
        _sharedPeers = peers;
        _sharedPeersTs = Date.now();
        return peers;
      })
      .finally(() => {
        _sharedPeersPromise = null;
      });
  }
  return _sharedPeersPromise;
};

// Track which clients have already received a quota/expiry notification this
// session so we don't spam on every polling cycle.
// Pruned periodically to avoid unbounded memory growth.
const _notifiedQuota = new Set();
const _notifiedExpiry = new Set();
const MAX_NOTIFY_SET_SIZE = 10000;
// Cache quota bytes per publicKey so the DB lookup inside updateUsage runs only
// once per peer per session instead of on every 60s tick.
const _quotaCache = new Map(); // publicKey → quota in bytes (0 = no quota set)
const MAX_QUOTA_CACHE_SIZE = 10000;

const pruneNotificationSets = () => {
  if (_notifiedQuota.size > MAX_NOTIFY_SET_SIZE) _notifiedQuota.clear();
  if (_notifiedExpiry.size > MAX_NOTIFY_SET_SIZE) _notifiedExpiry.clear();
  if (_quotaCache.size > MAX_QUOTA_CACHE_SIZE) _quotaCache.clear();
};

const invalidateSharedPeersCache = () => {
  _sharedPeers = null;
  _sharedPeersTs = 0;
};

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
        const rawProfile = task.profile || '';
        const safeProfile = /^[a-zA-Z0-9_-]{1,64}$/.test(rawProfile) ? rawProfile : 'default';
        runSystemCommand(getScriptPath('wg-optimize.sh'), [safeProfile]).catch((e) =>
          log.error('jobs', 'Scheduled optimization failed', { err: e.message })
        );
      });
      const safeId = String(task.id || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (safeId) scheduledJobs[safeId] = job;
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
    const peers = await getSharedPeers();
    const today = new Date().toISOString().split('T')?.[0];
    lastUsageUpdate = new Date();

    for (const peer of peers || []) {
      const currentTotal = (peer.rx || 0) + (peer.tx || 0);
      const pubKey = peer.publicKey;
      if (!pubKey) continue;

      // On first sight, record as baseline only — avoids counting all
      // historical WireGuard traffic as a spike on the first poll run.
      const isFirstSeen = !Object.prototype.hasOwnProperty.call(lastSeenStats, pubKey);
      const lastSession = lastSeenStats[pubKey] || 0;
      const delta = isFirstSeen
        ? 0
        : currentTotal >= lastSession
          ? currentTotal - lastSession
          : currentTotal;
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
            const prevTotal = Number(existingUsage?.total) || 0;
            const newTotal = prevTotal + delta;

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

            // Notify when a client crosses its quota threshold for the first time.
            // _quotaCache avoids a DB round-trip on every tick; the entry is set
            // on first lookup and reused for the lifetime of the process.
            if (!_notifiedQuota.has(pubKey)) {
              if (!_quotaCache.has(pubKey)) {
                const [client] = await tx
                  .select({
                    name: schema.clients.name,
                    container: schema.clients.container,
                    quota: schema.clients.quota,
                  })
                  .from(schema.clients)
                  .where(eq(schema.clients.publicKey, pubKey))
                  .limit(1);
                const qb = client?.quota > 0 ? client.quota * 1024 * 1024 * 1024 : 0;
                _quotaCache.set(pubKey, {
                  bytes: qb,
                  name: client?.name,
                  container: client?.container,
                  gb: client?.quota,
                });
              }
              const cached = _quotaCache.get(pubKey);
              if (cached.bytes > 0 && prevTotal < cached.bytes && newTotal >= cached.bytes) {
                _notifiedQuota.add(pubKey);
                notify
                  .send(
                    'quota',
                    `🚨 QUOTA DÉPASSÉ: Client '${cached.name}' (${cached.container}) a consommé ${cached.gb} GB — accès suspendu.`
                  )
                  .catch(() => {});
              }
            }
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
    const peers = await getSharedPeers();
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

    // Prune system/maintenance logs older than 90 days (previously never cleaned up)
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    await db
      .delete(schema.logs)
      .where(and(eq(schema.logs.type, 'system'), lt(schema.logs.timestamp, ninetyDaysAgo)))
      .catch(() => {});
    await db
      .delete(schema.logs)
      .where(and(eq(schema.logs.type, 'maintenance'), lt(schema.logs.timestamp, ninetyDaysAgo)))
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

    const repair = await runSystemCommand(process.env.WG_QUICK_BIN || 'wg-quick', [
      'up',
      interfaceName,
    ]);
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

// Reconcile containers table with filesystem to prevent drift between the two
// sources of truth (filesystem + SQLite). Runs daily. Logs warnings and
// auto-inserts missing DB rows; it does NOT delete DB rows for missing dirs
// (those are handled by explicit container delete operations).
const reconcileContainers = async () => {
  try {
    const dir = process.env.WG_CLIENTS_DIR || '/etc/wireguard/clients';
    const entries = await fsPromises.readdir(dir, { withFileTypes: true }).catch(() => []);
    const fsContainers = entries.filter((e) => e.isDirectory()).map((e) => e.name);

    const dbRows = await db.select({ name: schema.containers.name }).from(schema.containers);
    const dbNames = new Set(dbRows.map((c) => c.name));

    for (const name of fsContainers) {
      if (!dbNames.has(name)) {
        log.warn(
          'reconcile',
          `Container '${name}' on filesystem but missing from DB — auto-inserting`
        );
        await db
          .insert(schema.containers)
          .values({ name, owner: 'admin', interface: process.env.WG_INTERFACE || 'wg0' })
          .onConflictDoNothing()
          .catch((e) => log.error('reconcile', 'Auto-insert failed', { name, err: e.message }));
      }
    }
  } catch (e) {
    log.error('reconcile', 'Container reconciliation error', { err: e.message });
  }
};

// Check for clients expiring in the next 24h and send one Telegram notification
// per client per session. Runs every 6 hours so we catch new expirations.
const checkClientExpirations = async () => {
  try {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const todayStr = now.toISOString().split('T')[0];
    const in24hStr = in24h.toISOString().split('T')[0];

    // Clients with expiry between now and 24h from now
    const expiringSoon = await db
      .select({
        name: schema.clients.name,
        container: schema.clients.container,
        expiry: schema.clients.expiry,
      })
      .from(schema.clients)
      .where(and(gte(schema.clients.expiry, todayStr), lte(schema.clients.expiry, in24hStr)));

    for (const client of expiringSoon) {
      const key = `expiry-${client.container}-${client.name}-${client.expiry}`;
      if (_notifiedExpiry.has(key)) continue;
      _notifiedExpiry.add(key);
      notify
        .send(
          'expiry',
          `⏰ EXPIRATION IMMINENTE: Client '${client.name}' (${client.container}) expire le ${client.expiry}.`
        )
        .catch(() => {});
    }
  } catch (e) {
    log.error('jobs', 'Expiration check error', { err: e.message });
  }
};

// Heartbeat des VPS revendeurs. Deux modes de liveness :
//  - Instances AUTONOMES (nouveau flow, pas de hostKey SSH pinnée) : c'est le
//    phone-home de licence (lastHeartbeat, toutes les 6h) qui prouve la vie —
//    silence > 24h = offline. Aucun SSH tenté.
//  - Mode SSH historique (hostKey pinnée, ex. pi) : sonde wg-fux-verify.sh.
// On ignore pending/provisioning (transitoires) et offline (terminal — réactivé
// manuellement ou au prochain provisioning).
const AUTONOMOUS_STALE_MS = 24 * 3600 * 1000;

// Alerte Telegram admin quand un serveur PASSE offline (la boucle saute les
// serveurs déjà offline, donc chaque appel ici est une vraie transition).
function alertServerOffline(server, reason) {
  const { sendAdminAlert, escapeHtml } = require('./telegramBot');
  sendAdminAlert(
    `🔴 <b>Serveur hors ligne</b>\n<b>${escapeHtml(server.label)}</b> (#${server.id}, ${escapeHtml(server.host || '?')}) : ${escapeHtml(reason)}`
  ).catch(() => {});
}

let isHeartbeating = false;
const serverHeartbeat = async () => {
  if (isHeartbeating) return;
  isHeartbeating = true;
  try {
    const servers = await db.select().from(schema.servers);
    for (const server of servers) {
      if (['pending', 'provisioning', 'offline'].includes(server.status)) continue;
      let online = false;
      let errMsg = null;
      if (!server.hostKey) {
        // Instance autonome : la route /license/heartbeat pose lastHeartbeat +
        // status online (et remet consecutiveFailures à 0) ; ici on ne fait que
        // détecter le silence prolongé. Sans AUCUN heartbeat reçu (instance qui
        // vient d'être promue), on compte les ticks silencieux (60s/tick).
        const last = server.lastHeartbeat ? new Date(server.lastHeartbeat).getTime() : 0;
        const silentTicks = (server.consecutiveFailures || 0) + 1;
        const stale = last ? Date.now() - last >= AUTONOMOUS_STALE_MS : silentTicks >= 1440; // 1440 ticks × 60s = 24h sans jamais de phone-home
        if (!stale) {
          if (!last) {
            await db
              .update(schema.servers)
              .set({ consecutiveFailures: silentTicks })
              .where(eq(schema.servers.id, server.id));
          }
          continue;
        }
        await db
          .update(schema.servers)
          .set({
            status: 'offline',
            lastChecked: new Date(),
            lastError: 'Aucun heartbeat de licence depuis plus de 24h',
          })
          .where(eq(schema.servers.id, server.id));
        alertServerOffline(server, 'aucun heartbeat de licence depuis plus de 24h');
        continue;
      }
      try {
        const executor = await getExecutorForServer(server.id);
        const result = await executor.run('wg-fux-verify.sh', []);
        online = !!(result && result.success);
        if (!online) errMsg = (result && (result.error || result.stderr)) || 'health check failed';
      } catch (e) {
        errMsg = e.message;
      }
      if (online) {
        await db
          .update(schema.servers)
          .set({
            status: 'online',
            consecutiveFailures: 0,
            lastChecked: new Date(),
            lastError: null,
          })
          .where(eq(schema.servers.id, server.id));
      } else {
        const failures = (server.consecutiveFailures || 0) + 1;
        await db
          .update(schema.servers)
          .set({
            status: failures >= 3 ? 'offline' : 'error',
            consecutiveFailures: failures,
            lastChecked: new Date(),
            lastError: errMsg,
          })
          .where(eq(schema.servers.id, server.id));
        if (failures >= 3) alertServerOffline(server, errMsg || 'sonde SSH en échec');
      }
    }
  } catch (e) {
    log.error('jobs', 'Server heartbeat error', { err: e.message });
  } finally {
    isHeartbeating = false;
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Renouvellement de licence PAR CRÉDITS : le crédit est le moyen de paiement de
// la licence (1 crédit = 30 jours de licence pour 1 serveur). Quand une licence
// approche de l'échéance (≤ 3 jours), on débite 1 crédit du portefeuille du
// propriétaire et on prolonge de 30 jours. Solde insuffisant → la licence expire
// naturellement (création bloquée sur l'instance, JAMAIS de coupure VPN) et
// l'admin est alerté. Ainsi la marge N1→N2 sur les crédits est inévitable : la
// seule façon de garder une licence active est de détenir des crédits.
//
// Garde-fous :
//  - serveurs de l'admin : jamais débités (la plateforme ne se facture pas).
//  - instance morte (aucun heartbeat depuis 30 j) : on ne facture pas un serveur
//    abandonné ; le renouvellement reprend si l'instance re-heartbeat.
//  - idempotence naturelle : après prolongation, l'échéance sort de la fenêtre.
//  - un renouvellement tardif repart de MAINTENANT (on ne facture pas le trou).
const RENEW_WINDOW_MS = 3 * 24 * 3600 * 1000; // débit à J-3 de l'échéance
const RENEW_PERIOD_MS = 30 * 24 * 3600 * 1000; // 1 crédit = 30 jours
const DEAD_INSTANCE_MS = 30 * 24 * 3600 * 1000; // silence > 30 j = abandonné
const _shortfallAlerted = new Map(); // serverId → ts dernière alerte (throttle 24h)
let isRenewingLicenses = false;
const renewLicensesByCredits = async () => {
  if (isRenewingLicenses) return;
  isRenewingLicenses = true;
  try {
    const wallet = require('./wallet');
    const { sendAdminAlert, escapeHtml } = require('./telegramBot');
    const now = Date.now();

    const servers = await db
      .select({
        id: schema.servers.id,
        ownerId: schema.servers.ownerId,
        label: schema.servers.label,
        licenseKey: schema.servers.licenseKey,
        licenseExpiry: schema.servers.licenseExpiry,
        lastHeartbeat: schema.servers.lastHeartbeat,
        createdAt: schema.servers.createdAt,
        ownerRole: schema.users.role,
        ownerName: schema.users.username,
      })
      .from(schema.servers)
      .innerJoin(schema.users, eq(schema.servers.ownerId, schema.users.id));

    for (const server of servers) {
      if (!server.licenseKey || server.ownerRole === 'admin') continue;
      const expiry = server.licenseExpiry ? new Date(server.licenseExpiry).getTime() : 0;
      if (!expiry || expiry > now + RENEW_WINDOW_MS) continue; // rien d'exigible

      // Instance abandonnée : jamais de heartbeat ET création vieille de 30 j,
      // ou dernier heartbeat trop ancien → on ne débite pas.
      const lastSeen = server.lastHeartbeat
        ? new Date(server.lastHeartbeat).getTime()
        : server.createdAt
          ? new Date(server.createdAt).getTime()
          : 0;
      if (!lastSeen || now - lastSeen > DEAD_INSTANCE_MS) continue;

      const newExpiry = new Date(Math.max(now, expiry) + RENEW_PERIOD_MS);
      const ref = `lic:${server.id}:${newExpiry.toISOString().slice(0, 10)}`;
      try {
        wallet.debit(server.ownerId, 1, 'license_renewal', { ref });
        await db
          .update(schema.servers)
          .set({ licenseExpiry: newExpiry })
          .where(eq(schema.servers.id, server.id));
        _shortfallAlerted.delete(server.id);
        await auditLog({
          actor: 'system',
          action: 'renew_license',
          targetType: 'server',
          targetName: server.label,
          details: {
            serverId: server.id,
            ownerId: server.ownerId,
            credits: 1,
            ref,
            licenseExpiry: newExpiry.toISOString(),
          },
        });
        log.info('jobs', 'Licence renouvelée par crédit', { serverId: server.id, ref });
      } catch (e) {
        if (e.code === 'INSUFFICIENT_FUNDS') {
          log.warn('jobs', 'Solde insuffisant — la licence va expirer', {
            serverId: server.id,
            ownerId: server.ownerId,
          });
          await auditLog({
            actor: 'system',
            action: 'credit_shortfall',
            targetType: 'server',
            targetName: server.label,
            details: { serverId: server.id, ownerId: server.ownerId },
          });
          const lastAlert = _shortfallAlerted.get(server.id) || 0;
          if (now - lastAlert > 24 * 3600 * 1000) {
            _shortfallAlerted.set(server.id, now);
            sendAdminAlert(
              `💳 <b>Solde insuffisant</b>\nServeur <b>${escapeHtml(server.label)}</b> (#${server.id}) de <b>${escapeHtml(server.ownerName)}</b> : ` +
                `licence expirant le ${new Date(expiry).toISOString().slice(0, 10)} — 1 crédit requis pour renouveler.`
            ).catch(() => {});
          }
        } else {
          log.error('jobs', 'Renouvellement par crédit échoué', {
            serverId: server.id,
            err: e.message,
          });
        }
      }
    }
  } catch (e) {
    log.error('jobs', 'License renewal error', { err: e.message });
  } finally {
    isRenewingLicenses = false;
  }
};

const startJobs = () => {
  if (process.env.VITEST === 'true' || process.env.NODE_ENV === 'test') return;
  loadSchedules();
  setInterval(updateUsage, 60000);
  setInterval(logTrafficHistory, 60000);
  setInterval(serverHeartbeat, 60000); // Santé des VPS revendeurs distants
  setInterval(interfaceWatchdog, 30000);
  setInterval(adguardWatchdog, 60000);
  setInterval(rotateEnforcerLogs, 3600000);
  setInterval(vacuumDatabase, 86400000 * 7); // Weekly maintenance
  setInterval(reconcileContainers, 86400000); // Daily filesystem↔DB reconciliation
  setInterval(checkClientExpirations, 6 * 3600000); // Every 6h
  setInterval(pruneNotificationSets, 3600000); // Hourly pruning of notification sets
  setInterval(renewLicensesByCredits, 6 * 3600000); // Renouvellement licences par crédits
  reconcileContainers(); // Run once at startup
  checkClientExpirations(); // Check expirations at startup
  scheduleAutomaticBackup();

  // Phone-home de licence (instances revendeurs uniquement — no-op sans clé).
  const { checkLicenseNow, licenseEnabled } = require('./license');
  if (licenseEnabled()) {
    setTimeout(checkLicenseNow, 15000); // au boot (laisse la DB s'initialiser)
    setInterval(checkLicenseNow, 6 * 3600000); // puis toutes les 6h
  }

  // Bot Telegram admin (no-op tant que token/chat non configurés dans les réglages).
  try {
    require('./telegramBot').startTelegramBot();
  } catch (e) {
    log.warn('jobs', 'Démarrage bot Telegram échoué', { err: e.message });
  }
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

      // Create a fresh empty file first so logFile is never absent between ops
      const tmpLog = `${logFile}.tmp`;
      await fsPromises.writeFile(tmpLog, '');
      await fsPromises.rename(logFile, backupFile);
      await fsPromises.rename(tmpLog, logFile);

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
  checkClientExpirations,
  renewLicensesByCredits,
  invalidateSharedPeersCache,
  SCHEDULE_FILE,
};

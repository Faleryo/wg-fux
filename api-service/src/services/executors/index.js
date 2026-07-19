// services/executors/index.js — Fabrique + résolution + pool de connexions SSH.
//
// CARTE DE LA CHAÎNE D'EXÉCUTION SHELL (point d'entrée canonique — les autres
// fichiers de la chaîne pointent ici plutôt que de répéter la carte) :
//
//   route/service                   1 appel par exécution système, jamais de shell direct
//        │
//        ├─► resolveExecutor(req)   (CE FICHIER) choisit LocalExecutor ou SshExecutor
//        │        selon req.serverId (posé par le middleware resolveServer en amont ;
//        │        le contrôle de propriété est fait là, pas ici)
//        │
//        ├─► services/shell.js      façade rétrocompatible : runSystemCommand(file, args,
//        │        stdin, opts) = opts.executor.run(...) ou LocalExecutor par défaut
//        │
//        ├─► executors/local.js     LocalExecutor.run() → préfixe `sudo -E -n` si non-root,
//        │        puis délègue à shell-core.js (SAFE_ARG, timeout, binaire check)
//        │
//        └─► executors/ssh.js       SshExecutor.run() → encode [file,...args] en JSON/base64,
//                 exécute via `wg-fux <payload>` sur le VPS distant (forced command défini
//                 côté serveur dans core-vpn/scripts/wg-fux-dispatch.sh, élévation root là-bas)
//
// resolveExecutor(req)        : choisit l'exécuteur selon le rôle (local pour
//                               admin/manager, ssh-via-pool pour revendeur).
// getExecutorForServer(id)    : cache Map serverId → { executor, lastUsed },
//                               TTL idle 5 min, reconnexion gérée par SshExecutor.
//
// Éviction périodique des connexions inactives via setInterval().unref().

const localExecutor = require('./local'); // singleton LocalExecutor
const SshExecutor = require('./ssh');
const log = require('../logger');

const POOL_IDLE_MS = 5 * 60 * 1000; // 5 min d'inactivité avant éviction
const EVICT_INTERVAL_MS = 10 * 60 * 1000; // balayage toutes les 10 min

// serverId → { executor, lastUsed }
const sshPool = new Map();

/**
 * Résout l'exécuteur pour une requête.
 *  - cible distante explicite (req.serverId, posée par resolveServer) → SSH, QUEL
 *    que soit le rôle. Permet à l'admin de piloter un VPS distant et au revendeur
 *    de cibler le sien (le contrôle de propriété est fait par resolveServer en amont).
 *  - pas de serveur → LocalExecutor pour TOUT rôle. Depuis le pivot "instance
 *    complète" (2026-07-03), un revendeur travaille en local (sur son instance
 *    comme sur la mère) — la tenance est garantie par le scoping propriétaire
 *    des routes, plus par le choix d'exécuteur.
 */
async function resolveExecutor(req) {
  if (req && req.serverId) {
    return getExecutorForServer(req.serverId);
  }
  return localExecutor;
}

/**
 * Renvoie (et met en cache) l'exécuteur SSH d'un serveur. Charge la ligne
 * `servers`, déchiffre la clé privée, instancie SshExecutor au premier accès.
 */
async function getExecutorForServer(serverId) {
  const entry = sshPool.get(serverId);
  if (entry && Date.now() - entry.lastUsed < POOL_IDLE_MS) {
    entry.lastUsed = Date.now();
    return entry.executor;
  }
  // Entrée expirée → on ferme l'ancienne connexion avant de recréer.
  if (entry && entry.executor && typeof entry.executor._close === 'function') {
    entry.executor._close();
    sshPool.delete(serverId);
  }

  // require paresseux pour éviter les cycles et faciliter le mock en test.
  const { db, schema } = require('../../../db');
  const { eq } = require('drizzle-orm');
  const { decryptPrivateKey } = require('../crypto');

  const [server] = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId))
    .limit(1);

  if (!server) {
    const e = new Error(`Server ${serverId} not found`);
    e.code = 'SERVER_NOT_FOUND';
    throw e;
  }

  const executor = new SshExecutor({
    host: server.host,
    port: server.port,
    username: server.sshUsername,
    privateKey: decryptPrivateKey(server),
    hostKey: server.hostKey,
  });
  sshPool.set(serverId, { executor, lastUsed: Date.now() });
  return executor;
}

/**
 * Ferme et oublie les connexions SSH inactives depuis plus de POOL_IDLE_MS.
 */
function evictIdle() {
  const now = Date.now();
  for (const [id, entry] of sshPool) {
    if (now - entry.lastUsed > POOL_IDLE_MS) {
      if (entry.executor && typeof entry.executor._close === 'function') {
        entry.executor._close();
      }
      sshPool.delete(id);
      log.info('ssh', `Connexion SSH idle évincée du pool (serverId=${id})`);
    }
  }
}

/**
 * Ferme toutes les connexions SSH du pool, actives ou non. Appelé à l'arrêt du
 * processus (SIGTERM/SIGINT) pour éviter de laisser des sockets ouverts qui
 * ne se libèrent qu'au bout du timeout TCP.
 */
function closeAll() {
  for (const [id, entry] of sshPool) {
    if (entry.executor && typeof entry.executor._close === 'function') {
      entry.executor._close();
    }
    sshPool.delete(id);
  }
}

const _evictTimer = setInterval(evictIdle, EVICT_INTERVAL_MS);
if (_evictTimer && typeof _evictTimer.unref === 'function') _evictTimer.unref();

module.exports = {
  resolveExecutor,
  getExecutorForServer,
  // Exposés pour les tests / outils (heartbeat, etc.)
  evictIdle,
  closeAll,
  _sshPool: sshPool,
};

# Design : Socle d'exécution SSH distant pour le mode Revendeur / White-label

- **Date** : 2026-06-27
- **Auteur** : Faleryo (avec accompagnement design)
- **Statut** : Approuvé (design), en attente de plan d'implémentation
- **Portée** : Phase 0 — socle technique uniquement (pas d'UI, pas de billing)

---

## 1. Contexte et objectif

wg-fux est aujourd'hui un panneau de contrôle **mono-serveur et local** : l'API Node.js
exécute les scripts `core-vpn/scripts/wg-*.sh` via `sudo` sur le serveur où elle tourne.

L'objectif produit est de transformer wg-fux en **plateforme multi-tenant** où des
revendeurs peuvent enregistrer leur propre VPS, le faire provisionner automatiquement,
puis gérer leurs clients WireGuard dessus — le tout depuis une UI web centralisée.

Cette transformation se décompose en **6 sous-projets** dépendants :

| # | Sous-projet | Dépend de |
|---|-------------|-----------|
| 1 | Couche d'exécution distante (local OU distant) | — (fondation) |
| 2 | Modèle de données multi-tenant (table `servers`, FK tenance) | #1 |
| 3 | Provisioning VPS (revendeur saisit IP + creds → scripts installés) | #1 |
| 4 | Onboarding revendeur + crédits | #2 |
| 5 | UI white-label | #2, #3 |
| 6 | Config WireGuard per-serveur (port, endpoint, interface) | #1, #2 |

**Le présent spec couvre uniquement le sous-projet #1 : la couche d'exécution distante.**
C'est le socle dont tous les autres dépendent. Il est délibérément limité au backend ;
aucune UI n'est incluse.

### Décisions de cadrage actées

- **Modèle d'exécution : SSH direct.** Le SaaS se connecte en SSH au VPS du revendeur
  avec une clé privée qu'il détient. Les scripts `wg-*.sh` existants sont réutilisés
  tels quels, sans réécriture. *(Alternatives écartées : agent qui rappelle, instances
  autonomes fédérées.)*
- **Coexistence local + distant.** L'usage admin mono-serveur actuel continue de
  fonctionner via la même UI. L'exécution distante est un opt-in activé uniquement
  pour les revendeurs. *(Alternative écartée : pivot total distant uniquement.)*
- **Approche d'abstraction : A hybride.** Une interface `Executor` est injectée dans
  `runSystemCommand` (4ᵉ argument optionnel `{ executor }`, défaut `local`). Un
  resolver `resolveExecutor(req)` au niveau route choisit l'exécuteur selon le rôle
  et le serveur ciblé. *(Alternatives écartées : middleware de contexte implicite via
  AsyncLocalStorage ; exécuteur explicite propagé dans chaque route.)*

---

## 2. Architecture

### 2.1 Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────┐
│                        API Node.js                          │
│                                                             │
│   routes/clients.js  ──┐                                    │
│   routes/*.js        ──┼──► resolveExecutor(req)            │
│                         │   (admin → 'local'                │
│                         │    reseller → 'ssh', serveur=X)   │
│                         ▼                                    │
│                 runSystemCommand(file, args, stdin, {       │
│                         executor: <resolved>                │
│                       })                                    │
│          ┌──────────────┴──────────────┐                    │
│          ▼                              ▼                    │
│   ┌──────────────┐             ┌──────────────┐             │
│   │ LocalExecutor│             │  SshExecutor │             │
│   │  (sudo, ex.) │             │ (ssh2 lib)   │             │
│   └──────┬───────┘             └──────┬───────┘             │
└──────────┼────────────────────────────┼──────────────────────┘
           ▼                            ▼
    [VPS local admin]           [VPS revendeur]
    sudo wg-create-client.sh    ssh wg-fux@ip "sudo wg-create-client.sh …"
```

### 2.2 Contrats

1. **Interface `Executor`** (conceptuelle) :
   ```js
   interface Executor {
     run(file, args, stdinData) → { success, stdout, stderr, code }
   }
   ```
   La forme du retour reprend **exactement** `{ success, stdout, stderr, code }` de
   `runCommand` actuel (`api-service/src/services/shell.js`). Aucun consommateur
   n'a à changer.

2. **`resolveExecutor(req)`** :
   - `role === 'admin' | 'manager'` → `local` (comportement actuel inchangé)
   - `role === 'reseller'` + `req.serverId` présent → `ssh` (avec creds du serveur
     ciblé, résolu via le pool)
   - `role === 'reseller'` sans `req.serverId` → erreur 400 `NO_SERVER_SELECTED`
     levée par le middleware `resolveServer` avant la route

3. **`runSystemCommand`** garde sa signature actuelle + un 4ᵉ arg optionnel
   `{ executor }`. Defaut = `local`. Tous les appels existants continuent de marcher
   sans modification.

### 2.3 Principes directeurs

- **Zéro rupture rétrocompatible** : une installation mono-serveur existante se
  comporte strictement identique après migration.
- **Scripts `wg-*.sh` réutilisés tels quels** : ils tournent déjà en root via sudo,
  ils tournent de la même façon à distance.
- **Opt-in** : le distant n'est activé que pour les revendeurs. L'admin ne voit
  aucune différence.

---

## 3. Composants et responsabilités

### 3.1 Résumé

| Composant | Rôle | État |
|---|---|---|
| `services/executors/base.js` | Interface `Executor` (classe abstraite) | Nouveau |
| `services/executors/local.js` | Exécution locale (sudo + hardening) — wrappe l'existant | Nouveau (extraction) |
| `services/executors/ssh.js` | Exécution distante (ssh2) | Nouveau |
| `services/executors/index.js` | Fabrique + `resolveExecutor(req)` + pool de connexions | Nouveau |
| `services/shell.js` | Façade rétrocompatible (`runSystemCommand` + helpers fs avec opt `executor`) | Modifié (léger) |
| `services/shell-core.js` | `runCommand` + `SAFE_ARG` + `stripAnsi` + check binaire | Extrait de `shell.js` |
| `services/crypto.js` | Chiffrement AES-256-GCM des creds serveur | Nouveau |
| `middleware/resolveServer.js` | Resolve `req.server` + contrôle de propriété cross-tenant | Nouveau |

### 3.2 `base.js` — Interface commune

Statel. Méthode unique `run()`. La forme du retour est figée pour garantir la
rétrocompatibilité des consommateurs.

```js
class BaseExecutor {
  async run(file, args = [], stdinData = null) {
    throw new Error('Not implemented');
  }
}
```

### 3.3 `local.js` — Wrappe l'existant

Encapsule la logique déjà présente dans `shell.js` (sudo + `runCommand` + hardening
`SAFE_ARG` + check de binaire). Pas de réécriture — extraction.

```js
const { runCommand, SUDO, SUDO_ARGS } = require('../shell-core');

class LocalExecutor extends BaseExecutor {
  async run(file, args = [], stdinData = null) {
    if (SUDO) return runCommand(SUDO, [...SUDO_ARGS, file, ...args], stdinData);
    return runCommand(file, args, stdinData);
  }
}
```

**Note d'extraction :** `runCommand`, `SAFE_ARG`, `stripAnsi` et le check de binaire
restent dans un module `services/shell-core.js` partagé. `shell.js` devient une façade
qui expose `runSystemCommand` + les helpers fs (`writeFileAsRoot`, etc.) en leur
ajoutant l'option `executor`.

### 3.4 `ssh.js` — Exécution distante

Utilise la lib `ssh2` (dépendance à ajouter à `api-service/package.json`). Gère :
connexion, exécution commandée, propagation du stdin, timeout, déconnexion.

```js
const { Client } = require('ssh2');
const { stripAnsi, SAFE_ARG } = require('../shell-core');

class SshExecutor {
  constructor({ host, port = 22, username, privateKey, hostKey, sudoPassword = null }) {
    this.config = { host, port, username, privateKey, readyTimeout: 15000 };
    this.hostKey = hostKey;
    this.sudoPassword = sudoPassword; // optionnel : sudoers NOPASSWD recommandé
    this.conn = null;
    this.connPromise = null;
  }

  async run(file, args = [], stdinData = null) {
    await this._ensureConnected();
    return this._exec(file, args, stdinData);
  }
  // … détail de _ensureConnected / _exec / _reconnect : voir section 5
}
```

**Choix techniques :**
- **sudoers NOPASSWD sur le VPS** (privilégié) plutôt que `sudo -S` récurrent —
  évite de manipuler le mot de passe sudo à chaque commande et réduit la surface
  d'attaque. Le user `wg-fux` dédié est créé au provisioning (sous-projet #3) avec
  un sudoers restreint aux seuls scripts `wg-*.sh`. Voir section 6.
- **Pas de persistance de shell** — chaque `run()` = une commande `exec` propre sur
  la connexion SSH maintenue ouverte (pooling léger).
- **`stripAnsi` + `SAFE_ARG` réutilisés** — la même politique de hardening s'applique
  aux args distants.

### 3.5 `executors/index.js` — Fabrique + résolution + pool

Fabrique l'exécuteur selon un identifiant et maintient un **cache de connexions**
par `serverId` (évite 1 connexion SSH par clic).

```js
const LocalExecutor = require('./local');
const SshExecutor = require('./ssh');
const { db, schema } = require('../../db');
const { eq } = require('drizzle-orm');
const { decryptPrivateKey } = require('../crypto');

const local = new LocalExecutor();                       // singleton
const sshPool = new Map();                               // serverId → entry
const POOL_IDLE_MS = 5 * 60 * 1000;

async function resolveExecutor(req) {
  if (!req.user || req.user.role === 'admin' || req.user.role === 'manager') return local;
  if (!req.serverId) {
    const e = new Error('NO_SERVER_SELECTED');
    e.code = 'NO_SERVER_SELECTED';
    throw e;
  }
  return getExecutorForServer(req.serverId);
}

async function getExecutorForServer(serverId) {
  const entry = sshPool.get(serverId);
  if (entry && Date.now() - entry.lastUsed < POOL_IDLE_MS) {
    entry.lastUsed = Date.now();
    return entry.executor;
  }
  if (entry) entry.executor._close?.();

  const [server] = await db.select().from(schema.servers)
    .where(eq(schema.servers.id, serverId)).limit(1);
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

function evictIdle() {
  const now = Date.now();
  for (const [id, entry] of sshPool) {
    if (now - entry.lastUsed > POOL_IDLE_MS) {
      entry.executor._close?.();
      sshPool.delete(id);
    }
  }
}
setInterval(evictIdle, 10 * 60 * 1000).unref?.();

module.exports = { resolveExecutor, getExecutorForServer };
```

### 3.6 `shell.js` — Façade rétrocompatible

```js
const { runCommand } = require('./shell-core');
const localExecutor = require('./executors/local'); // singleton

async function runSystemCommand(file, args = [], stdinData = null, opts = {}) {
  const executor = opts.executor || localExecutor;
  return executor.run(file, args, stdinData);
}

// Helpers fs : ajout de opts.executor pour réutilisation distance
async function writeFileAsRoot(filePath, content, opts = {}) {
  const executor = opts.executor || localExecutor;
  // … utilise executor.run('wg-file-proxy.sh', ['write', filePath], content)
}
// idem appendFileAsRoot / unlinkAsRoot / readdirAsRoot
```

**Rétrocompatibilité :** tous les appels existants (`runSystemCommand(file, args)`)
continuent de fonctionner — `opts` est optionnel, défaut `local`.

### 3.7 `middleware/resolveServer.js`

```js
const { db, schema } = require('../db');
const { eq, and } = require('drizzle-orm');

// Résout req.server + req.serverId pour les routes revendeur.
// En-tête attendu : x-server-id. Ignoré pour admin/manager (local).
async function resolveServer(req, res, next) {
  if (!req.user || req.user.role === 'admin' || req.user.role === 'manager') {
    return next(); // admin = local, pas de serveur requis
  }
  const serverId = parseInt(req.headers['x-server-id'], 10);
  if (!Number.isInteger(serverId)) {
    return res.status(400).json({ error: 'En-tête x-server-id manquant ou invalide' });
  }
  const [server] = await db.select().from(schema.servers)
    .where(and(eq(schema.servers.id, serverId), eq(schema.servers.ownerId, req.user.id)))
    .limit(1);
  if (!server) {
    return res.status(403).json({ error: 'Serveur inaccessible ou non propriété du revendeur' });
  }
  req.serverId = serverId;
  req.server = server;
  next();
}
module.exports = resolveServer;
```

---

## 4. Modèle de données

### 4.1 Nouvelle table `servers`

Chaque revendeur peut enregistrer un ou plusieurs VPS. C'est le registre central des
cibles d'exécution. Définition Drizzle à ajouter dans `api-service/db/schema.js` :

```js
const servers = sqliteTable(
  'servers',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ownerId: integer('ownerId').notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),                 // "VPS-Paris-01", libre
    host: text('host').notNull(),                   // IPv4/IPv6/hostname
    port: integer('port').default(22),
    sshUsername: text('sshUsername').notNull(),     // "wg-fux" (user dédié)
    // Clé privée chiffrée AES-256-GCM — voir section 6.2
    encPrivateKey: text('encPrivateKey').notNull(), // blob chiffré base64
    encKeyIv: text('encKeyIv').notNull(),           // IV base64
    encKeyAuth: text('encKeyAuth').notNull(),       // tag GCM (intégrité) base64
    hostKey: text('hostKey'),                       // empreinte known_hosts (anti-MITM)
    status: text('status').default('pending'),      // pending|provisioning|online|error|offline
    consecutiveFailures: integer('consecutiveFailures').default(0), // pour le heartbeat (section 5.3)
    lastChecked: integer('lastChecked', { mode: 'timestamp' }),
    lastError: text('lastError'),
    createdAt: integer('createdAt', { mode: 'timestamp' })
      .default(sql`(cast(strftime('%s','now') as int))`),
  },
  (table) => ({
    serverOwnerIdx: index('server_owner_idx').on(table.ownerId),
    // Un revendeur ne peut pas déclarer deux fois le même host:port
    serverHostIdx: uniqueIndex('server_host_idx').on(table.ownerId, table.host, table.port),
  })
);
```

### 4.2 Modification de la table `containers`

Aujourd'hui un container vit sur le serveur local. Demain il vit sur un serveur
spécifique. On ajoute une FK optionnelle (non-cassante) :

```js
const containers = sqliteTable('containers', {
  // … champs existants inchangés (id, name, owner, interface, createdAt) …
  serverId: integer('serverId') // NULL = serveur local admin (rétrocompatible)
    .references(() => servers.id, { onDelete: 'set null' }),
});
```

### 4.3 Migration : rétrocompatibilité garantie

- Tous les `containers` existants ont `serverId = NULL` → interprétés comme « serveur
  local de l'admin ». Aucune cassure.
- Les `clients` existants ne changent pas : ils restent rattachés à leur `container`,
  qui porte désormais l'info du serveur.
- Aucune table supprimée, aucun champ cassant. Migration `ALTER TABLE containers ADD
  COLUMN serverId INTEGER REFERENCES servers(id) ON DELETE SET NULL` (SQLite
  `ADD COLUMN` est non-cassant). La table `servers` est créée par `CREATE TABLE IF NOT
  EXISTS` via Drizzle au démarrage.

### 4.4 Matrice de tenance

```
users (revendeur)
  └── servers (1:N)              ← son/ses VPS
        └── containers (1:N)     ← ses groupes de clients
              └── clients (1:N)  ← ses clients WireGuard
```

- Un admin voit tout (`role = admin`). Son propre usage local reste `serverId = NULL`.
- Un revendeur ne voit que `servers.ownerId = son id`, et par cascade ses
  containers/clients.

---

## 5. Flux de données

### 5.1 Flux 1 — Création d'un client par un revendeur (cas pivot)

```
[UI revendeur] POST /api/clients { container, name, expiry, quota }
     │  Header: x-server-id: 17
     ▼
[middleware auth]  →  req.user = { id:42, role:'reseller', username:'acme' }
     ▼
[middleware resolveServer]
     │  vérifie server 17 appartient à user 42
     │  → req.server = { id:17, status:'online', ... }
     │  → req.serverId = 17
     ▼
[route POST /api/clients]
     1. validate body
     2. verifyOwnership(req.user, container)
     3. executor = await resolveExecutor(req)  → SshExecutor(server 17)
     4. runSystemCommand('wg-create-client.sh', [container,name,...], null,
                         { executor })
            │
            ▼
       [SshExecutor.run()]
          a. _ensureConnected()  (pool hit sinon connect)
          b. exec: `sudo wg-create-client.sh acme iphone-pierre …`
          c. capture stdout/stderr/exit code
          d. return { success, stdout, stderr, code }
     ▼
[route] 5. parse publicKey depuis stdout (logique existante conservée)
         6. INSERT INTO clients (…, serverId via container)
         7. auditLog({ actor:'acme', action:'create', ... })
         8. res.json(newClient)
```

Points clés :
- L'UI envoie **toujours** `x-server-id` pour les revendeurs. Sans cet en-tête, un
  revendeur obtient une 400.
- Le middleware `resolveServer` fait le contrôle de propriété une fois pour toutes
  les routes. Les routes n'ont plus qu'à appeler `resolveExecutor(req)`.
- Les scripts `wg-*.sh` reçoivent exactement les mêmes args qu'aujourd'hui — ils ne
  savent pas qu'ils tournent à distance.

### 5.2 Flux 2 — Provisioning d'un VPS (installation initiale)

Ce flux appartient au **sous-projet #3** (provisionning), hors-scope de la Phase 0.
Il est décrit ici pour situer le socle : c'est ce qui produit un serveur au statut
`online` exploitable par l'exécuteur SSH.

Sortie attendue du provisioning : un VPS avec user `wg-fux`, accessible uniquement
par clé, scripts WireGuard installés, sudoers restreint, et le SaaS qui détient la
clé privée chiffrée en base. La validation de santé (heartbeat) bascule le statut
à `online`.

### 5.3 Flux 3 — Surveillance de santé (heartbeat)

Le statut `online/offline/error` doit rester à jour sans action utilisateur.

```
[job périodique jobs.js — toutes les 60s]
  FOR each server WHERE status NOT IN ('offline','pending'):
    executor = getExecutorForServer(server.id)
    result = await executor.run('true', [], null)   # commande triviale
    IF !result.success:
      server.consecutiveFailures += 1
      server.status = consecutiveFailures >= 3 ? 'offline' : 'error'
      server.lastError = result.stderr
    ELSE:
      server.consecutiveFailures = 0
      server.status = 'online'
    UPDATE servers SET status, lastChecked=now, lastError
```

Intégré à `jobs.js` existant (qui gère déjà le snapshot de stats), pas de nouveau
daemon.

### 5.4 Cycle de vie d'une connexion SSH (pool)

```
getExecutorForServer(id)
  ├─ cache hit (Map serverId → executor) et lastUsed récent
  │     ├─ connexion vivante (test exec 'true') → return
  │     └─ connexion morte → reconnect() → return
  └─ cache miss → instantiate + connect() → cache → return

// Éviction : toutes les 10 min, ferme les connexions inactives > 5 min
setInterval(evictIdle, 10 * 60 * 1000).unref();
```

Limites :
- Max 1 connexion persistante par `serverId` (pas de pool multi-connexions — inutile
  à cette échelle).
- Timeout de connexion : 15s.
- Timeout de commande : 90s (cohérent avec le local).
- Reconnexion automatique transparente pour la route.

---

## 6. Sécurité

Le SaaS va stocker des clés privées SSH donnant root (via sudo) sur des VPS tiers.
C'est une cible de valeur.

### 6.1 Menaces et contre-mesures

| Menace | Risque | Contre-mesure |
|---|---|---|
| Vol de la base SQLite | Récupération de toutes les clés privées SSH | Chiffrement AES-256-GCM des clés en base, clé maître dans `.env` (jamais en base) |
| MITM au premier SSH | Un attaquant se fait passer pour le VPS | Capture du `hostKey` au provisioning, vérification stricte ensuite |
| Élévation revendeur A → VPS de revendeur B | Accès cross-tenant | Middleware `resolveServer` vérifie `servers.ownerId = req.user.id` à chaque requête |
| Fuite de creds dans logs | Clé privée ou password en clair dans stdout | Redaction log : `host`, `sshUsername` OK ; `encPrivateKey`, passwords → `[REDACTED]` |
| Compromission du user `wg-fux` distant | Prise de main VPS | User dédié, login par clé uniquement (password désactivé post-provisioning), sudo limité à `wg-*.sh` |
| Attaque par dictionnaire sur SSH distant | Bruteforce du VPS | Responsabilité du revendeur (fail2ban recommandé dans la doc provisioning) |

### 6.2 Chiffrement des creds en base

```js
// services/crypto.js (NOUVEAU)
const crypto = require('crypto');

// Clé maître : 32 bytes depuis env var WG_FUX_MASTER_KEY (hex)
const MASTER_KEY = Buffer.from(process.env.WG_FUX_MASTER_KEY, 'hex');

function encryptPrivateKey(privateKeyPem) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
  const enc = Buffer.concat([cipher.update(privateKeyPem), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encPrivateKey: enc.toString('base64'),
    encKeyIv:      iv.toString('base64'),
    encKeyAuth:    tag.toString('base64'),
  };
}

function decryptPrivateKey({ encPrivateKey, encKeyIv, encKeyAuth }) {
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm', MASTER_KEY, Buffer.from(encKeyIv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(encKeyAuth, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(encPrivateKey, 'base64')),
    decipher.final(),
  ]).toString();
}

module.exports = { encryptPrivateKey, decryptPrivateKey };
```

Chaîne de confiance de la clé privée SSH :
1. Générée côté SaaS au provisioning (pair ed25519, écrite en `0600` dans un
   `/tmp/wg-prov-XXXX/` temporaire), uploadée sur le VPS via `ssh-copy-id`, puis
   `shred` localement.
2. Forme chiffrée persistée en base ; le clair ne vit qu'en mémoire processus,
   déchiffré juste-à-temps par `getExecutorForServer`.
3. Clé maître dans `.env`, jamais commitée (déjà le cas pour `JWT_SECRET`).

### 6.3 Sudoers restreint sur le VPS

Au provisioning, on installe un sudoers dédié sur le VPS du revendeur :

```
# /etc/sudoers.d/wg-fux  (sur le VPS distant)
wg-fux ALL=(root) NOPASSWD: /usr/local/bin/wg-*.sh
wg-fux ALL=(root) NOPASSWD: /usr/bin/wg, /usr/bin/wg-quick
wg-fux ALL=(root) NOPASSWD: /usr/sbin/ip, /usr/sbin/wg-quick
```

Le user `wg-fux` ne peut faire que des opérations WireGuard en root. Même si la clé
SSH fuit, l'attaquant ne peut pas `rm -rf /` ni lire `/etc/shadow`. Défense en
profondeur.

### 6.4 Génération de la clé maître

```bash
# setup.sh — ajout
if [ -z "$WG_FUX_MASTER_KEY" ]; then
  echo "WG_FUX_MASTER_KEY=$(openssl rand -hex 32)" >> .env
fi
```

---

## 7. Impact sur l'existant

### 7.1 Fichiers touchés

| Fichier | Nature du changement | Rétrocompatible |
|---|---|---|
| `api-service/src/services/shell.js` | Extraction de `runCommand`/`SAFE_ARG`/`stripAnsi` vers `shell-core.js` ; ajout du 4ᵉ arg `{ executor }` à `runSystemCommand` et helpers fs | Oui (opt optionnel) |
| `api-service/src/services/shell-core.js` | Nouveau module : contenu extrait de `shell.js` inchangé | n/a (nouveau) |
| `api-service/src/services/scripts.js` | `executeScript` reçoit et propage `opts.executor` | Oui (opt optionnel) |
| `api-service/src/middleware/auth.js` | Ajout du rôle `reseller` à la sémantique (alias fonctionnel de `viewer` pour la Phase 0) | Oui |
| `api-service/db/schema.js` | Ajout table `servers`, ajout colonne `containers.serverId` | Oui (ALTER TABLE ADD COLUMN) |
| `api-service/src/middleware/resolveServer.js` | Nouveau middleware | n/a (nouveau) |
| `api-service/src/services/executors/*` | Nouveaux modules (base, local, ssh, index) | n/a (nouveaux) |
| `api-service/src/services/crypto.js` | Nouveau module | n/a (nouveau) |
| `api-service/package.json` | Ajout dépendance `ssh2` | — |
| `setup.sh` | Ajout génération `WG_FUX_MASTER_KEY` | Oui |
| `.env.example` | Ajout `WG_FUX_MASTER_KEY=` (vide) | n/a |

### 7.2 Invariants préservés

- `runSystemCommand(file, args, stdin)` sans 4ᵉ arg → comportement inchangé (local).
- Les routes admin/manager ne reçoivent pas `x-server-id` et n'en ont pas besoin.
- Le cache d'auth utilisateur (`auth.js`) et le token sentinel sont inchangés.

### 7.3 Composants existants réutilisés sans modif

| Composant | Pourquoi inchangé |
|---|---|
| Tous les scripts `core-vpn/scripts/wg-*.sh` | Reçoivent les mêmes args, tournent en root via sudo — idem en distant |
| `services/logger.js` | Wrapper existant — on s'y conforme |
| `services/audit.js` | `auditLog()` existant — étendu pour tracer les actions cross-server (champ `details.serverId`) |
| `db/validation.js` | Validation Zod existante — étendue pour `serverSchema` (Phase 1) |

---

## 8. Tests, rollout et hors-scope

### 8.1 Stratégie de test

| Couche | Outil | Cible |
|---|---|---|
| Unitaire | Vitest (déjà en place) | `SshExecutor`, `crypto`, `resolveExecutor`, `resolveServer` middleware |
| Intégration | Vitest + `ssh2` mocké sur un stub TCP | Cycle complet route → executor → retour |
| E2E local | Playwright (déjà en place, `smoke.spec.js`) | Flux revendeur complet sur serveur mock |
| E2E distant réel | Manuel (1 VPS test jetable) | Provisioning réel → création client → vérif `wg show` sur le VPS |

Mock SSH pour les tests unitaires : le `SshExecutor` injecte un `Client` ssh2 mocké
dont `exec` renvoie un stdout/code déterministe. La politique `SAFE_ARG` reste testée.

Tests critiques à écrire en premier :
1. `resolveExecutor` → local pour admin, ssh pour reseller (avec `req.serverId`)
2. `resolveServer` middleware → 403 si `servers.ownerId !== req.user.id`
3. `crypto` round-trip : `decrypt(encrypt(x)) === x`
4. `SshExecutor` → propage stdin, capture exit code non-zero, timeout
5. Provisioning → password détruit après bootstrap (assert pas de trace en base)

### 8.2 Plan de rollout

**Phase 0 — Socle (ce spec)**
- Executors (local/ssh), crypto, pool, middleware `resolveServer`
- Table `servers`, FK `containers.serverId`
- Migration non-cassante
- Aucune UI revendeur dans cette phase — l'admin teste via curl/Postman

**Phase 1 — Provisioning + UI admin** (spec suivant)
- Routes `/api/servers` (CRUD + provisioning)
- Onglet « Serveurs » dans l'UI admin
- Gestion des crédits (pré-requis : table `credits` + Stripe/manual — spec suivant)

**Phase 2 — UI revendeur** (spec suivant)
- Onboarding revendeur (signup, premier serveur)
- Dashboard revendeur scoped à ses serveurs
- White-label (logo, nom, couleurs)

**Phase 3 — Fédération avancée** (spec suivant)
- Monitoring multi-serveurs agrégé
- Backups cross-serveurs
- Bandwidth caps cross-revendeurs

### 8.3 Critères de succès (Phase 0)

- Une installation mono-serveur existante se comporte strictement identique après
  migration.
- `curl -H "x-api-token: <admin>" /api/clients` → inchangé.
- Un serveur distant (inséré manuellement en base ou via curl pour la Phase 0,
  sans provisioning automatisé) répond `online` au heartbeat et accepte des
  commandes `runSystemCommand` à distance.
- `runSystemCommand` distant exécute `wg-stats.sh --json` sur le VPS et retourne du
  JSON valide.
- Clé privée SSH chiffrée en base (vérif : `sqlite3 wg-fux.db "SELECT encPrivateKey
  FROM servers"` → pas de `-----BEGIN`).
- Tests Vitest verts, E2E Playwright verts.

### 8.4 Explicitement hors-scope (Phase 0)

- Création de comptes revendeurs self-service (signup)
- Système de crédits / billing / Stripe
- Toute UI (onglet revendeur, écrans de config)
- Choix port/endpoint/interface per-serveur (Phase 3 — demande un refactoring de
  `wg-create-client.sh`)
- Fédération multi-serveurs agrégée
- Migration du rôle `viewer` → `reseller` (reporté — on garde `viewer` comme alias
  fonctionnel pour l'instant ; `resolveExecutor` et `resolveServer` reconnaissent
  les deux chaînes)
- Backups cross-serveurs

---

## 9. Décisions reportées au plan d'implémentation

Ces points sont tranchés au niveau design mais leur forme exacte sera précisée dans
le plan d'implémentation (`writing-plans`) :

- **Sémantique du rôle revendeur** : `viewer` existant réutilisé comme alias
  fonctionnel de `reseller` pour la Phase 0, ou introduction explicite d'un rôle
  `reseller` dans `auth.js`. Les deux fonctions (`resolveExecutor`, `resolveServer`)
  doivent reconnaître les deux chaînes pendant la transition.
- **Format de stockage du `hostKey`** : chaîne `known_hosts` brute, ou hash
  normalisé. Tranché pendant l'implémentation de `ssh.js`.
- **Comportement exact de `_reconnect`** sur erreur fatale (`ECONNRESET`,
  `ETIMEDOUT`) : retenter immédiatement ou lever et laisser le heartbeat marquer
  `error`.

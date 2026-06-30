# Design : Réseau de distribution — crédits, marge et white-label

- **Date** : 2026-06-29
- **Auteur** : Faleryo (avec accompagnement design)
- **Statut** : Proposé (design) — en attente de validation
- **Portée** : Couche économique et réseau (wallet, hiérarchie revendeurs, marge, white-label). **Pas de billing externe (Stripe), pas de metering.**

---

## 1. Contexte et objectif

La [spec socle SSH distant](2026-06-27-reseller-ssh-execution-socle-design.md) (2026-06-27)
pose la **couche d'exécution** : un revendeur peut faire tourner les scripts `wg-*.sh`
sur son propre VPS via SSH. Elle couvre les sous-projets #1 (exécution), #2 (données
multi-tenant) et #3 (provisioning).

Le présent spec couvre la **couche économique et réseau**, soit les sous-projets #4
(onboarding revendeur + crédits) et #5 (white-label), étendus avec un concept nouveau
non prévu dans le socle : un **réseau de distribution à 2 niveaux** où un revendeur
peut avoir ses propres sous-revendeurs et toucher une marge.

### Modèle produit

wg-fux passe de « vente directe à un revendeur » à « réseau de distribution » :

```
admin (Faleryo)
  └── revendeur (niveau 1)          ← achète des crédits à l'admin, apporte SON VPS
        └── sous-revendeur (niveau 2) ← achète des crédits AU revendeur, apporte SON VPS
              └── clients WireGuard
```

**Point business central : le COGS de la plateforme est quasi nul.** En fédération,
chaque acteur (revendeur comme sous-revendeur) apporte et paie son propre VPS. La
plateforme ne vend que des **crédits** et l'orchestration ; elle n'héberge aucun
serveur VPN de revendeur. La marge de l'admin est ~100 % sur le crédit.

### Décisions de cadrage actées

- **Un crédit = un serveur actif pendant un mois.** Modèle d'abonnement (MRR). Un job
  mensuel débite 1 crédit par serveur `online` du portefeuille de son propriétaire.
  *(Alternatives écartées : crédit one-shot par provisioning — pas de récurrence ;
  metering au Go — reporté, voir hors-scope.)*
- **Topologie : fédération.** Chaque niveau apporte son propre VPS. La marge porte
  exclusivement sur la **revente de crédits**, jamais sur de la sous-location de
  capacité. *(Alternative écartée : sous-location de slots sur le VPS du parent — fait
  porter les coûts au parent et casse l'isolation.)*
- **Profondeur de l'arbre : 2 niveaux maximum.** admin → revendeur → sous-revendeur.
  Un sous-revendeur (niveau 2) ne peut pas créer de revendeurs. *(Limite la complexité
  des marges en cascade et le risque de schéma pyramidal.)*
- **La marge émerge d'un écart de prix sur un transfert de crédits**, pas d'un champ
  « marge % ». Chaque compte qui revend fixe son `sellPrice` ; la marge = prix de
  revente − prix d'acquisition. *(Plus simple, auto-cohérent, et entièrement traçable
  via le grand livre.)*
- **Le portefeuille est immuable par construction** : `balance` n'est jamais mutée à la
  main ; toute variation passe par une écriture dans le grand livre (`ledger`) dans une
  transaction. Source de vérité = somme du ledger.

### Dépendance vis-à-vis du socle SSH

**Cette couche est largement découplée du socle SSH.** Le wallet, la hiérarchie et le
white-label peuvent être livrés et testés en **mono-serveur** (avant l'exécution
distante). Seul le débit mensuel par serveur suppose l'existence de la table `servers`
(sous-projet #2). On peut donc livrer la valeur économique et réseau tôt, avec un
risque de sécurité plus faible que le socle SSH.

---

## 2. Architecture

### 2.1 Vue d'ensemble

```
┌──────────────────────────────────────────────────────────────┐
│                        API Node.js                           │
│                                                              │
│  routes/resellers.js ─┐                                      │
│  routes/credits.js  ──┼─► requireResellerScope(req)          │
│  routes/wallet.js   ──┘    (filtre = sous-arbre de req.user) │
│                                                              │
│  services/wallet.js ──► transaction atomique :               │
│        INSERT ledger(+/-)  ⇄  UPDATE wallets.balance         │
│                                                              │
│  jobs.js (mensuel) ──► débit 1 crédit / serveur online       │
│                        solde insuffisant → server.suspended  │
└──────────────────────────────────────────────────────────────┘
            │
            ▼
   db: users(parentId,sellPrice) · wallets · ledger · brands
```

### 2.2 Principes directeurs

- **Zéro rupture rétrocompatible** : l'admin et les rôles `manager`/`viewer` actuels ne
  voient aucune différence. Les nouvelles colonnes/tables sont additives.
- **Le ledger est la vérité comptable** : `wallets.balance` n'est qu'un cache
  dénormalisé, reconstructible par `SELECT SUM(delta) FROM ledger WHERE userId = ?`.
- **Pas de solde négatif** : contrainte applicative + check en transaction. Un débit qui
  passerait sous zéro échoue ; il ne crédite jamais à découvert.
- **Profondeur 2 imposée côté serveur**, jamais seulement côté UI.

---

## 3. Composants et responsabilités

| Composant | Rôle | État |
|---|---|---|
| `db/schema.js` | Tables `wallets`, `ledger`, `brands` ; colonnes `users.parentId`, `users.sellPriceCents` | Modifié (additif) |
| `services/wallet.js` | Crédit/débit/transfert atomiques (ledger + balance en transaction) | Nouveau |
| `services/scope.js` | `descendantIds(userId)` via `WITH RECURSIVE` ; helpers de tenance | Nouveau |
| `middleware/requireResellerScope.js` | Restreint les lectures/écritures au sous-arbre de `req.user` | Nouveau |
| `middleware/auth.js` | Ajout du rôle `reseller` + `requireReseller` | Modifié |
| `routes/wallet.js` | `GET /api/wallet` (solde + relevé), `GET /api/wallet/statement` | Nouveau |
| `routes/credits.js` | `POST /api/credits/topup` (admin), `POST /api/credits/transfer` (revendeur → sous-revendeur) | Nouveau |
| `routes/resellers.js` | CRUD sous-revendeurs scopé, `GET` conso + crédits du sous-arbre | Nouveau |
| `routes/brand.js` | `GET/PUT /api/brand` (white-label du compte) | Nouveau |
| `services/jobs.js` | Job mensuel de débit par serveur actif + suspension | Modifié |
| `services/audit.js` | Trace `topup`, `transfer`, `suspend` (montants + acteurs) | Étendu |

---

## 4. Modèle de données

### 4.1 Modifications de `users`

```js
// users : colonnes ajoutées (ALTER TABLE ADD COLUMN — non-cassant)
parentId: integer('parentId').references(() => users.id, { onDelete: 'set null' }),
//  NULL          = créé par l'admin (revendeur niveau 1, ou rôle historique)
//  = id revendeur = sous-revendeur (niveau 2)
sellPriceCents: integer('sellPriceCents'),  // prix de revente d'1 crédit aux enfants
```

**Sémantique du rôle.** On introduit `reseller` dans `auth.js`. La profondeur se déduit
de `parentId` :

- `role = 'reseller'` **et** `parentId IS NULL` → **revendeur niveau 1** : peut créer des
  sous-revendeurs et leur transférer des crédits.
- `role = 'reseller'` **et** `parentId IS NOT NULL` → **sous-revendeur niveau 2** : ne
  peut **pas** créer de revendeurs (cap de profondeur), gère seulement ses propres
  serveurs/clients.

### 4.2 Nouvelle table `wallets`

```js
const wallets = sqliteTable('wallets', {
  userId: integer('userId').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  balance: integer('balance').notNull().default(0),  // crédits (entiers ≥ 0)
  updatedAt: integer('updatedAt', { mode: 'timestamp' }),
});
```

`balance` est un **cache** ; la vérité est `ledger`. On le maintient en transaction pour
éviter un `SUM()` à chaque lecture.

### 4.3 Nouvelle table `ledger` (grand livre immuable)

```js
const ledger = sqliteTable('ledger', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('userId').notNull().references(() => users.id),
  delta: integer('delta').notNull(),         // > 0 crédit, < 0 débit
  reason: text('reason').notNull(),          // 'topup'|'transfer_in'|'transfer_out'|'monthly'|'refund'
  priceCents: integer('priceCents'),         // prix unitaire appliqué (pour calcul de marge)
  counterpartyId: integer('counterpartyId'), // l'autre partie d'un transfert (NULL pour topup/monthly)
  ref: text('ref'),                          // serverId, paymentId, transferId…
  createdAt: integer('createdAt', { mode: 'timestamp' })
    .default(sql`(cast(strftime('%s','now') as int))`),
}, (t) => ({
  ledgerUserIdx: index('ledger_user_idx').on(t.userId),
}));
```

Un transfert produit **deux lignes** corrélées par `ref` (= transferId) : un
`transfer_out` (delta négatif) chez le parent et un `transfer_in` (delta positif) chez
l'enfant, toutes deux portant `priceCents` = `sellPriceCents` du parent.

### 4.4 Nouvelle table `brands` (white-label)

```js
const brands = sqliteTable('brands', {
  userId: integer('userId').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name'),               // "Acme VPN"
  logoUrl: text('logoUrl'),
  primaryColor: text('primaryColor'),
  customDomain: text('customDomain'),
});
```

Résolution de marque pour un client/sous-revendeur : on remonte au **plus proche
ancêtre** possédant une `brand` (sinon défaut wg-fux).

### 4.5 Matrice de tenance (étend celle du socle)

```
users (revendeur N1, parentId=NULL)
  ├── wallet (1:1)
  ├── servers (1:N)        ← socle SSH
  └── users (sous-revendeurs N2, parentId=N1)
        ├── wallet (1:1)
        └── servers (1:N)
```

- Admin voit tout.
- Revendeur N1 voit **son sous-arbre** (lui + ses sous-revendeurs) et leurs
  serveurs/clients/wallets.
- Sous-revendeur N2 ne voit que **lui-même**.

### 4.6 Migration

Tout est additif : `ALTER TABLE users ADD COLUMN parentId`, `ADD COLUMN sellPriceCents`,
et `CREATE TABLE IF NOT EXISTS` pour `wallets` / `ledger` / `brands` via Drizzle au
démarrage. Les utilisateurs existants ont `parentId = NULL` et pas de wallet (créé à la
volée au premier crédit, balance 0). Aucune table supprimée, aucun champ cassant.

---

## 5. Flux de données

### 5.1 Flux 1 — Top-up (admin crédite un revendeur)

```
[UI admin] POST /api/credits/topup { userId: 42, credits: 100 }
   ▼ requireAdmin
[services/wallet.credit(42, +100, 'topup', priceCents=creditPrice)]
   ▼ TRANSACTION
     INSERT ledger(userId=42, delta=+100, reason='topup', priceCents=…)
     UPDATE wallets SET balance = balance + 100 WHERE userId = 42
   ▼
   auditLog({ actor:'admin', action:'topup', details:{ userId:42, credits:100 } })
```

Phase manuelle : l'admin crédite à la main (après paiement reçu hors plateforme).
L'automatisation Stripe est hors-scope (section 8.4).

### 5.2 Flux 2 — Transfert avec marge (revendeur → sous-revendeur)

```
[UI revendeur N1] POST /api/credits/transfer { toUserId: 77, credits: 10 }
   ▼ requireReseller + requireResellerScope (77 ∈ sous-arbre de N1 ?)
   ▼ contrôle : N1.parentId IS NULL (a le droit de revendre), 77.parentId = N1.id
[services/wallet.transfer(from=N1, to=77, 10, priceCents=N1.sellPriceCents)]
   ▼ TRANSACTION
     ASSERT wallets[N1].balance >= 10           # pas de découvert
     transferId = uuid()
     INSERT ledger(userId=N1, delta=-10, reason='transfer_out', priceCents=150, counterpartyId=77, ref=transferId)
     INSERT ledger(userId=77, delta=+10, reason='transfer_in',  priceCents=150, counterpartyId=N1, ref=transferId)
     UPDATE wallets SET balance=balance-10 WHERE userId=N1
     UPDATE wallets SET balance=balance+10 WHERE userId=77
   ▼
   auditLog({ actor:N1, action:'transfer', details:{ to:77, credits:10, priceCents:150 } })
```

**Marge de N1** sur la période = `Σ(transfer_out.credits × sellPrice) − Σ(coût d'acquisition)`.
Le coût d'acquisition de N1 = ce qu'il a payé à l'admin (lignes `topup`, `priceCents` =
prix plateforme). Les deux jambes sont dans le ledger → un seul `GET /api/wallet/statement`
produit le relevé et la marge.

Le **règlement monétaire réel** (le sous-revendeur paie 1,50 € le crédit à N1) se fait
hors plateforme en Phase manuelle ; le ledger sert de relevé opposable aux deux parties.

### 5.3 Flux 3 — Débit mensuel par serveur actif

```
[jobs.js — déclencheur mensuel (1er du mois, ou rolling 30j par serveur)]
  FOR each server WHERE status = 'online':
    owner = server.ownerId
    IF wallets[owner].balance >= 1:
        wallet.debit(owner, -1, reason='monthly', ref=server.id)   # TRANSACTION
    ELSE:
        server.status = 'suspended'
        auditLog({ action:'suspend', details:{ serverId, reason:'no_credit' } })
        # → clients de ce serveur bloqués (réutilise la logique de ban quota existante)
```

Un serveur `suspended` est réactivé automatiquement au prochain top-up suffisant (ou
manuellement). La logique de blocage des clients réutilise le mécanisme de ban quota/
expiry déjà en place.

### 5.4 Flux 4 — Lecture scopée (revendeur consulte son réseau)

```
[UI revendeur N1] GET /api/resellers
   ▼ requireResellerScope
     ids = descendantIds(N1)      # WITH RECURSIVE, profondeur ≤ 2
     SELECT users, wallets, conso agrégée WHERE userId IN ids
   ▼ renvoie : sous-revendeurs + leur solde + leur conso (serveurs/clients)
```

`descendantIds` :

```sql
WITH RECURSIVE sub(id) AS (
  SELECT :rootId
  UNION ALL
  SELECT u.id FROM users u JOIN sub ON u.parentId = sub.id
)
SELECT id FROM sub;
```

Avec un cap de profondeur 2 la récursion est triviale (≤ 2 niveaux) ; le CTE reste
néanmoins l'implémentation pour rester correct si le cap évoluait.

---

## 6. Sécurité

La plateforme manipule désormais de la **valeur** (crédits convertibles en argent). Les
menaces sont comptables et d'élévation de tenance.

### 6.1 Menaces et contre-mesures

| Menace | Risque | Contre-mesure |
|---|---|---|
| Double-dépense / race sur le solde | Crédit créé ex nihilo | Toute écriture ledger+balance dans **une seule transaction** SQLite ; lecture-modif-écriture atomique |
| Solde négatif (découvert) | Crédits fantômes | Assertion `balance >= montant` **dans** la transaction, échec sinon |
| Transfert hors sous-arbre | Revendeur A crédite l'arbre de B | `requireResellerScope` : la cible doit être dans `descendantIds(req.user.id)` |
| Auto-transfert | Gonfler artificiellement son relevé | `from !== to` imposé |
| Contournement du cap de profondeur | Schéma pyramidal | Création de sous-revendeur refusée si `req.user.parentId !== NULL` |
| Falsification du relevé / marge | Litige financier | `ledger` **append-only** (aucune route UPDATE/DELETE) ; marge recalculée, jamais stockée mutable |
| Désync balance ↔ ledger | Comptes faux | Job de réconciliation : `SUM(delta)` vs `balance`, alerte si écart |
| Suppression d'un parent | Crédits/serveurs orphelins | `parentId ON DELETE SET NULL` (remonte à l'admin) ; wallet conservé ; audit |

### 6.2 Invariants comptables

- `wallets.balance == SELECT SUM(delta) FROM ledger WHERE userId = wallets.userId` à tout
  instant hors transaction.
- Aucune route ne fait `UPDATE`/`DELETE` sur `ledger`. Une correction = une écriture
  compensatoire (`reason='refund'`).
- Tout transfert crée exactement 2 lignes `ledger` de deltas opposés et de même `ref`.

---

## 7. Impact sur l'existant

### 7.1 Fichiers touchés

| Fichier | Nature | Rétrocompatible |
|---|---|---|
| `api-service/db/schema.js` | `users.parentId`, `users.sellPriceCents` ; tables `wallets`/`ledger`/`brands` | Oui (additif) |
| `api-service/src/middleware/auth.js` | Rôle `reseller` + `requireReseller` | Oui |
| `api-service/src/middleware/requireResellerScope.js` | Nouveau | n/a |
| `api-service/src/services/wallet.js` | Nouveau (crédit/débit/transfert transactionnels) | n/a |
| `api-service/src/services/scope.js` | Nouveau (`descendantIds`) | n/a |
| `api-service/src/routes/wallet.js` · `credits.js` · `resellers.js` · `brand.js` | Nouvelles routes | n/a |
| `api-service/src/services/jobs.js` | Job mensuel de débit + suspension | Oui (ajout de tâche) |
| `api-service/src/services/audit.js` | Actions `topup`/`transfer`/`suspend` | Oui |
| `dashboard-ui/src/components/layout/NavItems.jsx` | Transformer l'onglet ciblé en « Reseller / Network » | Oui |
| UI : nouvel écran réseau (sous-revendeurs, solde, transfert, relevé, branding) | Nouveau | n/a |

### 7.2 Invariants préservés

- `admin` / `manager` / `viewer` se comportent exactement comme avant ; aucun n'a de
  `parentId`, de wallet imposé, ni de scope revendeur.
- Les routes existantes (`/api/clients`, `/api/users`…) ne changent pas pour l'admin.
- Le rôle `reseller` peut, en transition, réutiliser le comportement `viewer` côté
  permissions générales (cohérent avec la note du socle, section 9).

---

## 8. Tests, rollout et hors-scope

### 8.1 Stratégie de test

| Couche | Outil | Cible |
|---|---|---|
| Unitaire | Vitest | `wallet.transfer` atomicité & anti-découvert ; `descendantIds` ; cap profondeur |
| Intégration | Vitest | route transfer → 2 lignes ledger + balances cohérentes ; 403 hors sous-arbre |
| Propriété | Vitest | invariant `balance == SUM(delta)` sur séquences aléatoires de crédit/débit/transfert |
| E2E | Playwright | admin top-up → revendeur transfère → sous-revendeur voit son solde |

Tests critiques en premier :
1. Transfert concurrent (2 requêtes simultanées) ne crée jamais de découvert.
2. `transfer` vers un user hors sous-arbre → 403, aucune écriture.
3. Sous-revendeur (parentId ≠ NULL) tentant de créer un revendeur → 403.
4. Débit mensuel : serveur passe `suspended` quand le solde tombe à 0, clients bloqués.
5. Réconciliation : `balance` reconstruit depuis `ledger` après N opérations.

### 8.2 Plan de rollout

**Phase A — Wallet & ledger (mono-serveur, sans réseau)**
- Tables `wallets`/`ledger`, `services/wallet.js`, top-up admin manuel, relevé.
- Découplé du socle SSH : livrable et testable seul.

**Phase B — Hiérarchie & scope**
- Rôle `reseller`, `users.parentId`, `requireResellerScope`, `descendantIds`.
- Routes `resellers.js` (CRUD scopé), vues conso/solde du sous-arbre.

**Phase C — Marge**
- `sellPriceCents`, `POST /api/credits/transfer`, relevé de marge.

**Phase D — Débit récurrent**
- Job mensuel (dépend de la table `servers` du socle SSH #2), suspension/réactivation.

**Phase E — White-label**
- Table `brands`, résolution par ancêtre, UI branding, (custom domain plus tard).

### 8.3 Critères de succès

- Une installation existante (admin seul) se comporte à l'identique après migration.
- `balance == SUM(delta)` vérifié par le job de réconciliation sur données réelles.
- Un revendeur N1 transfère 10 crédits à son sous-revendeur N2 ; les deux relevés
  concordent et la marge de N1 est calculée correctement.
- Un serveur sans crédit passe `suspended` au débit mensuel et ses clients sont bloqués.
- Aucune route ne permet de muter/supprimer une ligne de `ledger`.

### 8.4 Explicitement hors-scope

- **Billing externe (Stripe)** : top-up et règlement des marges restent manuels en
  Phase A–E ; l'intégration paiement + payout automatique des marges est un spec ultérieur.
- **Metering au Go / par client actif** : le crédit reste « serveur·mois ». Le metering
  réutilisera les snapshots `jobs.js` quand décidé.
- **Profondeur > 2 niveaux**.
- **Sous-location de capacité** (slots sur le VPS d'un parent) — écartée par cadrage.
- **Le socle d'exécution SSH lui-même** — couvert par la
  [spec du 2026-06-27](2026-06-27-reseller-ssh-execution-socle-design.md).
- **KYC / conformité financière** des revendeurs.

---

## 9. Décisions reportées au plan d'implémentation

- **Périodicité exacte du débit** : 1er du mois civil pour tous, ou *rolling* 30 jours
  par serveur (date d'activation). Le rolling lisse la charge mais complique le relevé.
- **Création du wallet** : à la création de l'utilisateur, ou paresseusement au premier
  crédit (balance 0 implicite). Reco : paresseuse, pour rester additif.
- **Unité de prix** : `priceCents` en devise unique (EUR) en Phase A ; multidevise reporté.
- **Réactivation d'un serveur `suspended`** : automatique au top-up suffisant, ou action
  explicite du revendeur. À trancher selon UX souhaitée.
- **Sémantique fine des permissions `reseller`** vs `viewer` (cohérence avec la note du
  socle, section 9 de la spec 2026-06-27).

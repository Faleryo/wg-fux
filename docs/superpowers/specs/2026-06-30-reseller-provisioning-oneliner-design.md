# Design : Provisioning par one-liner durci (mode Revendeur)

- **Date** : 2026-06-30
- **Auteur** : Faleryo (avec accompagnement design)
- **Statut** : Proposé — socle scripts VPS écrit, endpoints API à implémenter
- **Portée** : Sous-projet #3 (provisioning), variante one-liner `curl | bash` durcie.
  S'appuie sur le [socle SSH](2026-06-27-reseller-ssh-execution-socle-design.md) (#1).

---

## 1. Objectif

Permettre à un revendeur d'enrôler son VPS en **collant une seule commande**, sans
mot de passe, sans copier-coller de clé. Le VPS se configure lui-même et s'enregistre ;
la plateforme **prouve** la confiance en se reconnectant en SSH avec la clé qu'elle a
générée.

## 2. Principe de sécurité fondateur

> **Le callback n'est jamais cru sur parole.** Le statut `online` n'est atteint que
> lorsque la plateforme ouvre elle-même un SSH vers le VPS avec sa clé privée et que
> la host key vue correspond à celle annoncée. La confiance se gagne, ne se déclare pas.

## 3. Artefacts côté VPS (écrits — `core-vpn/scripts/`)

| Fichier | Rôle | Privilège |
|---|---|---|
| `wg-fux-bootstrap.sh` | Servi/templaté par l'API ; crée l'user, installe scripts+clé+sudoers, callback | root (one-shot, idempotent) |
| `wg-fux-dispatch.sh` | Forced command de la clé SSH ; parse + valide + élève | user `wg-fux` |
| `wg-fux-exec.sh` | Entrypoint sudo ; **re-valide** allowlist+args, exécute le wg-*.sh | root |

Cantonnement de la clé installée (`authorized_keys`) :
```
restrict,from="<IP_PLATEFORME>",command="/usr/local/bin/wg-fux-dispatch.sh" <pubkey>
```
sudoers (zéro wildcard) :
```
wg-fux ALL=(root) NOPASSWD: /usr/local/bin/wg-fux-exec.sh
```

## 4. La commande one-liner (affichée dans l'UI)

```bash
WG_T=<token>; WG_H=<sha256-script>; \
S=$(curl --proto '=https' --tlsv1.3 --pinnedpubkey 'sha256//<TLS_PUBKEY>' \
        -fsSL "https://vpn-labs.ink/provision/$WG_T/script") && \
printf '%s' "$S" | sha256sum -c <(echo "$WG_H  -") && WG_T=$WG_T bash -c "$S"
```
Défenses : `=https` (anti-downgrade), `--tlsv1.3`, `--pinnedpubkey` (anti-MITM même
CA véreuse), vérif sha256 du script via canal pinné (anti-altération), pas de pipe
(anti-script-tronqué), token en env (pas dans `ps aux`).

## 5. Protocole d'invocation des commandes distantes (SshExecutor → VPS)

`SSH_ORIGINAL_COMMAND` envoyé par l'exécuteur :
```
wg-fux <base64url(JSON: ["wg-create-client.sh","container","client",...])>
```
base64+JSON ⇒ aucune interprétation shell des arguments ⇒ injection impossible.
stdin (contenu fichier) traverse nativement.

## 6. Contrat des endpoints API (à implémenter)

### 6.1 `POST /api/servers` (revendeur authentifié)
Crée `servers(status='pending')`, génère la paire ed25519 (privée chiffrée AES-GCM),
mint un token (256 bits, **haché** en base, TTL 10 min, usage unique), calcule le
sha256 du script rendu. Réponse : `{ serverId, oneLiner, scriptSha256, expiresAt }`.

### 6.2 `GET /provision/:token/script` (public, non authentifié)
Valide le token (constant-time, non loggé). Rend `wg-fux-bootstrap.sh` en substituant
`{{WG_FUX_PUBKEY}}`, `{{PLATFORM_BASE}}`, `{{PLATFORM_IP}}`, `{{SCRIPTS_TARBALL_URL}}`,
`{{SCRIPTS_SHA256}}`, `{{TLS_PINNED_PUBKEY}}`, `{{SCRIPTS_VERSION}}`. `Content-Type:
text/x-shellscript`. Réponse de forme constante (pas de fuite par timing).

### 6.3 `GET /provision/scripts.tgz` (public)
Tarball des `wg-*.sh` + `wg-fux-dispatch.sh` + `wg-fux-exec.sh`. sha256 = celui
injecté à l'étape 6.2. Servi avec cache long (immuable par version).

### 6.4 `POST /provision/:token/ready` (callback, Bearer = token)
Body `{ hostKey, hostname, scriptsVersion }`. **Ne passe PAS le serveur online.**
Stocke `hostKey` (candidate), passe `status='provisioning'`, déclenche la vérif §7.

## 7. Vérification (source de vérité)

```
declenchée par le callback ready :
  1. SSH vers server.host avec la clé privée déchiffrée
  2. host key observée == hostKey du callback ?   sinon → status='error' (MITM ?)
  3. exec test (wg-fux <b64 de ['wg-health.sh']]) → success ?
  4. OK → pin host key, status='online', token consommé (usage unique)
  5. UI : "Un serveur a répondu depuis X.X.X.X — c'est le vôtre ?" (confirme l'IP)
```

## 8. Mises à jour des scripts (bonus)

Le bootstrap étant idempotent et versionné, la plateforme relance la section
install/update via SSH quand `scriptsVersion` du VPS est obsolète (détecté au
heartbeat). Un seul mécanisme = provisioning initial + updates.

## 9. Hors-scope

- Bootstrap par mot de passe root (option « installation assistée » ultérieure).
- OS non-apt (RHEL/Alpine) — détecté et refusé proprement pour l'instant.
- Crédits / billing (spec du 2026-06-29), réseau 2 niveaux, config port/endpoint
  per-serveur.

## 10. Tests critiques

1. Script rendu : tous les `{{...}}` substitués, sha256 == one-liner.
2. Token : usage unique (2ᵉ callback refusé), TTL expiré refusé, non loggé.
3. `wg-fux-dispatch` : script hors allowlist → exit 126 ; arg non-SAFE → refus ;
   tentative de shell (`bash`, `;`, `&&`) → refus.
4. `wg-fux-exec` re-valide même si appelé directement (bypass dispatcher).
5. Vérif §7 : host key divergente → `error`, jamais `online`.
6. E2E réel sur 1 VPS jetable : one-liner → online → création client distant.

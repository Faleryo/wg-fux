# wg-fux

Panneau d'administration WireGuard pour une équipe / un usage perso.

Gère un (ou plusieurs) serveurs WireGuard via une UI web : création de clients,
quotas, expiry, statistiques temps réel, DNS filtré (AdGuard Home), audit log,
backups chiffrés.

## Stack

| Composant | Rôle |
|---|---|
| `api-service/` | API Node.js / Express + SQLite (Drizzle ORM) + WebSocket |
| `dashboard-ui/` | UI React 18 / Vite 6 |
| `core-vpn/scripts/` | Scripts shell qui pilotent `wg` / `wg-quick` |
| `infra/nginx/` | Reverse proxy + TLS termination |
| `infra/dns/` | AdGuard Home (DNS résolveur pour les peers) |
| `core-vpn/scripts/sentinel.sh` | Watchdog : redémarre les containers cassés |

## Fonctionnalités

- **Clients** : création / suppression / déplacement entre containers, génération
  de config + QR code, expiry & quota par client, ban/unban auto via
  `wg-enforcer.sh`
- **Auth** : login + JWT, TOTP 2FA, RBAC (admin / manager / viewer), audit log
- **Monitoring** : stats temps réel (rx/tx, handshake) en WebSocket, métriques
  Prometheus, dashboard santé
- **DNS** : AdGuard Home intégré, filtering / safesearch / parental
- **Backups** : `wg-backup.sh` chiffré AES-256 (passphrase via
  `BACKUP_PASSPHRASE`), `wg-restore.sh` validé contre les archives malveillantes
- **Tickets** : système support basique
- **Self-healing** : sentinel watchdog avec back-off, `vibe-check.sh` qui diffe
  DB ↔ filesystem ↔ kernel

## Installation

```bash
git clone <repo>
cd wg-fux
cp api-service/.env.example api-service/.env
# Remplir .env (JWT_SECRET, SENTINEL_TOKEN, AGH_PASSWORD, BACKUP_PASSPHRASE, ...)
./setup.sh --install
```

Prérequis hôte : Docker, Docker Compose, modules kernel WireGuard.

## Configuration

Toutes les valeurs sensibles passent par `.env` (jamais commité). Voir
[`api-service/.env.example`](api-service/.env.example) pour l'ensemble des
variables et leur rôle.

Variables critiques :

- `JWT_SECRET` — `openssl rand -hex 64`
- `SENTINEL_TOKEN` — `openssl rand -hex 32`
- `ADMIN_PASSWORD_HASH` / `ADMIN_PASSWORD_SALT` — générés par `setup.sh`
- `AGH_PASSWORD` — min 8 caractères
- `BACKUP_PASSPHRASE` — `openssl rand -base64 32`
- `ALLOWED_ORIGINS` — domaine(s) du frontend en production

## Backup / Restore

```bash
# Backup chiffré
BACKUP_PASSPHRASE='...' core-vpn/scripts/wg-backup.sh

# Restore depuis archive .tar.gz.enc
BACKUP_PASSPHRASE='...' core-vpn/scripts/wg-restore.sh /app/backups/wg_fux_backup_*.tar.gz.enc
```

## Tests

```bash
cd api-service && npm test
cd dashboard-ui && npx playwright test
```

## Licence

MIT.

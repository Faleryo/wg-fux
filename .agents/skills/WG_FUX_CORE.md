# 🌌 WG_FUX_CORE : Project Master Skill

## 🎯 Mission
Orchestrer et maintenir le système de gestion VPN `WG-FUX` avec une fiabilité de grade **Obsidian** (Zéro régression, Performance optimale, Sécurité maximale).

## ⚓ Bounded Contexts

### 1. VPN Management (WireGuard)
- **Path** : `/etc/wireguard/`, `core-vpn/scripts/`.
- **Règles** :
    - Toute modification de `wg0.conf` doit être validée par `wg-quick check` (si disponible) ou audit des clés.
    - Les scripts `post-up`/`post-down` ne doivent jamais être modifiés sans test d'idempotence.
    - Utiliser `SERVER_PORT` de l'environnement pour éviter les hardcodes.

### 2. Dashboard UI (React/Vite)
- **Path** : `dashboard-ui/`.
- **Esthétique** : Premium "Glassmorphism" avec interactions `Framer Motion`.
- **Règle d'Or** : Toujours utiliser le standard Nginx Docker pour servir le build (pas de `serve` dev en production).

### 3. API & Data (Node.js/SQLite)
- **Path** : `api-service/`.
- **Intégrité** : Drizzle ORM pour les migrations. Jamais de manipulation directe de la DB en dehors des scripts.
- **Sécurité** : `express-rate-limit` et `helmet` obligatoires sur tous les endpoints critiques.

## 🛠️ Commandes Capitalisées (Voyager Skills)
- **Build Clean** : `docker compose up -d --build --force-recreate`
- **Inspect Logs** : `docker compose logs -f --tail 100`
- **Audit Proactif** : `bash .vibe/tools/vibe-audit-v6.5.sh`

## 🛡️ SRE Standards
- **Healthchecks** : Chaque service possède une route `/health`.
- **Limits** : Blast radius strict de 512MB pour l'API et 1GB pour l'UI.

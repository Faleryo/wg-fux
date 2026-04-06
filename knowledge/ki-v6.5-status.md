# 📚 KI : État de l'Infrastructure WG-FUX (v6.5 Transition)

**Status** : OBSIDIAN (Operational)
**Date** : 2026-04-05

## 1. Stack Technique Distillée
- **API** : Node.js 20 (Express) + Drizzle ORM + SQLite (better-sqlite3).
- **Dashboard** : React 18 + Vite + TailwindCSS + Framer Motion.
- **Proxy/Ingress** : Nginx Alpine (Custom Config).
- **DNS/Security** : AdGuard Home (Internal 172.20.0.100).
- **SSL** : Let's Encrypt (Certbot) avec renouvellement automatique toutes les 12h.
- **VPN** : WireGuard (Interface `wg0`, Subnet `10.0.0.0/24`).

## 2. Preuve Mathématique (Guardian v6.5)
L'audit unifié `vibe-guardian.sh` a été exécuté le 2026-04-06 avec un **Exit Code 0**. 
### Blast Radius & Security :
- `wg-fux-api` : Limite CPU=1.0, MEM=512M (Verify: OK).
- `wg-fux-dashboard` : Limite CPU=1.0, MEM=1024M (Verify: OK).
- `Nginx Security` : Headers Obsidian + Whitelist VPN /dns/ Enforcement (Applied).

## 3. Points de Vigilance (Lessons Learned)
- **Shadow Code** : La synchronisation est désormais vérifiée par MD5 automatiqueme au démarrage du Guardian.
- **Privileged Access** : Toujours en usage via `cap_add` (NET_ADMIN) pour WireGuard.

## 4. Prochaines Étapes
- Automatisation du Guardian via cron (optionnel).
- Monitoring passif des sessions VPN actives via Sentinel.

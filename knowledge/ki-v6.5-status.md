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

## 2. Preuve Mathématique (Audit v6.5)
L'audit exécuté le 2026-04-05 a retourné un **Exit Code 0**. 
### Blast Radius Enforced :
- `wg-fux-api` : Limite CPU=1.0, MEM=512M.
- `wg-fux-dashboard` : Limite CPU=1.0, MEM=1024M.
- `wg-fux-dns` : Limite CPU=0.25, MEM=256M.

## 3. Points de Vigilance (Lessons Learned)
- **Shadow Code** : La désynchronisation entre les scripts sur l'hôte (`core-vpn/scripts/`) et ceux dans le conteneur `api` est un risque majeur. Toujours privilégier `docker compose up -d --build api` après modification des scripts.
- **Privileged Access** : L'image API utilise `cap_add: [NET_ADMIN, SYS_MODULE, NET_RAW]` au lieu de `--privileged` pour minimiser la surface d'attaque.

## 4. Prochaines Étapes
- Consolidation de l'outillage de validation proactive.
- Mise à jour des workflows de maintenance vers le grade Obsidian.

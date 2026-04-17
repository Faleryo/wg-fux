# 📚 KI : État de l'Infrastructure WG-FUX (v6.5-Obsidian+)

**Status** : OBSIDIAN PLUS (Operational & Self-Healing)
**Date** : 2026-04-06

## 1. Stack Technique Distillée
- **API** : Node.js 20 (Express) + Drizzle ORM + SQLite (WAL mode).
- **Dashboard** : React 18 + Vite v6 (Stable) + TailwindCSS.
- **Proxy/Ingress** : Nginx Alpine (Resilient Upstream).
- **DNS/Security** : AdGuard Home (Internal 172.20.0.100).
- **SSL** : Certbot (Resilient Healthcheck) auto-renew 12h.
- **VPN** : WireGuard (Interface `wg0`, Subnet `10.0.0.0/24`, `fd00::/64`).

## 2. Preuve Mathématique (Guardian v6.5)
Audit SRE unifié exécuté le 2026-04-06 (Grade Obsidian Plus).
### Autonomic Healing (Sentinel) :
- **Watchdog** : Actif via [sentinel.sh](file:///home/faleryo/wg-fux/core-vpn/scripts/sentinel.sh).
- **Auto-Restart** : Opérationnel pour `nginx`, `ui`, `api`, `dns`, `certbot`.
- **Telemetry** : Heartbeat vers le dashboard (Stats CPU/RAM/Disk).

## 3. Points de Vigilance (Lessons Learned)
- **Shadow Code** : La synchronisation est désormais vérifiée par build forcé lors de l'Update (`setup.sh --update`).
- **Certbot Health** : Healthcheck ajusté pour tolérer l'absence de domaine initial (Bootstrap mode).

## 4. Prochaines Étapes
- [x] Monitoring des sessions VPN (Via Sentinel Heartbeat).
- [ ] Injection dynamique des logs kernel WG dans le Dashboard.
- [ ] Hardening des règles Iptables post-installation.

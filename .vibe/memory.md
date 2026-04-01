# 🧠 Vibe-OS Memory Vault - Project: WG-FUX

## 🛡️ Strategic Upgrade (2026-04-01)
- **DECISION** : Migration vers **Vibe-OS v3.0 (Platinum Hardening)**.
- **MOTIVATION** : Suite à des régressions UI (SVG) et infra (SSL/502), intégration de 4 briques de sécurité (DOM, SRE, Z-Layer, Bootstrap).
- **ACTION** : Mise à jour de `SKILL.md` et `.gemini-instructions.md`.
- **TODO** : Appliquer systématiquement le `SRE-SMOKE-TEST` sur les prochaines tâches.

## [CONTEXT]
- **Project Name**: WG-FUX
- **Objective**: Advanced WireGuard VPN Management System.
- **Protocol**: Vibe-OS Platinum v3.0
- **Status**: Production-Grade Stabilization.

## [DECISIONS]
- **Infrastructure**: Docker Compose with Nginx reverse proxy.
- **Database**: SQLite with Drizzle ORM.
- **UI**: Liquid Glass Design (Framer Motion + Tailwind).
- **Hardening**: Automatic SSL generation and .env recovery implemented.

## [KNOWLEDGE]
- **API Port**: 3000 (Internal), exposed via 443 (Nginx).
- **WireGuard Port**: 51820 (UDP).
- **JWT Secret**: `vibe-platinum-hard-9x` (Current).
- **Paths**: Scripts in `api-service/scripts`, Config in `/etc/wireguard`.

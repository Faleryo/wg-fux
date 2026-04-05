# 🌌 PROJECT_SKILL : WG-FUX (Sentinelle Phase)

Documentation stratégique globale de la plateforme de gestion WireGuard **WG-FUX** (v2.1).

## 🎯 VISION [TECH + BUSINESS]
- **Objectif Tech** : Passer d'un monolithe API à une architecture modulaire, résiliente et hautement performante (Sentinel Mode).
- **Objectif Business** : Offrir la suite de gestion VPN la plus robuste du marché avec une interface Premium (Liquid Glass).

## 🏗️ STACK TECHNIQUE (Hardened)
- **CORE** : WireGuard, `iproute2`, `iptables`, `tc` (QoS).
- **API (Modular)** : Node.js (Express), Drizzle ORM (Better-SQLite3), Zod.
- **DASHBOARD** : Next.js 15+, Tailwind CSS 4.x, Framer Motion, Shadcn UI.
- **INFRA** : Docker-native (NET_ADMIN), Nginx (Reverse Proxy with SSL).

## 🌊 VIBES (DÉCOUPAGE ATOMIQUE)
1. **Modularisation API** : Isolation des routes et services pour une clarté absolue du code.
2. **Durcissement Infra** : Configuration systématique des `sysctls` et `cap_add` pour une performance réseau native.
3. **Design Liquid Glass** : Interface responsive, transitions fluides et mode sombre profond.

## ✅ CRITÈRE DE SUCCÈS (PLATINUM)
- **Règles Sentinel** : Adhérence stricte aux 4 commandements (Vérification Continue, Missions Atomiques, Ghost Scan, Planification Phasée).
- **Preuve Shell** : Build `dist` sans erreurs, syntaxe API vérifiée (`node --check`), et latence réseau optimisée (WAL mode).

---
*Mise à jour par Vibe-OS - 2026-03-31*

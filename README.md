# 💎 WG-FUX : Plateforme WireGuard Platinum

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Status](https://img.shields.io/badge/status-platinum-gold.svg)
![Protocol](https://img.shields.io/badge/engine-Vibe--OS-cyan.svg)

**WG-FUX** est une plateforme de gestion **Next-Gen** pour serveurs WireGuard. Conçue pour la résilience, la sécurité et la performance (Standard Vibe-OS Platinum).

## 🚀 Pourquoi WG-FUX ?

- **Architecture Modulaire** : Isolation des services (Auth, Clients, Logs, Tickets, Users).
- **Sentinel Watchdog** : Un gardien autonome surveillant la santé des tâches de fond.
- **Hyper-Performance** : SQLite en mode **WAL (Write-Ahead Logging)** pour une concurrence fluide.
- **Sécurité Platinum** : PBKDF2 (600k itérations), Headers de sécurité renforcés, JWT & RBAC durcis.
- **Interface Liquid Glass** : Dashboards modernes, réactifs et intuitifs.

---

## 🛠️ Installation Rapide

```bash
git clone https://github.com/votre-user/wg-fux.git
cd wg-fux
cp api-service/.env.example api-service/.env
./setup.sh --install
```

---

## 🏗️ Architecture

| Composant | Technologie | Rôle |
| :--- | :--- | :--- |
| **API Core** | 🧩 Node.js / Express | Moteur de gestion modulaire |
| **Persistance** | 🗄️ SQLite (WAL) + Drizzle ORM | Base de données Platinum |
| **Dashboard** | ⚡ React 18 + Vite 6 | UI Premium (Liquid Glass, feature-based) |
| **DNS** | 🔒 AdGuard Home | Résolution DNS interne pour clients VPN |
| **Proxy** | 🛡️ Nginx | Reverse-proxy sécurisé (TLS termination) |

---

## 🔐 Sécurité & Confidentialité

Ce dépôt est conçu pour être **Zéro-Secret**. Tous les paramètres sensibles (`JWT_SECRET`, passwords, keys) sont gérés via des fichiers `.env` exclus du contrôle de version.

---

> [!NOTE]
> Cette plateforme est certifiée **Platinum Tier** par le protocole **Vibe-OS**.

> [!CAUTION]
> **Production** : Assurez-vous que l'hôte dispose des modules kernel WireGuard installés avant de lancer le conteneur `api` en mode `privileged`.

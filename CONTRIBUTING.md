# 💠 Guide de Contribution : WG-FUX

Bienvenue dans le projet **WG-FUX**. Ce dépôt suit les standards de développement **Platinum** du protocole **Vibe-OS**.

## 🛠️ Principes Fondamentaux

1.  **Modularité** : Toute nouvelle fonctionnalité doit être isolée dans un service (`/services`) et exposée via une route (`/routes`).
2.  **Sécurité par Défaut** : Toute entrée utilisateur doit être validée (via Zod/Schema).
3.  **Performances SQLite** : Respectez le mode **WAL** et utilisez des index pour les requêtes de logs.
4.  **Sentinel Readiness** : Chaque nouvelle tâche de fond doit être traquée par le **Watchdog** intégré.

## 🚀 Flux de Travail

- **Formatage** : Utilisez `Prettier` ou un linter conforme au standard Node.js.
- **Vérification** : Lancez toujours `node --check <file>` avant de proposer un changement.
- **Commits** : Nous suivons les **Conventional Commits** (ex: `feat:`, `fix:`, `docs:`, `chore:`).

---

> [!TIP]
> **Vibe-OS Insight** : La clarté du code est le reflet de la clarté de l'architecture. Tout changement complexifiant inutilement la base de code sera rejeté.

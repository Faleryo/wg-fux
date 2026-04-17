# KI — Session Delta State (2026-04-03)

## [CONTEXT] — État du Système WG-FUX

### Infrastructure (Obsidian Grade ✅)
- **API** : `wg-fux-api` — Healthy, Port 3000
- **UI** : `wg-fux-dashboard` — Healthy
- **DNS** : `wg-fux-dns` (AdGuard) — Healthy
- **Proxy** : `wg-sentinel-proxy` (Nginx TLS) — Healthy
- **Interface WireGuard** : `wg0` UP/LOWER_UP — Auto-réparé par le SRE Watchdog

### Sécurité (Immunité Platinum ✅)
- **Auth Bypass** : FERMÉ — Sentinel Token sans valeur par défaut (Fail-Closed)
- **Injection Shell** : FERMÉ — Validation Zod + regex `/^[a-zA-Z0-9\s.,-]+$/` sur le champ DNS
- **TimingSafe** : FERMÉ — `timingSafeEqual` protégé par vérification de longueur de buffer
- **Supply Chain** : FERMÉ — `npm audit` = 0 vulnérabilités

### Architecture Front-End (Diamond Grade ✅)
- **App.jsx** : 20 lignes — Routeur pur (Auth ↔ Dashboard)
- **features/auth** : `useAuth.js`, `LoginPage.jsx`, `index.js`
- **features/dashboard** : `useDashboardData.js` (polling + cache + WS)
- **components/layout** : `MainLayout.jsx` (shell UI + modals + handlers)

## [DECISIONS] — Règles Architecturales

1. **Feature-First** : Toute nouvelle section métier doit créer son propre dossier dans `src/features/`.
2. **useDashboardData est la source de vérité** : Aucun composant enfant ne doit faire de fetch direct. Tout passe par ce hook.
3. **Helpers privilégiés pour `/etc/wireguard/`** : Toujours utiliser `writeFileAsRoot`, `unlinkAsRoot` de `shell.js`. Jamais d'accès root direct.
4. **SRE Watchdog actif** : Le watchdog `interfaceWatchdog()` pulse toutes les 30s dans `jobs.js` et notifie via `wg-send-msg.sh`.

## [TODO] — Prochaines Pistes (MCTS)

### Chemin A : Performance Front-End
- Code-splitting Vite (`import()` dynamique) pour réduire le bundle de 971KB
- Lazy loading des sections non-critiques (Logs, Audit, Settings)

### Chemin B : Observabilité SRE
- Création d'un script `.vibe/tools/lint-diff.sh` (audit des fichiers modifiés)
- Création d'un `ki-ops-runbook.md` pour les procédures d'urgence

### Chemin C : Red Teaming Avancé
- Test de Race Condition sur la création de clients concurrents
- Scan de Path Traversal sur les endpoints `/api/clients/:container/:name`

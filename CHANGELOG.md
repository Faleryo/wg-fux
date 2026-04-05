# 📋 CHANGELOG: WG-FUX Evolution

## v3.5-Titanium (2026-03-31)
**Evolution "Titanium" & "Resilient UI"**

### 🚀 WebSocket & Temps Réel
- **useWebSocket Hook**: Implemented a resilient React hook with **Exponential Backoff Strategy** (1s, 2s, 4s, 8s...).
- **Live Logs (Streaming)**: Migrated `LogsSection.jsx` from polling to real-time WebSocket streaming from journalctl.
- **Global Status Sync**: Added automatic status synchronization and client event toasts via WebSockets in `App.jsx`.

### 🛡️ Security & SRE
- **Sentinel Hardening**: Added Telegram alert rate-limiting (10m cooldown) to avoid notification spam.
- **Docker Security**: Removed default `JWT_SECRET` from Dockerfile to enforce secure environment injection.
- **Auto-Swap (5GB)**: Automated swap creation in `setup.sh` for low-RAM (512MB) VPS.
- **Robust IPv4**: Implemented multi-service public IP detection with local fallback.

### ⚡ Performance & Build
- **SQLite WAL mode**: Explicitly enabled WAL (Write-Ahead Logging) for high-performance concurrent db access.
- **Build Fix**: Stabilized UI build by downgrading Vite to v6 (Stable) and resolving Rolldown issues.

---
 v3.1-Platinum (2026-03-31)
**Evolution "Sentinel" & "Platinum"**

### 🛡️ Security & SRE
- **Sentinel Watchdog**: Added a standalone SRE watchdog (`sentinel.sh`) for Auto-Heal and monitoring.
- **Telegram Alerts**: Integrated Telegram Bot API for real-time failure and restoration alerts.
- **Docker Healthchecks**: Added `healthcheck` directives in `docker-compose.yml` for all services.
- **NPM Hardening**: Performed `npm audit fix --force` to resolve `esbuild` vulnerabilities.

### 🐚 Core Improvements
- **Setup Script**: Enhanced `setup.sh` with dependency auto-installation, git upgrade, and sentinel configuration.
- **Shell Hardening**: Applied ShellCheck fixes to all core scripts (quoting, `read -r`).
- **Health API**: Enriched `/api/system/health` with RAM and Disk metrics.

### 🧹 Maintenance
- Removed development logs (`console.log`) from the API production service.
- Unified technical documentation (API_SPEC, README).

---
*Architecte : Vibe-OS*

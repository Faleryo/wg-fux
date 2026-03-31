# 📋 CHANGELOG: WG-FUX Evolution

## v3.1-Platinum (2026-03-31)
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

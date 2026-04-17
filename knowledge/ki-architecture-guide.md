# KI-ARCHITECTURE: WG-FUX v6.3 "The Watcher's Eye"

Distillation level: **Obsidian** (Universal Source of Truth)

## 🏗️ 1. Project Topology
The system is divided into three distinct layers following the "Separation of Concerns" principle.

### A. API Service (`api-service/`)
- **Runtime**: Node.js / Express.
- **ORM**: Drizzle ORM (SQLite backend via `better-sqlite3`).
- **Role**: Orchestration, Authentication (JWT + 2FA), Ticketing, and Audit logging.
- **Critical File**: `src/services/scripts.js` — The bridge to the Shell layer.

### B. VPN Core (`core-vpn/`)
- **Runtime**: Bash 5.0+.
- **Role**: Direct interface with the Linux kernel (`wireguard`, `iptables`, `tc`).
- **Persistence**: Configuration files stored in `/etc/wireguard/` and metadata in `/etc/wireguard/clients/`.
- **Security**: Hardened via `wg-harden.sh` and monitored by `sentinel.sh`.

### C. Dashboard UI (`dashboard-ui/`)
- **Stack**: React / Vite / Tailwind CSS / Framer Motion.
- **Auth**: Bearer Token (JWT) management via Axios interceptors.

## 🔄 2. Communication Protocols
### API <-> Shell Bridge
- The API *never* executes commands directly via `child_process.exec` with string concatenation.
- All interactions go through `src/services/shell.js` (Argument Array isolation) and `src/services/scripts.js`.
- Scripts output JSON when the `--json` flag is passed (Pattern: `executeScript('script-name', args, { json: true })`).

### SRE Structured Logging
- **Format**: JSON-on-one-line (logfmt compatible).
- **Service Tags**: `http`, `auth`, `audit`, `system`, `vpn`.
- **Levels**: DEBUG, INFO, WARN, ERROR, AUDIT.

## 🛡️ 3. Security & Vibe-OS v6.3 Primitives
### HITL Escalation Matrix
- **Level 4 (High)** and **Level 5 (Fatal)** operations REQUIRE human confirmation before the Agentic ACT phase.
- Defined in `knowledge/escalation_matrix.md`.

### Mental Garbage Collection (GC)
- Routine purging of `auditLogs` and system `logs` tables (Default: 30 days retention).
- Triggered via `src/services/audit.js:gcAuditLogs()`.

### Supply Chain Audit
- Mandatory dependency checks via `.vibe/tools/check-supply-chain.sh`.

## 🛠️ 4. Tooling & Verification
- **Verification Gate**: `scripts/verify-task.sh` (Must return Exit Code 0).
- **Red Teaming**: `scripts/evil-pioneer.sh` (Simulated offensive validation).
- **Toolbox**: All standardized agentic tools reside in `.vibe/tools/`.

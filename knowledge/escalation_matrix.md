# ESCALATION-MATRIX: WG-FUX v6.3 "The Watcher's Eye"

Formal definition of the **Human-in-the-loop (HITL)** protocol for agentic operations.

## Level 1-2: Low Risk (Unrestricted)
- Read operations (Logs, Configs, DB select).
- Style/UI modifications (CSS, HTML, React Components).
- Isolated logic (Unit Tests, Helper functions).
- **Automation**: Fully Autonomous.

## Level 3: Moderate Risk (Implicit)
- Writing to configuration files (`.env.example`).
- Modifying non-critical API routes (e.g., tickets, users).
- **Automation**: Autonomous with Terminal-Trace logging.

## Level 4: High Risk (MANDATORY HITL)
- **Networking**: `iptables`, `nftables`, `wg-quick` control.
- **Security**: Authentication flow changes, JWT logic.
- **Deployment**: `docker-compose` restart, Container deletion.
- **Automation**: STOP. Request explicit binary confirmation from the USER before execution (`ACT`).

## Level 5: Fatal Risk (EXPLICIT OVERRIDE)
- **Data**: `DROP TABLE`, `DELETE FROM`, Database migration.
- **System**: `rm -rf /`, `chmod 777` on root.
- **Automation**: Blocked by Default. Agent will refuse action unless the user types the exact override string provided in the prompt.

---

### Incident Response (SRE)
In case of a Level 4+ failure:
1. **Freeze**: Stop all automated scripts.
2. **Snapshot**: Capture current state to `.vibe/incident_report.md`.
3. **Escalation**: Alert user via UI/Terminal with immediate remediation options.

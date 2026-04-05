# 🛠️ TASK_SPEC : Genesis Stabilization v6.3

Skill temporaire pour la phase de stabilisation et de genèse du protocole Watcher's Eye.

## 👥 SWARM ROLES
| Rôle | Responsabilité | Agent Préféré |
|------|----------------|---------------|
| **Executor** | Implémentation du code et des scripts. | Antigravity (Local) |
| **Critic (SRE)** | Validation de la résilience et des tests. | Sentinel Proxy |
| **Editor (Audit)** | Ghost Scan et propreté du code. | Vibe-OS Audit |

## 🚀 BLAST RADIUS (Resource Limits)
Pour prévenir tout crash de l'hôte, les limites suivantes sont imposées durant cette tâche :
- **API SERVICE** : `memory_limit: 512MB`, `cpus: 0.5`.
- **DASHBOARD UI** : `memory_limit: 1GB`, `cpus: 1.0`.
- **SCRIPTS** : Timeout global de `60s` via `timeout` command.
- **NETWORK** : Isolation des ports de management (Port 3000 API, Port 51820 VPN).

## 🛡️ MISSION CONSTRAINTS
- **REVERSED VERIFICATION** : Interdiction de commit sans réussite de `verify-task.sh`.
- **RED TEAMING** : Obligation de tester contre `evil-pioneer.sh`.
- **ESCALATION** : Si un script Shell utilise `rm -rf /`, arrêt immédiat (Niveau 5).

---
*Généré par Vibe-OS v6.3 — The Watcher's Eye*

# 💠 KI: SRE Autonomic Healing & Hardening (v6.5-Obsidian+)

Ce Knowledge Item documente l'architecture de résilience et le protocole d'auto-réparation (Autonomic Healing) implémentés pour atteindre le **Grade Obsidian Plus**.

## 🛡️ Architecture "Zero-Trust Shell"

Tous les scripts de l'infrastructure (`setup.sh`, `sentinel.sh`, `wg-*.sh`) doivent respecter les standards suivants :

1.  **Options Strictes** : `set -euo pipefail` est obligatoire pour stopper l'exécution à la moindre erreur ou variable non définie.
2.  **Unification des Utilitaires** : Aucun script ne doit redéfinir ses propres fonctions de log ou de dépendances. Le sourcing de [wg-common.sh](file:///home/faleryo/wg-fux/core-vpn/scripts/wg-common.sh) est central.
3.  **Logs Unifiés** : Utilisation exclusive des fonctions `log_info`, `log_warn`, `log_error`, `log_success` et `log_sre`.

## 👁️ Protocole d'Auto-Réparation (Sentinel)

Le Sentinel Watchdog (`sentinel.sh`) est l'agent autonome chargé de la stabilité de la production.

### Boucle de Surveillance (30s)
1.  **Vérification API** : Test de l'endpoint `/api/health`.
2.  **Scan de Santé Docker** : `docker ps --filter "health=unhealthy"`.
3.  **Audit de Présence** : Vérifie l'existence des conteneurs critiques (`nginx`, `ui`, `dns`).

### Actions de Guérison (Healing)
- **Container Unhealthy** : Sentinel déclenche un `docker restart` immédiat du service concerné.
- **Container Manquant** : Sentinel tente un `docker compose up -d <service>` pour remonter l'instance sans impacter les services sains.

## 🐳 Stratégie Docker Healthcheck

Les healthchecks dans `docker-compose.yml` ont été durcis pour être réactifs mais tolérants lors des phases de bootstrap :
- **Certbot** : Considéré comme "Healthy" si `/etc/letsencrypt/live` existe OU si le système est en attente de configuration (évite les fausses alertes).
- **Nginx/API/UI** : Intervalles de 30s avec un `start_period` de 45s pour laisser le temps aux services de s'initialiser sur des VPS à faible RAM.

## 📜 Maintenance SRE

- **Localisation des scripts** : `/usr/local/bin/wg-*.sh` (liens vers `core-vpn/scripts/`).
- **Logs Sentinel** : Consultables via `journalctl -u sentinel` ou dans `/var/log/wg-sentinel.log`.
- **Audit de Santé** : L'option 6 de `setup.sh` déclenche un audit complet basé sur ce KI.

---
*Date : 2026-04-06*
*Version : v6.5-Obsidian+*

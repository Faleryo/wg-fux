#!/bin/bash
# wg-fix-adguard.sh — Répare un AdGuard dont les credentials ne correspondent
# plus au .env de l'API (cas typique : le volume AdGuard a survécu à une
# réinstallation alors que api-service/.env a été regénéré → l'API prend des
# 401/403, le filtrage DNS n'est plus pilotable, l'UI affiche « Disabled »).
#
# Principe : on efface AdGuardHome.yaml du volume de conf → AdGuard redémarre
# sur son assistant d'installation → l'API (initializeDNS, au boot) le
# configure automatiquement avec AGH_USER/AGH_PASSWORD du .env, puis pousse
# les upstreams optimisés. Les listes de blocage par défaut sont réappliquées.
#
# À exécuter EN ROOT SUR L'HÔTE, depuis le dossier d'installation wg-fux.
set -euo pipefail

INSTALL_DIR="${WG_FUX_INSTALL_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$INSTALL_DIR"

log() { echo "[wg-fix-adguard] $*" >&2; }

[ "$(id -u)" -eq 0 ] || { log "À exécuter en root."; exit 1; }
grep -qE '^AGH_PASSWORD=.{8,}' api-service/.env 2>/dev/null \
  || { log "AGH_PASSWORD absent/trop court dans api-service/.env — corrigez d'abord le .env."; exit 1; }

# Résout le nom réel du volume de conf (préfixé par le nom du projet compose).
CONF_VOLUME=$(docker volume ls --format '{{.Name}}' | grep 'wg_fux_adguard_conf$' | head -1)
[ -n "$CONF_VOLUME" ] || { log "Volume wg_fux_adguard_conf introuvable."; exit 1; }

log "Arrêt d'AdGuard…"
docker compose stop adguard

log "Réinitialisation de la conf (volume ${CONF_VOLUME})…"
docker run --rm -v "${CONF_VOLUME}:/conf" alpine:3 sh -c 'rm -f /conf/AdGuardHome.yaml'

log "Redémarrage d'AdGuard (assistant d'installation) puis de l'API (auto-init)…"
docker compose up -d adguard
docker compose restart api

log "OK. Vérifiez dans ~30 s : docker logs wg-fux-api --since 1m | grep -i adguard"
echo "✅ AdGuard réinitialisé — l'API va le reconfigurer avec les credentials du .env."

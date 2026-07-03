#!/bin/bash
# wg-self-update.sh — Met à jour une instance wg-fux revendeur depuis la
# plateforme mère, SANS casser les peers WireGuard existants.
#
# À exécuter EN ROOT SUR L'HÔTE (pas dans le conteneur) : il rebuild la stack
# Docker. Installé par setup.sh, appelable via `setup.sh --self-update` et par
# un cron quotidien.
#
# Sécurité / continuité :
#   - S'authentifie avec la CLÉ DE LICENCE de l'instance → seules les licences
#     valides reçoivent les mises à jour (402 sinon : rien n'est touché).
#   - Le bundle (git archive HEAD de la plateforme) ne contient NI .env NI data :
#     tar extrait par-dessus sans supprimer → configuration et DB préservées.
#   - Les peers vivent dans /etc/wireguard/clients (bind-mount hôte) et sont
#     ré-appliqués au runtime par wg-sync-peers.sh (PostUp) après le restart du
#     conteneur → coupure ~30-60s, aucune perte de client.
set -euo pipefail

INSTALL_DIR="${WG_FUX_INSTALL_DIR:-/opt/wg-fux}"
API_ENV="${INSTALL_DIR}/api-service/.env"
LOG_FILE='/var/log/wg-fux-update.log'

log()  { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE" >&2; }
fail() { log "ERREUR: $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "À exécuter en root sur l'hôte."
[ -f "$API_ENV" ] || fail "Instance introuvable ($API_ENV absent)."

# Lit une variable depuis api-service/.env sans sourcer tout le fichier.
env_get() { grep -E "^$1=" "$API_ENV" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'; }

LICENSE_KEY="$(env_get WG_FUX_LICENSE_KEY)"
PLATFORM_URL="$(env_get WG_FUX_PLATFORM_URL)"

if [ -z "$LICENSE_KEY" ] || [ -z "$PLATFORM_URL" ]; then
  fail "Pas de licence configurée (WG_FUX_LICENSE_KEY/WG_FUX_PLATFORM_URL). Instance mère ? La MAJ passe par git."
fi

PLATFORM_URL="${PLATFORM_URL%/}"
TMP_BUNDLE="$(mktemp /tmp/wg-fux-update.XXXXXX.tgz)"
trap 'rm -f "$TMP_BUNDLE"' EXIT

log "=== Mise à jour wg-fux depuis ${PLATFORM_URL} ==="

# Télécharge le bundle (clé de licence = auth). -f → échec sur 401/402/5xx.
HTTP_CODE=$(curl --proto '=https' --tlsv1.2 -sS -w '%{http_code}' \
  -H "Authorization: Bearer ${LICENSE_KEY}" \
  -o "$TMP_BUNDLE" --max-time 300 \
  "${PLATFORM_URL}/license/bundle.tgz" || echo "000")

case "$HTTP_CODE" in
  200) : ;;
  402) fail "Licence expirée — renouvelez votre abonnement pour recevoir les mises à jour." ;;
  401) fail "Clé de licence refusée par la plateforme." ;;
  *)   fail "Téléchargement du bundle échoué (HTTP ${HTTP_CODE})." ;;
esac

# Sanity : c'est bien un gzip non vide.
[ -s "$TMP_BUNDLE" ] && gzip -t "$TMP_BUNDLE" 2>/dev/null \
  || fail "Bundle téléchargé invalide (pas un gzip)."

log "Extraction par-dessus ${INSTALL_DIR} (préserve .env + data)…"
tar -xzf "$TMP_BUNDLE" -C "$INSTALL_DIR"

log "Rebuild + redémarrage des services (peers ré-appliqués au PostUp)…"
cd "$INSTALL_DIR"
# setup.sh --update : rebuild api+ui puis up -d, sans toucher à la config.
bash setup.sh --update || fail "Le rebuild a échoué — l'ancienne stack tourne toujours."

log "=== Mise à jour terminée avec succès ==="
echo "✅ wg-fux à jour. Les clients WireGuard se reconnectent automatiquement."

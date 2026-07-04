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
TLS_PIN="$(env_get TLS_PINNED_PUBKEY)"

# ── PRÉ-CHECK ultra-léger (déploiement gouverné) ─────────────────────────────
# Appelé chaque minute par le cron : on interroge /license/update-check (JSON
# minuscule) et on sort SILENCIEUSEMENT si aucune version n'est offerte — ni
# téléchargement de bundle, ni ligne de log (sinon le log gonflerait de 1440
# entrées/jour). WG_SELF_UPDATE_FORCE=1 (setup.sh --self-update) court-circuite
# le pré-check ; une mère trop ancienne (404 sur la sonde) aussi.
LOCAL_VERSION=$(grep -m1 '"version"' "${INSTALL_DIR}/api-service/package.json" 2>/dev/null \
  | sed 's/.*: *"\([^"]*\)".*/\1/')

# Marqueurs partagés avec l'API de l'instance :
#   update-pending.json  — écrit ICI (root) : { version, mode, applyAt? } → l'UI
#                          de l'instance affiche le bandeau (Installer / heure).
#   update-confirmed     — écrit par l'API quand l'opérateur clique Installer.
# ⚠️ /app/data est un VOLUME DOCKER NOMMÉ (wg_fux_data), pas un bind-mount :
# écrire dans ${INSTALL_DIR}/api-service/data ne servait à rien (le conteneur
# ne le voit pas) et le dossier n'existait même pas (le script mourait en
# boucle sur la redirection). On résout le vrai Mountpoint du volume.
resolve_data_dir() {
  local vol
  vol=$(docker volume ls -q 2>/dev/null | grep 'wg_fux_data$' | head -1)
  if [ -n "$vol" ]; then
    docker volume inspect -f '{{.Mountpoint}}' "$vol" 2>/dev/null && return 0
  fi
  echo "${INSTALL_DIR}/api-service/data" # repli (vieilles installs bind-mount)
}
DATA_DIR="$(resolve_data_dir)"
mkdir -p "$DATA_DIR" 2>/dev/null || true
PENDING="${DATA_DIR}/update-pending.json"
CONFIRMED="${DATA_DIR}/update-confirmed"

cleanup_markers() { rm -f "$PENDING" "$CONFIRMED" 2>/dev/null || true; }

if [ "${WG_SELF_UPDATE_FORCE:-0}" != "1" ]; then
  CHECK_BODY="$(curl --proto '=https' --tlsv1.2 -sS \
    ${TLS_PIN:+--pinnedpubkey "$TLS_PIN"} \
    -H "Authorization: Bearer ${LICENSE_KEY}" \
    --max-time 20 "${PLATFORM_URL}/license/update-check" 2>/dev/null || echo '__CHECK_FAILED__')"
  case "$CHECK_BODY" in
    __CHECK_FAILED__|*'"error"'*'404'*) : ;; # sonde indisponible → chemin legacy complet
    *)
      OFFERED=$(printf '%s' "$CHECK_BODY" | grep -o '"offeredVersion":"[^"]*"' | cut -d'"' -f4)
      MODE=$(printf '%s' "$CHECK_BODY" | grep -o '"mode":"[^"]*"' | cut -d'"' -f4)
      if [ -z "$OFFERED" ] || [ "$OFFERED" = "$LOCAL_VERSION" ]; then
        cleanup_markers # offre retirée ou déjà à jour → plus rien en attente
        exit 0
      fi

      # Un marqueur d'une AUTRE version est périmé (nouvelle release approuvée).
      if [ -f "$PENDING" ] && ! grep -q "\"version\":\"${OFFERED}\"" "$PENDING"; then
        cleanup_markers
      fi

      if [ "$MODE" = "instant" ]; then
        # Instantané : on attend la CONFIRMATION de l'opérateur de l'instance
        # (bouton « Installer maintenant » dans son UI) — puis on applique.
        if [ -f "$CONFIRMED" ] && grep -q "$OFFERED" "$CONFIRMED"; then
          log "Mise à jour v${OFFERED} confirmée par l'opérateur — installation."
        else
          if [ ! -f "$PENDING" ]; then
            printf '{"version":"%s","mode":"instant","seenAt":%s}\n' "$OFFERED" "$(date +%s)" > "$PENDING" 2>/dev/null \
              || log "⚠ Impossible d'écrire ${PENDING} — bandeau UI indisponible."
            chmod 0644 "$PENDING" 2>/dev/null || true
            log "Mise à jour v${OFFERED} (mode instantané) en attente de confirmation de l'opérateur."
          fi
          exit 0
        fi
      else
        # Auto (défaut) : programmée ~6 h après la première détection — laisse
        # une fenêtre à l'opérateur, lisse la charge, zéro intervention.
        if [ -f "$PENDING" ]; then
          APPLY_AT=$(grep -o '"applyAt":[0-9]*' "$PENDING" | cut -d: -f2)
          # Confirmation anticipée possible depuis l'UI, même en mode auto.
          if [ -f "$CONFIRMED" ] && grep -q "$OFFERED" "$CONFIRMED"; then
            log "Mise à jour v${OFFERED} avancée par l'opérateur — installation."
          elif [ -n "$APPLY_AT" ] && [ "$(date +%s)" -ge "$APPLY_AT" ]; then
            log "Mise à jour v${OFFERED} (mode auto) : échéance atteinte — installation."
          else
            exit 0
          fi
        else
          APPLY_AT=$(( $(date +%s) + 6 * 3600 ))
          printf '{"version":"%s","mode":"auto","seenAt":%s,"applyAt":%s}\n' \
            "$OFFERED" "$(date +%s)" "$APPLY_AT" > "$PENDING" 2>/dev/null || true
          chmod 0644 "$PENDING" 2>/dev/null || true
          if [ ! -f "$PENDING" ]; then
            # Marqueur inécrivable : sans lui, on reprogrammerait +6 h à chaque
            # minute pour l'éternité → on applique tout de suite à la place.
            log "⚠ Marqueur indisponible — application immédiate de v${OFFERED}."
          else
            log "Mise à jour v${OFFERED} (mode auto) programmée pour $(date -d "@${APPLY_AT}" '+%H:%M' 2>/dev/null || echo '+6h')."
            exit 0
          fi
        fi
      fi
      ;;
  esac
fi

TMP_BUNDLE="$(mktemp /tmp/wg-fux-update.XXXXXX.tgz)"
TMP_HDR="$(mktemp /tmp/wg-fux-update.XXXXXX.hdr)"
trap 'rm -f "$TMP_BUNDLE" "$TMP_HDR"' EXIT

log "=== Mise à jour wg-fux depuis ${PLATFORM_URL} ==="

# Télécharge le bundle (clé de licence = auth) + capture les en-têtes (sha256).
# -f → échec sur 401/402/5xx. Épingle la clé publique TLS si configurée.
HTTP_CODE=$(curl --proto '=https' --tlsv1.2 -sS -w '%{http_code}' \
  ${TLS_PIN:+--pinnedpubkey "$TLS_PIN"} \
  -H "Authorization: Bearer ${LICENSE_KEY}" \
  -D "$TMP_HDR" -o "$TMP_BUNDLE" --max-time 300 \
  "${PLATFORM_URL}/license/bundle.tgz" || echo "000")

case "$HTTP_CODE" in
  200) : ;;
  204) log "Aucune mise à jour approuvée pour cette instance (déploiement gouverné) — aucune action."; exit 0 ;;
  402) fail "Licence expirée — renouvelez votre abonnement pour recevoir les mises à jour." ;;
  401) fail "Clé de licence refusée par la plateforme." ;;
  *)   fail "Téléchargement du bundle échoué (HTTP ${HTTP_CODE})." ;;
esac

# Sanity : c'est bien un gzip non vide.
[ -s "$TMP_BUNDLE" ] && gzip -t "$TMP_BUNDLE" 2>/dev/null \
  || fail "Bundle téléchargé invalide (pas un gzip)."

# DÉJÀ À JOUR ? La plateforme annonce sa version (en-tête) : si elle est égale
# à la nôtre, on s'arrête là — pas de rebuild ni de coupure WireGuard pour rien
# (le cron tourne toutes les nuits, les releases sont rares).
REMOTE_VERSION=$(grep -i '^X-WG-Fux-Version:' "$TMP_HDR" | tr -d '\r' | awk '{print $2}')
if [ -n "$REMOTE_VERSION" ] && [ -n "$LOCAL_VERSION" ] && [ "$REMOTE_VERSION" = "$LOCAL_VERSION" ]; then
  log "Déjà à jour (v${LOCAL_VERSION}) — aucune action."
  exit 0
fi
log "Nouvelle version disponible : v${LOCAL_VERSION:-?} → v${REMOTE_VERSION:-?}"

# INTÉGRITÉ : le sha256 annoncé par la plateforme (en-tête) doit correspondre au
# fichier téléchargé AVANT toute extraction/exécution root. Sans en-tête (vieux
# serveur), on refuse plutôt que d'exécuter du code non vérifié.
EXPECTED_SHA=$(grep -i '^X-WG-Fux-Bundle-Sha256:' "$TMP_HDR" | tr -d '\r' | awk '{print tolower($2)}')
[ -n "$EXPECTED_SHA" ] || fail "En-tête d'intégrité absent — mise à jour refusée (plateforme trop ancienne ?)."
ACTUAL_SHA=$(sha256sum "$TMP_BUNDLE" | awk '{print $1}')
[ "$EXPECTED_SHA" = "$ACTUAL_SHA" ] \
  || fail "Intégrité du bundle INVALIDE (attendu ${EXPECTED_SHA}, obtenu ${ACTUAL_SHA}) — abandon."

# PURGE avant extraction : un tar par-dessus ÉCRASE les fichiers de même nom
# mais ne supprime JAMAIS ceux absents de la nouvelle archive. Le passage au
# bundle durci a changé la forme de dashboard-ui (src/ → dist/ seul) : sans
# cette purge, l'ancien code source (JSX en clair) resterait indéfiniment sur
# le disque à côté du nouveau dist/, lisible par quiconque a un accès au VPS.
# Aucun état persistant ne vit dans ces dossiers (.env et data/ sont ailleurs,
# jamais touchés) — les supprimer avant extraction est sans risque.
log "Purge du code remplacé (dashboard-ui, api-service/src+db, core-vpn/scripts)…"
for d in dashboard-ui api-service/src api-service/db core-vpn/scripts; do
  rm -rf "${INSTALL_DIR:?}/${d}"
done

log "Extraction par-dessus ${INSTALL_DIR} (préserve .env + data)…"
tar -xzf "$TMP_BUNDLE" -C "$INSTALL_DIR"

log "Rebuild + redémarrage des services (peers ré-appliqués au PostUp)…"
cd "$INSTALL_DIR"
# setup.sh --update : rebuild api+ui puis up -d, sans toucher à la config.
bash setup.sh --update || fail "Le rebuild a échoué — l'ancienne stack tourne toujours."

cleanup_markers 2>/dev/null || true # plus rien en attente : bandeau UI retiré

log "=== Mise à jour terminée avec succès ==="
echo "✅ wg-fux à jour. Les clients WireGuard se reconnectent automatiquement."

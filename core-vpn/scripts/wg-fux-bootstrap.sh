#!/bin/bash
# wg-fux-bootstrap.sh — Installe la plateforme complète wg-fux sur un VPS revendeur.
#
# Ce script est SERVI ET PERSONNALISÉ par l'API à GET /provision/<token>/script.
# Les jetons {{...}} sont substitués côté serveur AVANT de calculer le sha256
# affiché dans le one-liner. Le VPS télécharge, vérifie le hash, puis exécute.
#
# Flow :
#   1. Installe git + prérequis Docker
#   2. Clone wg-fux depuis le repo officiel
#   3. Lance setup.sh --install (interactif : port, domaine, admin, AdGuard…)
#   4. Callback plateforme → marque le serveur online

set -euo pipefail

PLATFORM_BASE='{{PLATFORM_BASE}}'
REPO_URL='{{REPO_URL}}'
INSTALL_DIR='/opt/wg-fux'
LOG_FILE='/var/log/wg-fux-provision.log'
TOKEN="${WG_T:-}"

log()  { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE" >&2; }
fail() { log "ERREUR: $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Ce script doit être exécuté en root."
[ -n "$TOKEN" ] || fail "Token de provisioning manquant (variable WG_T)."

touch "$LOG_FILE" 2>/dev/null && chmod 600 "$LOG_FILE" 2>/dev/null || true
log "=== Bootstrap wg-fux ==="

command -v apt-get >/dev/null 2>&1 || fail "OS non supporté (apt-get introuvable). Debian/Ubuntu requis."
export DEBIAN_FRONTEND=noninteractive

# ─────────────────────────────────────────────────────────────────────────────
# 1. Dépendances minimales (git, curl, ca-certificates)
# ─────────────────────────────────────────────────────────────────────────────
log "Installation des prérequis (git, curl, ca-certificates)…"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates

# ─────────────────────────────────────────────────────────────────────────────
# 2. Téléchargement de wg-fux (idempotent)
# ─────────────────────────────────────────────────────────────────────────────
if [ -d "$INSTALL_DIR/.git" ]; then
  log "wg-fux déjà présent dans $INSTALL_DIR — mise à jour vers la dernière version…"
  BRANCH=$(git -C "$INSTALL_DIR" symbolic-ref --short HEAD 2>/dev/null || echo 'main')
  git -C "$INSTALL_DIR" fetch --all --prune --quiet
  git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH" --quiet
else
  log "Clonage de wg-fux dans $INSTALL_DIR…"
  git clone --depth 1 --quiet "$REPO_URL" "$INSTALL_DIR"
fi
log "Code wg-fux prêt dans $INSTALL_DIR."

# ─────────────────────────────────────────────────────────────────────────────
# 3. Installation complète (interactif)
# ─────────────────────────────────────────────────────────────────────────────
echo
echo "════════════════════════════════════════════════════════════════"
echo "  wg-fux — Installation de votre serveur VPN"
echo "  Répondez aux questions ci-dessous pour configurer votre instance."
echo "  Vous pourrez modifier ces paramètres plus tard via setup.sh."
echo "════════════════════════════════════════════════════════════════"
echo

cd "$INSTALL_DIR"
bash setup.sh --install || fail "L'installation wg-fux a échoué (voir $LOG_FILE)."

# ─────────────────────────────────────────────────────────────────────────────
# 4. Callback — notifie la plateforme que ce serveur est online
# ─────────────────────────────────────────────────────────────────────────────
log "Notification de la plateforme (callback ready)…"

SERVER_IP=$(curl -fsSL --max-time 5 https://ifconfig.me/ip 2>/dev/null \
  || curl -fsSL --max-time 5 https://api4.ipify.org 2>/dev/null \
  || hostname -I | awk '{print $1}' \
  || echo "")

curl --proto '=https' --tlsv1.2 -fsSL -X POST \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  --data "{\"host\":\"${SERVER_IP}\"}" \
  "${PLATFORM_BASE}/provision/${TOKEN}/ready" \
  || log "Callback échoué — vérifiez la connectivité vers ${PLATFORM_BASE}."

log "=== Bootstrap terminé ==="
echo
echo "✅ wg-fux installé. Accédez à votre panel : http://${SERVER_IP}/"
echo "   (ou https://VOTRE-DOMAINE/ si vous avez configuré un domaine)"

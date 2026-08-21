#!/bin/bash
# wg-fux-bootstrap.sh — Installe la plateforme complète wg-fux sur un VPS revendeur.
#
# Ce script est SERVI ET PERSONNALISÉ par l'API à GET /provision/<token>/script.
# Les jetons {{...}} sont substitués côté serveur AVANT de calculer le sha256
# affiché dans le one-liner. Le VPS télécharge, vérifie le hash, puis exécute.
#
# Flow :
#   1. Télécharge le BUNDLE produit (token-gaté — le repo n'est pas public),
#      vérifie son sha256 (injecté ici, donc lui-même couvert par WG_H).
#   2. Extrait dans /opt/wg-fux.
#   3. Lance setup.sh --install (interactif : port, domaine, admin, AdGuard…)
#      avec la licence de l'instance dans l'environnement.
#   4. Callback plateforme → marque le serveur online.

set -euo pipefail
umask 077 # tout fichier créé (bundle temp, log) est privé au propriétaire (root)

PLATFORM_BASE='{{PLATFORM_BASE}}'
BUNDLE_SHA256='{{BUNDLE_SHA256}}'
LICENSE_KEY='{{LICENSE_KEY}}'
TLS_PIN='{{TLS_PIN}}' # clé publique TLS épinglée (vide = pas de pin)
LICENSE_PUBKEY='{{LICENSE_PUBKEY}}' # clé publique Ed25519 de la mère (vérif des grants signés ; vide = legacy)
INSTALL_DIR='/opt/wg-fux'
LOG_FILE='/var/log/wg-fux-provision.log'
TOKEN="${WG_T:-}"

# Options curl communes : HTTPS forcé, downgrade TLS impossible, pin optionnel.
# (tableau bash pour préserver le quoting du pin.)
CURL_SECURE=(--proto '=https' --tlsv1.2)
[ -n "$TLS_PIN" ] && CURL_SECURE+=(--pinnedpubkey "$TLS_PIN")

log()  { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE" >&2; }
fail() { log "ERREUR: $*"; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "Ce script doit être exécuté en root."
[ -n "$TOKEN" ] || fail "Token de provisioning manquant (variable WG_T)."

touch "$LOG_FILE" 2>/dev/null && chmod 600 "$LOG_FILE" 2>/dev/null || true
log "=== Bootstrap wg-fux ==="

command -v apt-get >/dev/null 2>&1 || fail "OS non supporté (apt-get introuvable). Debian/Ubuntu requis."
export DEBIAN_FRONTEND=noninteractive

# ─────────────────────────────────────────────────────────────────────────────
# 1. Prérequis minimaux
# ─────────────────────────────────────────────────────────────────────────────
log "Installation des prérequis (curl, tar, ca-certificates)…"
apt-get update -qq
apt-get install -y -qq curl tar ca-certificates coreutils

# ─────────────────────────────────────────────────────────────────────────────
# 2. Téléchargement du bundle produit (token-gaté) + vérification d'intégrité
# ─────────────────────────────────────────────────────────────────────────────
TMP_BUNDLE="$(mktemp /tmp/wg-fux-bundle.XXXXXX.tgz)"
trap 'rm -f "$TMP_BUNDLE"' EXIT

log "Téléchargement du bundle wg-fux…"
curl "${CURL_SECURE[@]}" -fsSL --max-time 300 \
  -o "$TMP_BUNDLE" "${PLATFORM_BASE}/provision/${TOKEN}/bundle.tgz" \
  || fail "Téléchargement du bundle échoué (token expiré ? réseau ?)."

log "Vérification d'intégrité (sha256)…"
echo "${BUNDLE_SHA256}  ${TMP_BUNDLE}" | sha256sum -c - \
  || fail "Intégrité du bundle INVALIDE — abandon. Régénérez le one-liner depuis la plateforme."

# Extraction (préserve api-service/.env et les données locales si ré-exécution :
# le bundle n'en contient pas, tar ne supprime jamais les fichiers non listés).
mkdir -p "$INSTALL_DIR"
tar -xzf "$TMP_BUNDLE" -C "$INSTALL_DIR"
log "Bundle extrait dans ${INSTALL_DIR}."

# ─────────────────────────────────────────────────────────────────────────────
# 3. Installation complète
# ─────────────────────────────────────────────────────────────────────────────
# `setup.sh --install` pose des questions (port, domaine, admin, AdGuard…). Sans
# terminal — cas d'un `ssh serveur '<one-liner>'` sans -t, ou d'un enrôlement
# automatisé — ces `read` reçoivent EOF et produisent une configuration vide ou
# un blocage. On choisit donc explicitement le mode selon la présence d'un TTY :
#   - terminal présent          → installation interactive (parcours revendeur) ;
#   - pas de terminal + secrets → `--auto` (setup.sh lit tout dans l'environnement) ;
#   - pas de terminal sans secrets → on refuse, en indiquant la marche à suivre.
if [ -t 0 ]; then
  INSTALL_ARGS=(--install)
  echo
  echo "════════════════════════════════════════════════════════════════"
  echo "  wg-fux — Installation de votre serveur VPN"
  echo "  Répondez aux questions ci-dessous pour configurer votre instance."
  echo "  Vous pourrez modifier ces paramètres plus tard via setup.sh."
  echo "════════════════════════════════════════════════════════════════"
  echo
elif [ -n "${WGFUX_ADMIN_PASS:-}" ] && [ -n "${WGFUX_AGH_PASS:-}" ]; then
  INSTALL_ARGS=(--install --auto)
  log "Aucun terminal détecté — installation non interactive (secrets fournis par l'environnement)."
else
  fail "Aucun terminal disponible pour l'installation interactive.
      Relancez depuis une session interactive :
          ssh -t root@<vps>   puis collez le one-liner
      ou fournissez les secrets pour une installation automatique :
          WGFUX_ADMIN_PASS=... WGFUX_AGH_PASS=... <one-liner>"
fi

# La licence de l'instance : setup.sh l'écrit dans api-service/.env.
export WGFUX_LICENSE_KEY="$LICENSE_KEY"
export WGFUX_PLATFORM_URL="$PLATFORM_BASE"
# Clé publique de signature de la mère : setup.sh l'écrit en LICENSE_SIGNING_PUBKEY.
# Sa présence active la vérification des grants signés côté instance (anti-bypass).
export WGFUX_LICENSE_PUBKEY="$LICENSE_PUBKEY"

cd "$INSTALL_DIR"
bash setup.sh "${INSTALL_ARGS[@]}" || fail "L'installation wg-fux a échoué (voir $LOG_FILE)."

# ─────────────────────────────────────────────────────────────────────────────
# 4. Callback — notifie la plateforme que ce serveur est online
# ─────────────────────────────────────────────────────────────────────────────
log "Notification de la plateforme (callback ready)…"

SERVER_IP=$(curl -fsSL --max-time 5 https://ifconfig.me/ip 2>/dev/null \
  || curl -fsSL --max-time 5 https://api4.ipify.org 2>/dev/null \
  || hostname -I | awk '{print $1}' \
  || echo "")
SERVER_IP=$(printf '%s' "$SERVER_IP" | tr -d '[:space:]')

# Validation stricte (IPv4/IPv6) avant interpolation JSON : une réponse
# corrompue/MITM d'ifconfig.me/ipify contenant des guillemets casserait le
# JSON et pourrait injecter des champs dans le payload envoyé à la plateforme.
if ! [[ "$SERVER_IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ || "$SERVER_IP" =~ ^[a-fA-F0-9:]+$ ]]; then
  log "IP publique invalide/non détectée ('$SERVER_IP') — callback envoyé sans host."
  SERVER_IP=""
fi

# Clé hôte SSH ed25519 de CE VPS (générée par sshd au premier boot, jamais
# transmise sur le réseau jusqu'ici) : envoyée en clair dans le callback HTTPS
# authentifié par le token, pour que la plateforme puisse la PINNER avant sa
# toute première connexion SSH réelle (anti-MITM — voir verifyServer côté API).
HOST_PUBKEY_FILE="/etc/ssh/ssh_host_ed25519_key.pub"
if [ -r "$HOST_PUBKEY_FILE" ]; then
  # On ne garde que "ssh-ed25519 AAAA..." (2 premiers champs), sans le commentaire.
  SSH_HOST_KEY=$(awk '{print $1, $2}' "$HOST_PUBKEY_FILE" 2>/dev/null || echo "")
else
  log "Clé hôte ed25519 introuvable (${HOST_PUBKEY_FILE}) — callback envoyé sans hostKey."
  SSH_HOST_KEY=""
fi
# Validation stricte de forme avant interpolation JSON (même raison que pour
# SERVER_IP ci-dessus : le base64 ed25519 ne contient jamais de guillemet, mais
# on ne fait confiance à un fichier système qu'après l'avoir shape-checké).
if ! [[ "$SSH_HOST_KEY" =~ ^ssh-ed25519\ [A-Za-z0-9+/]+=*$ ]]; then
  [ -n "$SSH_HOST_KEY" ] && log "Format de clé hôte inattendu — callback envoyé sans hostKey."
  SSH_HOST_KEY=""
fi

CALLBACK_PAYLOAD=$(printf '{"host":"%s","hostKey":"%s"}' "$SERVER_IP" "$SSH_HOST_KEY")

curl "${CURL_SECURE[@]}" -fsSL -X POST \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  --data "$CALLBACK_PAYLOAD" \
  "${PLATFORM_BASE}/provision/${TOKEN}/ready" \
  || log "Callback échoué — vérifiez la connectivité vers ${PLATFORM_BASE}."

log "=== Bootstrap terminé ==="
echo
echo "✅ wg-fux installé. Accédez à votre panel : http://${SERVER_IP}/"
echo "   (ou https://VOTRE-DOMAINE/ si vous avez configuré un domaine)"

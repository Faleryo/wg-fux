#!/bin/bash
# wg-fux-bootstrap.sh — Provisioning one-liner (côté VPS revendeur)
#
# Ce script est SERVI ET PERSONNALISÉ par l'API à GET /provision/<token>/script.
# Les jetons {{...}} sont substitués côté serveur AVANT de calculer le sha256
# affiché dans la commande one-liner. Le client le télécharge, vérifie le hash,
# puis l'exécute en root sur SON VPS.
#
# Propriétés de sécurité :
#   - Idempotent : ré-exécuté = mise à jour (jamais d'état à moitié configuré).
#   - La clé SSH installée est CANTONNÉE (forced command + restrict + from).
#   - sudoers sans wildcard : une seule entrée, vers wg-fux-exec.sh.
#   - Tarball des scripts vérifié par sha256 (supply chain).
#   - La confiance n'est PAS déclarée ici : la plateforme se reconnecte en SSH
#     pour la prouver. Ce script ne fait que se préparer + signaler "ready".
#
# Le token de provisioning est lu depuis l'environnement (WG_T), JAMAIS depuis
# argv (pas de fuite via ps aux).

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# Valeurs injectées par l'API (templating au moment de servir le script).
# ─────────────────────────────────────────────────────────────────────────────
WG_FUX_PUBKEY='{{WG_FUX_PUBKEY}}'           # clé publique ed25519 générée par la plateforme
PLATFORM_BASE='{{PLATFORM_BASE}}'           # https://vpn-labs.ink
PLATFORM_IP='{{PLATFORM_IP}}'               # IP source autorisée dans authorized_keys (from=)
SCRIPTS_TARBALL_URL='{{SCRIPTS_TARBALL_URL}}'
SCRIPTS_SHA256='{{SCRIPTS_SHA256}}'         # sha256 attendu du tarball des wg-*.sh
TLS_PINNED_PUBKEY='{{TLS_PINNED_PUBKEY}}'   # sha256//... de la clé publique TLS (cert pinning)
SCRIPTS_VERSION='{{SCRIPTS_VERSION}}'

WG_FUX_USER='wg-fux'
WG_FUX_HOME="/home/${WG_FUX_USER}"
BIN_DIR='/usr/local/bin'
LOG_FILE='/var/log/wg-fux-provision.log'
TOKEN="${WG_T:-}"

# ─────────────────────────────────────────────────────────────────────────────
# Logging local (debug post-mortem si le callback n'arrive jamais)
# ─────────────────────────────────────────────────────────────────────────────
log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*" | tee -a "$LOG_FILE" >&2; }
fail() { log "ERREUR: $*"; exit 1; }

curl_pinned() {
  # curl durci : HTTPS strict, TLS 1.3, clé publique TLS épinglée.
  curl --proto '=https' --tlsv1.3 \
       ${TLS_PINNED_PUBKEY:+--pinnedpubkey "$TLS_PINNED_PUBKEY"} \
       --fail --silent --show-error --location --max-time 30 "$@"
}

# ─────────────────────────────────────────────────────────────────────────────
# 0. Pré-conditions
# ─────────────────────────────────────────────────────────────────────────────
[ "$(id -u)" -eq 0 ] || fail "Ce script doit être exécuté en root."
[ -n "$TOKEN" ] || fail "Token de provisioning manquant (variable WG_T)."
touch "$LOG_FILE" 2>/dev/null || true
chmod 600 "$LOG_FILE" 2>/dev/null || true
log "=== Bootstrap wg-fux (version scripts ${SCRIPTS_VERSION}) ==="

# OS supporté : Debian/Ubuntu (apt). Échec propre sinon — pas d'état partiel.
if ! command -v apt-get >/dev/null 2>&1; then
  fail "OS non supporté (apt-get introuvable). Debian/Ubuntu requis."
fi

export DEBIAN_FRONTEND=noninteractive

# ─────────────────────────────────────────────────────────────────────────────
# 1. Dépendances (idempotent : apt n'installe que le manquant)
# ─────────────────────────────────────────────────────────────────────────────
log "Installation des dépendances (wireguard, jq, curl, iproute2)…"
apt-get update -qq
apt-get install -y -qq wireguard wireguard-tools jq curl iproute2 sudo coreutils \
  || fail "Échec d'installation des paquets."

# ─────────────────────────────────────────────────────────────────────────────
# 2. Utilisateur système dédié 'wg-fux' (no password, idempotent)
# ─────────────────────────────────────────────────────────────────────────────
if ! id "$WG_FUX_USER" >/dev/null 2>&1; then
  log "Création de l'utilisateur système ${WG_FUX_USER}…"
  useradd --system --create-home --home-dir "$WG_FUX_HOME" \
          --shell /usr/sbin/nologin "$WG_FUX_USER"
fi
# Jamais de mot de passe : login par clé uniquement.
passwd -l "$WG_FUX_USER" >/dev/null 2>&1 || true

# ─────────────────────────────────────────────────────────────────────────────
# 3. Scripts WireGuard + dispatcher (tarball vérifié par sha256)
# ─────────────────────────────────────────────────────────────────────────────
TMP_DIR="$(mktemp -d /tmp/wg-fux-prov.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT
TARBALL="${TMP_DIR}/scripts.tgz"

log "Téléchargement des scripts…"
curl_pinned -o "$TARBALL" "$SCRIPTS_TARBALL_URL" || fail "Téléchargement du tarball échoué."

log "Vérification d'intégrité (sha256)…"
echo "${SCRIPTS_SHA256}  ${TARBALL}" | sha256sum -c - \
  || fail "Intégrité du tarball INVALIDE — abandon (supply chain ?)."

# Extraction atomique vers /usr/local/bin
tar -xzf "$TARBALL" -C "$TMP_DIR/extract" --one-top-level="extract" 2>/dev/null \
  || { mkdir -p "$TMP_DIR/extract" && tar -xzf "$TARBALL" -C "$TMP_DIR/extract"; }
install -m 0755 -o root -g root "$TMP_DIR"/extract/wg-*.sh "$BIN_DIR"/ 2>/dev/null || true
# Dispatcher + exec entrypoint sont inclus dans le tarball.
install -m 0755 -o root -g root "$TMP_DIR/extract/wg-fux-dispatch.sh" "$BIN_DIR/wg-fux-dispatch.sh"
install -m 0755 -o root -g root "$TMP_DIR/extract/wg-fux-exec.sh" "$BIN_DIR/wg-fux-exec.sh"
echo "$SCRIPTS_VERSION" > "$BIN_DIR/.wg-fux-scripts-version"
log "Scripts installés dans ${BIN_DIR}."

# ─────────────────────────────────────────────────────────────────────────────
# 4. Clé SSH CANTONNÉE (forced command + restrict + from)
# ─────────────────────────────────────────────────────────────────────────────
SSH_DIR="${WG_FUX_HOME}/.ssh"
AUTH_KEYS="${SSH_DIR}/authorized_keys"
install -d -m 0700 -o "$WG_FUX_USER" -g "$WG_FUX_USER" "$SSH_DIR"

# restrict        : pas de PTY/port-forward/agent/X11/tunnel — clé non pivotable.
# from="IP"       : seule l'IP de la plateforme peut utiliser la clé.
# command="..."   : la clé ne peut RIEN faire d'autre que lancer le dispatcher.
AUTH_LINE="restrict,from=\"${PLATFORM_IP}\",command=\"${BIN_DIR}/wg-fux-dispatch.sh\" ${WG_FUX_PUBKEY}"
# Idempotent : on remplace toute ligne wg-fux préexistante.
{
  [ -f "$AUTH_KEYS" ] && grep -vF "wg-fux-dispatch.sh" "$AUTH_KEYS" || true
  echo "$AUTH_LINE"
} > "${AUTH_KEYS}.new"
install -m 0600 -o "$WG_FUX_USER" -g "$WG_FUX_USER" "${AUTH_KEYS}.new" "$AUTH_KEYS"
rm -f "${AUTH_KEYS}.new"
log "Clé publique installée (cantonnée : forced command + from=${PLATFORM_IP})."

# ─────────────────────────────────────────────────────────────────────────────
# 5. sudoers ultra-restreint : UNE seule entrée, zéro wildcard
# ─────────────────────────────────────────────────────────────────────────────
SUDOERS_FILE='/etc/sudoers.d/wg-fux'
cat > "${SUDOERS_FILE}.new" <<EOF
# Généré par wg-fux-bootstrap.sh — NE PAS éditer à la main.
# wg-fux ne peut élever ses privilèges QUE via l'entrypoint validateur.
${WG_FUX_USER} ALL=(root) NOPASSWD: ${BIN_DIR}/wg-fux-exec.sh
EOF
# Validation syntaxique AVANT activation (un sudoers cassé = lock-out).
visudo -cf "${SUDOERS_FILE}.new" >/dev/null || fail "sudoers généré invalide — abandon."
install -m 0440 -o root -g root "${SUDOERS_FILE}.new" "$SUDOERS_FILE"
rm -f "${SUDOERS_FILE}.new"
log "sudoers restreint posé (1 entrée, sans wildcard)."

# ─────────────────────────────────────────────────────────────────────────────
# 6. Callback "ready" — déclenche la vérification SSH côté plateforme.
#    On envoie notre host key ; la plateforme la CROISERA avec celle qu'elle
#    verra en se reconnectant. Le callback ne suffit pas à passer 'online'.
# ─────────────────────────────────────────────────────────────────────────────
HOST_KEY="$(cat /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null | awk '{print $1" "$2}')"
[ -n "$HOST_KEY" ] || fail "Host key ed25519 introuvable sur ce VPS."

log "Notification de la plateforme (callback ready)…"
PAYLOAD="$(jq -nc --arg hk "$HOST_KEY" --arg hn "$(hostname)" --arg v "$SCRIPTS_VERSION" \
  '{hostKey:$hk, hostname:$hn, scriptsVersion:$v}')"

curl_pinned -X POST \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer ${TOKEN}" \
  --data "$PAYLOAD" \
  "${PLATFORM_BASE}/provision/${TOKEN}/ready" \
  || fail "Callback échoué — vérifiez l'accès internet sortant du VPS."

log "=== Bootstrap terminé. En attente de la vérification de la plateforme. ==="
echo "✅ VPS préparé. Retournez sur wg-fux : le serveur va passer 'online'."

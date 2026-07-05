#!/bin/bash
# wg-fux-exec.sh — Entrypoint privilégié (root via sudo), côté VPS revendeur.
#
# UNIQUE commande autorisée dans /etc/sudoers.d/wg-fux. Appelé normalement par
# wg-fux-dispatch.sh, mais NE LUI FAIT PAS CONFIANCE : il re-valide intégralement
# l'allowlist et les arguments (défense en profondeur — si le dispatcher est
# contourné, cette couche tient quand même).
#
# Usage : wg-fux-exec.sh <script-basename> [args...]   (stdin transmis au script)

set -euo pipefail

ALLOWLIST=(
  wg-fux-verify.sh
  wg-create-client.sh wg-remove-client.sh
  wg-create-container.sh wg-remove-container.sh
  wg-move-client.sh wg-sync-peers.sh wg-toggle.sh
  wg-stats.sh wg-health.sh wg-file-proxy.sh
  wg-backup.sh wg-restore.sh wg-check-expiry.sh
  wg-apply-qos.sh wg-enforcer.sh
  wg-init-server.sh wg-uninstall.sh
)
SAFE_ARG_RE="^[[:alnum:][:space:]._,:@+/=~!'()%&#-]*$"
BIN_DIR='/usr/local/bin'

deny() { echo "wg-fux-exec: refusé: $*" >&2; exit 126; }

[ "$(id -u)" -eq 0 ] || deny "doit tourner en root"
[ "$#" -ge 1 ] || deny "aucun script fourni"

SCRIPT="$1"; shift
case "$SCRIPT" in
  */*|*..*|'') deny "nom de script invalide" ;;
esac

ALLOWED=0
for s in "${ALLOWLIST[@]}"; do [ "$s" = "$SCRIPT" ] && ALLOWED=1 && break; done
[ "$ALLOWED" -eq 1 ] || deny "script non autorisé: $SCRIPT"

# Test regex natif bash (gère l'argument vide, contrairement à `grep -qP` qui le
# refusait à tort) + rejet explicite des sauts de ligne/retours chariot.
for a in "$@"; do
  case "$a" in
    *$'\n'* | *$'\r'*) deny "argument non sûr (saut de ligne)" ;;
  esac
  [[ "$a" =~ $SAFE_ARG_RE ]] || deny "argument non sûr"
done

TARGET="${BIN_DIR}/${SCRIPT}"
[ -x "$TARGET" ] || deny "script introuvable ou non exécutable: $TARGET"

exec "$TARGET" "$@"

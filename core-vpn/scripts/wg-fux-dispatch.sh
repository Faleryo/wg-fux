#!/bin/bash
# wg-fux-dispatch.sh — Forced command (côté VPS revendeur), user wg-fux NON privilégié.
#
# C'est l'UNIQUE chose que la clé SSH de la plateforme peut exécuter
# (authorized_keys: command="/usr/local/bin/wg-fux-dispatch.sh"). Même si la clé
# privée fuit, l'attaquant ne peut PAS ouvrir de shell : il ne peut que demander
# l'exécution d'un script wg-*.sh allowlisté, avec des arguments validés.
#
# Protocole d'invocation (envoyé par SshExecutor dans la commande SSH) :
#     wg-fux <base64url(JSON: ["wg-create-client.sh","arg1","arg2",...])>
# Le base64+JSON évite toute interprétation shell des arguments → zéro injection.
# stdin (contenu de fichier pour wg-file-proxy.sh, etc.) traverse de façon native.

set -euo pipefail

# Allowlist : exactement les scripts que l'API a besoin d'exécuter à distance.
# Tout le reste est REFUSÉ. (Re-validée aussi par wg-fux-exec.sh côté root.)
ALLOWLIST=(
  wg-fux-verify.sh
  wg-create-client.sh wg-remove-client.sh
  wg-create-container.sh wg-remove-container.sh
  wg-move-client.sh wg-sync-peers.sh wg-toggle.sh
  wg-stats.sh wg-health.sh wg-file-proxy.sh
  wg-backup.sh wg-restore.sh wg-check-expiry.sh
  wg-apply-qos.sh wg-enforcer.sh
  wg-init-server.sh
)

# SAFE_ARG : miroir exact de la politique de api-service/src/services/shell.js.
SAFE_ARG_RE="^[[:alnum:][:space:]._,:@+/=~!'()%&#-]*$"

deny() { echo "wg-fux-dispatch: refusé: $*" >&2; exit 126; }

CMD="${SSH_ORIGINAL_COMMAND:-}"
[ -n "$CMD" ] || deny "commande vide"

# Format strict : "wg-fux <payload-base64>"
read -r PREFIX PAYLOAD _ <<< "$CMD"
[ "$PREFIX" = "wg-fux" ] || deny "préfixe invalide"
[ -n "${PAYLOAD:-}" ] || deny "payload manquant"

# Décodage base64url → JSON → tableau argv
JSON="$(printf '%s' "$PAYLOAD" | base64 -d 2>/dev/null)" || deny "base64 invalide"
echo "$JSON" | jq -e 'type == "array" and length >= 1' >/dev/null 2>&1 \
  || deny "payload JSON invalide"

mapfile -t ARGV < <(printf '%s' "$JSON" | jq -r '.[]')
SCRIPT="${ARGV[0]}"
ARGS=("${ARGV[@]:1}")

# Le script doit être un basename pur (pas de chemin, pas de ..)
case "$SCRIPT" in
  */*|*..*|'') deny "nom de script invalide: $SCRIPT" ;;
esac

# allowlist
ALLOWED=0
for s in "${ALLOWLIST[@]}"; do [ "$s" = "$SCRIPT" ] && ALLOWED=1 && break; done
[ "$ALLOWED" -eq 1 ] || deny "script non autorisé: $SCRIPT"

# Validation de chaque argument (PCRE pour rester aligné sur shell.js)
for a in "${ARGS[@]}"; do
  printf '%s' "$a" | grep -qP "$SAFE_ARG_RE" || deny "argument non sûr"
done

# Élévation via l'UNIQUE entrée sudoers. stdin transmis tel quel.
exec sudo -n /usr/local/bin/wg-fux-exec.sh "$SCRIPT" "${ARGS[@]}"

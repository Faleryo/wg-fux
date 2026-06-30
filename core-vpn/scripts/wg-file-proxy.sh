#!/bin/bash
# SRE: Secure File Proxy ()
# Empêche l'utilisation directe de /bin/rm et /usr/bin/tee via API.
# Opérations limitées strictement aux répertoires de log et clients Wireguard.

set -euo pipefail

ALLOWED_DIR="/etc/wireguard/clients/"
ALLOWED_LOG="/var/log/"

if [ "$#" -lt 2 ]; then
 echo "Usage: $0 [read|write|append|delete|list] [filepath] [content]"
 exit 1
fi

ACTION="$1"
TARGET_RAW="$2"

# 🛡️ Anti-TOCTOU: Walk every component of the ORIGINAL path, checking for
# symlinks BEFORE resolving. This prevents escapes like
# clients/evil@link/foo where evil@link -> /var/log — the ".." check alone
# would miss this. Only after the walk do we resolve via realpath.

# Build the original path one component at a time and check each
ORIG_PATH="$TARGET_RAW"
# Normalise: strip trailing slash
ORIG_PATH="${ORIG_PATH%/}"
# Walk from root, checking each segment
CURRENT=""
IFS='/' read -r -a SEGMENTS <<< "$ORIG_PATH"
for SEG in "${SEGMENTS[@]}"; do
  [ -z "$SEG" ] && continue
  CURRENT="${CURRENT}/${SEG}"
  if [ -L "$CURRENT" ]; then
    echo "ERROR: Symlinks in path are forbidden."
    exit 1
  fi
done

# Resolve the canonical final target
FULL_REAL=$(realpath "$TARGET_RAW" 2>/dev/null || echo "")
if [ -z "$FULL_REAL" ]; then
  # Final component may not exist yet (write/create mode); resolve parent
  PARENT_DIR=$(realpath "$(dirname "$TARGET_RAW")" 2>/dev/null || echo "")
  if [ -z "$PARENT_DIR" ]; then
    echo "ERROR: Parent directory does not exist."
    exit 1
  fi
  BASENAME=$(basename "$TARGET_RAW")
  TARGET="$PARENT_DIR/$BASENAME"
else
  TARGET="$FULL_REAL"
fi

# Final check: ensure no ".." appears in any component
case "$TARGET_RAW" in
 *"/../"* | */".." | ".."* | "../"*)
  echo "ERROR: Path traversal is forbidden."
  exit 1
  ;;
esac

# Validation d'appartenance au périmètre sécurisé
# SRE-HARDENING: On s'assure que le chemin commence exactement par le préfixe autorisé
if [[ "$TARGET/" != "$ALLOWED_DIR"* ]] && [[ "$TARGET/" != "$ALLOWED_LOG"* ]]; then
 echo "ERROR: Access to $TARGET is restricted."
 exit 1
fi

# : Blacklist de fichiers critiques (Anti-Exfiltration)
BLACKLIST=("/var/log/auth.log" "/var/log/syslog" "/var/log/messages" "/var/log/secure" "/var/log/tallylog")
for blacklisted in "${BLACKLIST[@]}"; do
 if [[ "$TARGET" == "$blacklisted" ]]; then
 echo "ERROR: Access to sensitive file $TARGET is forbidden (Blacklisted)."
 exit 1
 fi
done

case "$ACTION" in
 "write")
 if [ $# -ge 3 ]; then
 printf '%s' "$3" > "$TARGET"
 else
 cat > "$TARGET"
 fi
 ;;
 "append")
 if [ $# -ge 3 ]; then
 printf '%s' "$3" >> "$TARGET"
 else
 cat >> "$TARGET"
 fi
 ;;
 "read")
 # Lecture du contenu (utilisé par l'API pour récupérer .conf/public.key, en
 # local comme à distance via SSH). cat échoue (set -e) si le fichier manque.
 cat "$TARGET"
 ;;
 "delete")
 rm -f "$TARGET"
 ;;
 "list")
 ls -1 "$TARGET" 2>/dev/null || echo ""
 ;;
 *)
 echo "ERROR: Unknown action $ACTION"
 exit 1
 ;;
esac

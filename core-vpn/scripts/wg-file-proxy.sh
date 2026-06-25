#!/bin/bash
# SRE: Secure File Proxy ()
# Empêche l'utilisation directe de /bin/rm et /usr/bin/tee via API.
# Opérations limitées strictement aux répertoires de log et clients Wireguard.

set -e

ALLOWED_DIR="/etc/wireguard/clients/"
ALLOWED_LOG="/var/log/"

if [ "$#" -lt 2 ]; then
 echo "Usage: $0 [write|append|delete|list] [filepath] [content]"
 exit 1
fi

ACTION="$1"
TARGET_RAW="$2"

# 🛡️ Anti-TOCTOU: realpath(1) suit les symlinks existants.
# Si la cible existe déjà, realpath résout TOUS les composants du chemin
# (y compris les symlinks). Si elle n'existe pas encore, on résout le parent
# (qui DOIT exister) et on concatène le nom de base.
if [ -e "$TARGET_RAW" ]; then
    TARGET=$(realpath "$TARGET_RAW")
else
    TARGET_DIR=$(realpath "$(dirname "$TARGET_RAW")")
    TARGET="$TARGET_DIR/$(basename "$TARGET_RAW")"
fi

# Validation stricte du chemin (Empêche path traversal "../")
if [[ "$TARGET_RAW" == *".."* ]] || [[ "$TARGET" == *".."* ]]; then
 echo "ERROR: Path traversal is forbidden."
 exit 1
fi

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
 echo -n "$3" > "$TARGET"
 else
 cat > "$TARGET"
 fi
 ;;
 "append")
 if [ $# -ge 3 ]; then
 echo -n "$3" >> "$TARGET"
 else
 cat >> "$TARGET"
 fi
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

#!/bin/bash
# 💠 SRE: Secure File Proxy (Obsidian Grade)
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

# 🛡️ OBSIDIAN-HARDENING: Résolution du chemin réel pour contrer les symlinks (Anti-V17)
# On s'assure que même si l'attaquant crée un lien symbolique, la destination finale est vérifiée.
TARGET=$(realpath -m "$TARGET_RAW")

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

# 💠 VIBE-OS: Blacklist de fichiers critiques (Anti-Exfiltration)
BLACKLIST=("/var/log/auth.log" "/var/log/syslog" "/var/log/messages" "/var/log/secure" "/var/log/tallylog")
for blacklisted in "${BLACKLIST[@]}"; do
    if [[ "$TARGET" == "$blacklisted" ]]; then
        echo "ERROR: Access to sensitive file $TARGET is forbidden (Blacklisted)."
        exit 1
    fi
done

case "$ACTION" in
    "write")
        if [ -n "$3" ]; then
            echo "$3" > "$TARGET"
        else
            cat > "$TARGET"
        fi
        ;;
    "append")
        if [ -n "$3" ]; then
            echo "$3" >> "$TARGET"
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

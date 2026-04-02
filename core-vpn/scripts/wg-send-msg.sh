#!/bin/bash
# --- VIBE-OS : Security Alert Bridge (Markdown-Ready) ---
# BUG-FIX: Missing script for login alerts & sentinel notifications.

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/wg-common.sh"

MESSAGE="${1:-"No message provided"}"
CONF_FILE="/etc/wireguard/sentinel.conf"
LOG_FILE="/var/log/wg-alerts.log"

# Enregistrement local de l'alerte
echo "[$(date +'%Y-%m-%d %H:%M:%S')] SECURITY-ALERT: $MESSAGE" >> "$LOG_FILE" 2>/dev/null || true

# Vérification de la configuration Telegram
if [ -f "$CONF_FILE" ]; then
    source "$CONF_FILE"
    
    if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
        # Formatage MarkdownV2 (nécessite l'échappement des caractères spéciaux)
        # Mais pour rester simple et robuste, on utilise HTML parse_mode qui est plus indulgent.
        ESC_MSG="<b>⚠️ ALERTE SYSTÈME WG-FUX</b>\n\n<code>$MESSAGE</code>"
        
        curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
            -d "chat_id=$TELEGRAM_CHAT_ID" \
            -d "text=$ESC_MSG" \
            -d "parse_mode=HTML" > /dev/null
            
        if [ $? -eq 0 ]; then
            log_info "Alerte de sécurité envoyée via Telegram."
        else
            log_warn "Échec de l'envoi de l'alerte Telegram."
        fi
    fi
fi

# Audit log final
log_info "Security Alert: $MESSAGE"
exit 0

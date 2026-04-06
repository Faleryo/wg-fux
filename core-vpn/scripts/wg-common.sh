# --- VIBE-OS v6.5 Obsidian Standard ---
VERSION="6.5.0-Obsidian"
PROJECT_ROOT="/home/faleryo/wg-fux"

# SRE Error Codes
ERR_OK=0
ERR_SYSTEM_FAILURE=1
ERR_NETWORK_TIMEOUT=2
ERR_AUTH_FAILED=3
ERR_PERMISSION_DENIED=4
ERR_DOCKER_CRASH=5

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
BOLD='\033[1m'

# Logger functions
log_info() {
    echo -e "${GREEN}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1" >&2
}

# Telegram notification hub
send_telegram_msg() {
    local message="$1"
    local conf_file="/etc/wireguard/sentinel.conf"
    
    if [ -f "$conf_file" ]; then
        source "$conf_file"
        
        if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
            local esc_msg="<b>⚠️ ALERTE SYSTÈME WG-FUX</b>\n\n<code>$message</code>"
            
            curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
                -d "chat_id=$TELEGRAM_CHAT_ID" \
                -d "text=$esc_msg" \
                -d "parse_mode=HTML" > /dev/null
                
            if [ $? -eq 0 ]; then
                log_info "Notification envoyée via Telegram."
            else
                log_warn "Échec de l'envoi Telegram (vérifiez le Token/ID)."
            fi
        fi
    fi
}

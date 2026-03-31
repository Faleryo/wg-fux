#!/bin/bash

# 💠 VIBE-OS Sentinel Watchdog
# Role: SRE - Monitoring, Auto-Heal & Telegram Alerts
# Devise: "Le silence du terminal est suspect."

CONF_FILE="/etc/wireguard/sentinel.conf"
LOG_FILE="/var/log/wg-sentinel.log"
API_URL="http://localhost:3000/api/system/health"

# Charger la configuration
if [ -f "$CONF_FILE" ]; then
    # shellcheck source=/dev/null
    source "$CONF_FILE"
fi

log_event() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

send_telegram() {
    if [[ -n "$TELEGRAM_BOT_TOKEN" && -n "$TELEGRAM_CHAT_ID" ]]; then
        local message="$1"
        curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d "chat_id=${TELEGRAM_CHAT_ID}" \
            -d "text=💠 Sentinel Watchdog: ${message}" > /dev/null
    fi
}

check_health() {
    local response
    if ! response=$(curl -s --max-time 10 "$API_URL"); then
        log_event "[CRITICAL] API non répondante. Tentative d'Auto-Heal..."
        send_telegram "⚠️ API non répondante. Redémarrage des services..."
        docker compose -f "$(pwd)/docker-compose.yml" restart api ui
        return 1
    fi

    local status
    status=$(echo "$response" | grep -oP '"status":"\K[^"]+')
    
    if [[ "$status" != "healthy" ]]; then
        log_event "[WARNING] Système instable détecté ($status). Analyse..."
        local interface
        interface=$(echo "$response" | grep -oP '"interface":"\K[^"]+')
        
        if [[ "$interface" != "up" ]]; then
            log_event "[AUTO-HEAL] Interface WireGuard down. Redémarrage de l'interface..."
            send_telegram "🔧 Interface WireGuard down. Tentative de restauration..."
            # Ici on pourrait appeler un script interne ou redémarrer le conteneur
            docker compose -f "$(pwd)/docker-compose.yml" restart api
        fi
        return 1
    fi

    return 0
}

# Main loop
log_event "[INFO] Sentinel Watchdog démarré."
send_telegram "🚀 Sentinel Watchdog est maintenant actif sur votre serveur VPN."

while true; do
    check_health
    sleep 60
done

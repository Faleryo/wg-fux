#!/bin/bash

# 💠 VIBE-OS Sentinel Watchdog
# Role: SRE - Monitoring, Auto-Heal & Telegram Alerts
# Devise: "Le silence du terminal est suspect."

CONF_FILE="/etc/wireguard/sentinel.conf"
LOG_FILE="/var/log/wg-sentinel.log"
# Détecter la commande Docker Compose (v2 vs v1)
DOCKER_CMD="docker compose"
if ! $DOCKER_CMD version &>/dev/null; then
    DOCKER_CMD="docker-compose"
fi

API_URL="http://localhost:3000/api/system/health"

# Rotation simple des logs (max 10k lignes)
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE" 2>/dev/null || echo 0)" -gt 10000 ]; then
    tail -n 5000 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

# Cooldown alertes (600s = 10min)
COOLDOWN=600
LAST_ALERT_FILE="/tmp/sentinel_last_alert"

# Vérification des dépendances
for cmd in "curl" "docker"; do
    if ! command -v "$cmd" &>/dev/null; then
        log_event "[FATAL] Dépendance manquante : $cmd"
        exit 1
    fi
done

# Charger la configuration
if [ -f "$CONF_FILE" ]; then
    # shellcheck source=/dev/null
    source "$CONF_FILE"
fi

log_event() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"
}

send_telegram() {
    local now
    now=$(date +%s)
    local last_alert
    last_alert=$(cat "$LAST_ALERT_FILE" 2>/dev/null || echo 0)

    # Ne pas spammer si l'alerte est trop récente (sauf pour le démarrage)
    if [[ "$1" != "🚀"* ]] && (( now - last_alert < COOLDOWN )); then
        log_event "[INFO] Alerte Telegram mise en sourdine (Cooldown)."
        return 0
    fi

    if [[ -n "$TELEGRAM_BOT_TOKEN" && -n "$TELEGRAM_CHAT_ID" ]]; then
        local message="$1"
        if curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d "chat_id=${TELEGRAM_CHAT_ID}" \
            -d "text=💠 Sentinel Watchdog : ${message}" > /dev/null; then
            echo "$now" > "$LAST_ALERT_FILE"
        fi
    fi
}

check_health() {
    local response
    if ! response=$(curl -s --max-time 10 "$API_URL"); then
        log_event "[CRITICAL] API non répondante. Tentative d'Auto-Heal..."
        send_telegram "⚠️ API non répondante. Redémarrage des services..."
        $DOCKER_CMD -f "$(pwd)/docker-compose.yml" restart api ui
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
            $DOCKER_CMD -f "$(pwd)/docker-compose.yml" restart api
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

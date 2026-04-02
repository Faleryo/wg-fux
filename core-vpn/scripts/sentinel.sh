#!/bin/bash
# --- VIBE-OS : Sentinel Watchdog V2 (Elite SRE) ---

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/wg-common.sh"

LOG_FILE="/var/log/wg-sentinel.log"
HEARTBEAT_URL="http://localhost:3000/api/sentinel/heartbeat"
HEALTH_URL="http://localhost:3000/api/health"

# Docker command detection
DOCKER_CMD="docker compose"
if ! $DOCKER_CMD version &>/dev/null; then DOCKER_CMD="docker-compose"; fi

log_event() {
    local msg="$1"
    echo "$(date '+%Y-%m-%d %H:%M:%S') - $msg" >> "$LOG_FILE"
}

send_heartbeat() {
    local status="$1"
    local cpu=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}')
    local mem=$(free -m | awk '/Mem:/ {print $3}')
    local disk=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
    
    local payload=$(printf '{"status":"%s","stats":{"cpu":"%s","mem":"%s","disk":"%s"},"timestamp":"%s"}' \
        "$status" "$cpu" "$mem" "$disk" "$(date -Is)")
    
    curl -s -X POST -H "Content-Type: application/json" -d "$payload" "$HEARTBEAT_URL" > /dev/null
}

check_system() {
    # 1. API Health Check
    if ! response=$(curl -s --max-time 5 "$HEALTH_URL"); then
        log_event "[CRITICAL] API unreachable. Restarting infrastructure..."
        $DOCKER_CMD restart api ui || log_event "[ERROR] Failed to restart containers"
        send_heartbeat "recovering"
        return 1
    fi

    # 2. Database Integrity Check
    if [[ "$response" == *"unhealthy"* ]]; then
        log_event "[WARNING] System reports unhealthy state. Analyzing..."
        # Add specific healing logic here if needed
    fi

    send_heartbeat "healthy"
    return 0
}

# --- Main Loop ---
log_event "[INFO] Sentinel V2 started."
send_heartbeat "starting"

while true; do
    check_system
    sleep 30
done

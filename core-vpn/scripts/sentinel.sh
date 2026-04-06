#!/bin/bash
# --- VIBE-OS : Sentinel Watchdog v6.2 (Elite SRE) ---
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "$SCRIPT_DIR/wg-common.sh"

LOG_FILE="/var/log/wg-sentinel.log"
# Sentinel Token - Shared secret between this watchdog and the API
# SRE: Load from local env file if present (managed by setup.sh)
if [ -f "$SCRIPT_DIR/sentinel.env" ]; then
    source "$SCRIPT_DIR/sentinel.env"
fi
TOKEN="${SENTINEL_TOKEN:-vibe-sentinel-trust-99}"
HEARTBEAT_URL="http://localhost:3000/api/sentinel/heartbeat"
HEALTH_URL="http://localhost:3000/api/health"

# SRE Utilities
check_dependency "curl"
check_dependency "docker"

# Sentinel Token - Shared secret between this watchdog and the API
if [ -f "$SCRIPT_DIR/sentinel.env" ]; then
    source "$SCRIPT_DIR/sentinel.env"
fi
TOKEN="${SENTINEL_TOKEN:-vibe-sentinel-trust-99}"
HEARTBEAT_URL="http://localhost:3000/api/sentinel/heartbeat"
HEALTH_URL="http://localhost:3000/api/health"

send_heartbeat() {
    local status="$1"
    # Improved stats collection
    local cpu mem disk
    cpu=$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print 100 - $1}')
    mem=$(free -m | awk '/Mem:/ {print int($3/$2 * 100)}')
    disk=$(df / | awk 'NR==2 {print $5}' | sed 's/%//')
    
    local payload
    payload=$(printf '{"status":"%s","stats":{"cpu":"%s","mem":"%s","disk":"%s"},"timestamp":"%s"}' \
                     "$status" "$cpu" "$mem" "$disk" "$(date -Is)")
    
    curl -s -X POST -H "Content-Type: application/json" \
         -H "x-api-token: $TOKEN" \
         -d "$payload" "$HEARTBEAT_URL" > /dev/null
}

check_system() {
    # 1. API Health Check
    if ! response=$(curl -s --max-time 5 "$HEALTH_URL"); then
        log_error "[Sentinel] API unreachable. Verifying container state..."
        
        # SRE: Better healing. Don't restart if container is healthy but slow.
        if ! sudo docker ps | grep -q "wg-fux-api"; then
            log_error "[Sentinel] API Container is DOWN. Attempting RESTART..."
            send_telegram_msg "CRITICAL: API Container is DOWN. Attempting automatic recovery..." "ERROR"
            sudo docker compose restart api 2>/dev/null || log_error "Failed to restart API container."
        else
            log_warn "[Sentinel] API is unreachable but container is running (Overload?). Waiting..."
        fi
        
        send_heartbeat "recovering"
        return 1
    fi

    # 2. Database Integrity Check
    if [[ "$response" == *"unhealthy"* ]]; then
        log_warn "[Sentinel] System reports unhealthy state. Analyzing..."
        send_telegram_msg "WARNING: System health check failed (Unhealthy state)." "WARN"
    fi

    send_heartbeat "healthy"
    return 0
}

# --- Main Loop ---
log_info "Sentinel Watchdog ($VERSION) started."
send_heartbeat "starting"

while true; do
    check_system
    sleep 30
done

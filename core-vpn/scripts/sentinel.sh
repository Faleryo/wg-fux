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

# Docker command detection
DOCKER_CMD="docker compose"
if ! "$DOCKER_CMD" version &>/dev/null; then DOCKER_CMD="docker-compose"; fi

# SRE Note: log_event encapsulates standard logging and local file persistence
log_event() {
    local level="${2:-INFO}"
    local msg="$1"
    
    case "$level" in
        "ERROR") log_error "Sentinel: $msg" ;;
        "WARN")  log_warn "Sentinel: $msg" ;;
        *)       log_info "Sentinel: $msg" ;;
    esac

    # Local file audit
    if [ -w "$LOG_FILE" ]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') - [$level] $msg" >> "$LOG_FILE"
    fi
}

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
        log_error "Sentinel: API unreachable. Restarting infrastructure..."
        log_event "[CRITICAL] API unreachable. Restarting infrastructure..."
        "$DOCKER_CMD" restart api ui || log_event "[ERROR] Failed to restart containers"
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

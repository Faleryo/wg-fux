#!/bin/bash
# --- VIBE-OS : Sentinel Watchdog v6.2 (Elite SRE) ---
# NOTE: Pas de set -euo pipefail — ce watchdog doit survivre aux erreurs transitoires.

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck disable=SC1091
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

# Sentinel Token - Shared secret between this watchdog and the API
# SRE: Load from local env file if present (managed by setup.sh)
if [ -f "$SCRIPT_DIR/sentinel.env" ]; then
    # shellcheck disable=SC1091
    source "$SCRIPT_DIR/sentinel.env"
fi
TOKEN="${SENTINEL_TOKEN:-vibe-sentinel-trust-99}"
HEARTBEAT_URL="http://localhost:3000/api/sentinel/heartbeat"
HEALTH_URL="http://localhost:3000/api/health"

# SRE Utilities
check_dependency "curl"
check_dependency "docker"

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
    # 1. API Health Check (Internal Port 3000)
    if ! response=$(curl -s --max-time 5 "$HEALTH_URL"); then
        log_error "[Sentinel] API unreachable. Verifying container state..."
        
        if ! sudo docker ps --format '{{.Names}}' | grep -q "wg-fux-api"; then
            log_error "[Sentinel] API Container is DOWN. Attempting RESTART..."
            send_telegram_msg "CRITICAL: API Container is DOWN. Attempting automatic recovery..." "ERROR"
            sudo docker compose restart api 2>/dev/null || log_error "Failed to restart API container."
        else
            log_warn "[Sentinel] API is unreachable but container is running (Overload/Ghost). Force Restarting..."
            sudo docker compose restart api 2>/dev/null
        fi
        send_heartbeat "recovering"
        return 1
    fi

    # 2. Database & Application Integrity Check
    if [[ "$response" == *"unhealthy"* ]]; then
        log_warn "[Sentinel] API reports internal unhealthiness. Analyzing..."
        send_telegram_msg "WARNING: API internal health check failed." "WARN"
    fi

    # 3. Full Infrastructure Scan (Docker Health)
    local unhealthy_containers
    unhealthy_containers=$(sudo docker ps --filter "health=unhealthy" --format "{{.Names}}")
    
    if [ -n "$unhealthy_containers" ]; then
        for container in $unhealthy_containers; do
            log_sre "Unhealthy service detected: $container. Triggering Autonomic Healing..."
            send_telegram_msg "AUTONOMIC HEALING: Service $container is unhealthy. Restarting..." "WARN"
            sudo docker restart "$container" 2>/dev/null
        done
    fi

    # 4. Critical Service Presence Cloud-Check (Nginx/DNS/UI)
    for service in "wg-sentinel-proxy" "wg-fux-dashboard" "wg-fux-dns"; do
        if ! sudo docker ps --format '{{.Names}}' | grep -q "^$service$"; then
            log_error "[Sentinel] $service is MISSING. Recovery initiated..."
            send_telegram_msg "CRITICAL: Service $service is DOWN. Reviving..." "ERROR"
            # Extraction du nom de service compose depuis le nom du conteneur (ex: wg-fux-dns -> dns, wg-sentinel-proxy -> nginx)
            case "$service" in
                "wg-sentinel-proxy") COMPOSE_SVC="nginx" ;;
                "wg-fux-dashboard") COMPOSE_SVC="ui" ;;
                "wg-fux-dns") COMPOSE_SVC="adguard" ;;
                *) COMPOSE_SVC="" ;;
            esac
            if [ -n "$COMPOSE_SVC" ]; then
                sudo docker compose up -d "$COMPOSE_SVC" 2>/dev/null || \
                sudo docker compose up -d 2>/dev/null || true
            else
                sudo docker compose up -d 2>/dev/null || true
            fi
        fi
    done

    send_heartbeat "healthy"
    return 0
}

# --- Main Loop ---
log_sre "Sentinel Watchdog ($VERSION) started with Autonomic Healing Mode."
send_heartbeat "starting"

while true; do
    check_system
    sleep 30
done

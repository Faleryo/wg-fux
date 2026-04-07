#!/bin/bash

# WG-FUX v6.3 "The Watcher's Eye"
# SRE Brick: Self-Healing Watchdog (Blast-Radius Protected)

CHECK_INTERVAL=60
API_URL="http://localhost:3000/api/health"
ADGUARD_URL="http://localhost:3002"
LOG_FILE="/home/faleryo/wg-fux/logs/watchdog.log"
PID_FILE="/tmp/wg-fux-watchdog.pid"

mkdir -p "$(dirname "$LOG_FILE")"

log_event() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [WATCHDOG] $1" | tee -a "$LOG_FILE"
}

# PID Protection: Ensure only one instance runs
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null; then
        log_event "⚠️ Watchdog already running with PID $PID. Exiting."
        exit 1
    fi
fi
echo $$ > "$PID_FILE"

log_event "🚀 Vibe-OS Watcher Started (PID: $$)"

check_api() {
    # Verify both connectivity AND SRE health check (scripts availability)
    HEALTH_RESP=$(curl -sf --max-time 10 "$API_URL")
    if [ $? -ne 0 ]; then
        log_event "⚠️ WARNING: API connection failed. Restarting..."
        docker compose restart api
    else
        STATUS=$(echo "$HEALTH_RESP" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
        if [ "$STATUS" != "healthy" ]; then
            log_event "🚨 CRITICAL: API is $STATUS (Script integrity failure). Investigating..."
            # For now, just restart to attempt recovery
            docker compose restart api
        fi
    fi
}

check_adguard() {
    if ! curl -sf --max-time 10 "$ADGUARD_URL" > /dev/null; then
        log_event "⚠️ WARNING: AdGuard UI is unresponsive. Restarting..."
        docker compose restart adguard
    fi
}

trap 'rm -f "$PID_FILE"; log_event "🛑 Watchdog stopped."; exit' SIGINT SIGTERM

while true; do
    check_api
    check_adguard
    sleep "$CHECK_INTERVAL"
done

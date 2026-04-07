#!/bin/bash
# --- VIBE-OS v6.2 : WireGuard Monitor ---
# GHOST-SCAN FIX v6.2:
#   - Added 'set -euo pipefail' for robust shell execution.
#   - Fixed: Unquoted variables ($STATE_FILE, $INTERFACE).
#   - Fixed: Missing quotes on awk pipelines.
#   - Added HEALING LOOP: check if interface is alive before each cycle.

set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

if [ -f /etc/wireguard/manager.conf ]; then
    source /etc/wireguard/manager.conf
fi

STATE_FILE="/var/run/wg-monitor.state"
DB_FILE="${WG_DB_PATH:-${API_DATA_DIR:-/app/data}/wg-fux.db}"
INTERFACE="${WG_INTERFACE:-wg0}"
touch "$STATE_FILE"

# Check if sqlite3 is installed
if ! command -v sqlite3 &> /dev/null; then
    log_error "sqlite3 is required but not installed." "$ERR_SYSTEM_FAILURE"
fi

while true; do
    NOW=$(date +%s)

    # --- 🛡️ HEALING LOOP (Autonomic SRE) ---
    # If interface is down, log a warning and wait for next cycle instead of crashing.
    if ! ip link show "$INTERFACE" > /dev/null 2>&1; then
        log_warn "[HEALING] Interface $INTERFACE not found. Skipping monitor cycle. Retrying in 60s..."
        sleep 60
        continue
    fi

    # Read WireGuard dump (skip interface header line)
    while read -r line; do
        PUB_KEY=$(echo "$line" | awk '{print $1}')
        HANDSHAKE=$(echo "$line" | awk '{print $5}')
        ENDPOINT=$(echo "$line" | awk '{print $3}')
        ALLOWED_IPS=$(echo "$line" | awk '{print $4}')

        [ -z "$PUB_KEY" ] && continue
        if [ "$HANDSHAKE" -eq 0 ] 2>/dev/null; then continue; fi

        DIFF=$((NOW - HANDSHAKE))

        CACHE_FILE="/var/run/wg-peer-cache.json"
        CLIENT_NAME="Inconnu"
        CONTAINER_NAME="Inconnu"
        USAGE_TOTAL=0

        if [ -f "$CACHE_FILE" ] && command -v jq &>/dev/null; then
            CM_DATA=$(jq -r ".\"$PUB_KEY\" // empty" "$CACHE_FILE")
            if [ -n "$CM_DATA" ]; then
                CLIENT_NAME=$(echo "$CM_DATA" | jq -r ".name")
                CONTAINER_NAME=$(echo "$CM_DATA" | jq -r ".container")
                USAGE_DATA=$(sqlite3 "$DB_FILE" "SELECT total FROM usage WHERE publicKey='$PUB_KEY';" 2>/dev/null || echo "0")
                USAGE_TOTAL="${USAGE_DATA:-0}"
            fi
        fi

        LAST_STATE=$(grep "$PUB_KEY" "$STATE_FILE" | awk '{print $2}' || echo "")

        # If handshake < 3 min (180s), considered connected
        if [ "$DIFF" -lt 180 ]; then
            if [ "$LAST_STATE" != "CONNECTED" ]; then
                sqlite3 "$DB_FILE" "INSERT INTO logs (timestamp, status, container, name, virtualIp, realIp, usageTotal) VALUES (strftime('%s','now')*1000, 'CONNECTED', '$CONTAINER_NAME', '$CLIENT_NAME', '$ALLOWED_IPS', '$ENDPOINT', $USAGE_TOTAL);" 2>/dev/null || true
                if [ -x /usr/local/bin/wg-send-msg.sh ]; then
                    /usr/local/bin/wg-send-msg.sh "🔌 VPN: $CLIENT_NAME connecté ($ENDPOINT)" || true
                fi
                sed -i "/$PUB_KEY/d" "$STATE_FILE"
                echo "$PUB_KEY CONNECTED" >> "$STATE_FILE"
            fi
        else
            if [ "$LAST_STATE" == "CONNECTED" ]; then
                sqlite3 "$DB_FILE" "INSERT INTO logs (timestamp, status, container, name, virtualIp, realIp, usageTotal) VALUES (strftime('%s','now')*1000, 'DISCONNECTED', '$CONTAINER_NAME', '$CLIENT_NAME', '$ALLOWED_IPS', '$ENDPOINT', $USAGE_TOTAL);" 2>/dev/null || true
                if [ -x /usr/local/bin/wg-send-msg.sh ]; then
                    /usr/local/bin/wg-send-msg.sh "🔌 VPN: $CLIENT_NAME déconnecté" || true
                fi
                sed -i "/$PUB_KEY/d" "$STATE_FILE"
                echo "$PUB_KEY DISCONNECTED" >> "$STATE_FILE"
            fi
        fi
    done < <(wg show "$INTERFACE" dump 2>/dev/null | tail -n +2)

    sleep 60
done

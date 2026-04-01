#!/bin/bash
# --- VIBE-OS : WireGuard Stats Bridge ---

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/wg-common.sh"

check_root

IFACE="${1:-wg0}"
USE_JSON=0

# Shift args to check for --json
for arg in "$@"; do
    if [ "$arg" == "--json" ]; then
        USE_JSON=1
    fi
done

if [ "$USE_JSON" -eq 1 ]; then
    # Header check
    if ! ip link show "$IFACE" > /dev/null 2>&1; then
        log_error "Interface $IFACE not found" "$ERR_NOT_FOUND"
    fi

    DUMP=$(wg show "$IFACE" dump)
    NOW=$(date +%s)
    
    echo "["
    FIRST=1
    while IFS=$'\t' read -r pub psk endpoint allowed_ips handshake rx tx keepalive; do
        [ -z "$pub" ] && continue
        
        if [ "$FIRST" -eq 0 ]; then echo ","; fi
        
        is_online="false"
        if [ "$handshake" -gt 0 ] && [ $((NOW - handshake)) -lt 180 ]; then
            is_online="true"
        fi

        printf '  {
    "publicKey": "%s",
    "endpoint": "%s",
    "allowedIps": "%s",
    "lastHandshake": %d,
    "rx": %d,
    "tx": %d,
    "isOnline": %s,
    "keepalive": "%s"
  }' "$pub" "$endpoint" "$allowed_ips" "$handshake" "$rx" "$tx" "$is_online" "$keepalive"
        
        FIRST=0
    done <<< "$DUMP"
    echo -e "\n]"
else
    # Standard output
    /usr/bin/wg show "$IFACE"
fi

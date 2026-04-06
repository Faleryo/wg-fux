#!/bin/bash
# --- VIBE-OS : WireGuard Stats Bridge ---
# BUG-FIX: La 1ère ligne de "wg show dump" contient les infos INTERFACE (pas un peer).
#           Elle était incluse dans le JSON → objet malformé avec des champs vides.
#           Fix: skip the first line (interface line) before processing peers.

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/wg-common.sh"

check_root

IFACE=""
USE_JSON=0

for arg in "$@"; do
    if [ "$arg" == "--json" ]; then
        USE_JSON=1
    else
        # The first non-flag argument is the interface
        if [ -z "$IFACE" ]; then
            IFACE="$arg"
        fi
    fi
done

# Default to wg0 if no interface specified
IFACE="${IFACE:-wg0}"

if [ "$USE_JSON" -eq 1 ]; then
    if ! ip link show "$IFACE" > /dev/null 2>&1; then
        # BUG-FIX: Dashbaord Critical Error immunity. Return [] instead of crashing.
        echo "[]"
        exit 0
    fi

    # BUG-FIX: Skip the first line (interface info: private-key public-key listen-port fwmark)
    # wg show <iface> dump outputs:
    #   Line 1: <private-key> <public-key> <listen-port> <fwmark>  (interface)
    #   Line 2+: <public-key> <psk> <endpoint> <allowed-ips> <handshake> <rx> <tx> <keepalive>  (peers)
    DUMP=$(wg show "$IFACE" dump | tail -n +2)
    NOW=$(date +%s)

    # Handle empty (no peers)
    if [ -z "$DUMP" ]; then
        echo "[]"
        exit 0
    fi

    echo "["
    FIRST=1
    while IFS=$'\t' read -r pub _psk endpoint allowed_ips handshake rx tx keepalive; do
        [ -z "$pub" ] && continue

        if [ "$FIRST" -eq 0 ]; then echo ","; fi

        is_online="false"
        # handshake=0 means never connected
        actual_handshake=${handshake:-0}
        if [ "$actual_handshake" -gt 0 ] && [ $((NOW - actual_handshake)) -lt 180 ]; then
            is_online="true"
        fi

        # DIAMOND STABILIZATION: Force default 0 for numeric fields to avoid printf errors
        printf '  {
    "publicKey": "%s",
    "endpoint": "%s",
    "allowedIps": "%s",
    "lastHandshake": %d,
    "rx": %d,
    "tx": %d,
    "isOnline": %s,
    "keepalive": "%s",
    "lastSeen": %d
  }' "$pub" "$endpoint" "$allowed_ips" "${actual_handshake:-0}" "${rx:-0}" "${tx:-0}" "$is_online" "${keepalive:-0}" "${actual_handshake:-0}"

        FIRST=0
    done <<< "$DUMP"
    echo -e "\n]"
else
    # Standard output
    /usr/bin/wg show "$IFACE"
fi

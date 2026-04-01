#!/bin/bash
# --- VIBE-OS : WireGuard Stats Bridge ---
# BUG-FIX: La 1ère ligne de "wg show dump" contient les infos INTERFACE (pas un peer).
#           Elle était incluse dans le JSON → objet malformé avec des champs vides.
#           Fix: skip the first line (interface line) before processing peers.

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/wg-common.sh"

check_root

IFACE="${1:-wg0}"
USE_JSON=0

for arg in "$@"; do
    if [ "$arg" == "--json" ]; then
        USE_JSON=1
    fi
done

if [ "$USE_JSON" -eq 1 ]; then
    if ! ip link show "$IFACE" > /dev/null 2>&1; then
        log_error "Interface $IFACE not found" "$ERR_NOT_FOUND"
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
    while IFS=$'\t' read -r pub psk endpoint allowed_ips handshake rx tx keepalive; do
        [ -z "$pub" ] && continue

        if [ "$FIRST" -eq 0 ]; then echo ","; fi

        is_online="false"
        # handshake=0 means never connected
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
    "keepalive": "%s",
    "lastSeen": %d
  }' "$pub" "$endpoint" "$allowed_ips" "$handshake" "${rx:-0}" "${tx:-0}" "$is_online" "$keepalive" "$handshake"

        FIRST=0
    done <<< "$DUMP"
    echo -e "\n]"
else
    # Standard output
    /usr/bin/wg show "$IFACE"
fi

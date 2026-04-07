#!/bin/bash
# --- VIBE-OS : Peer Toggle v6.2 (Elite SRE) ---
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

INTERFACE=$1
COMMAND=$2
PEER=$3
ACTION=$4
VALUE=${5:-""}

# Validation
if [[ ! "$INTERFACE" =~ ^[a-zA-Z0-9_\-]+$ ]]; then log_error "Toggle: Invalid interface $INTERFACE"; exit 1; fi
if [[ "$COMMAND" != "peer" ]]; then log_error "Toggle: Only 'peer' command allowed"; exit 1; fi
if [[ ! "$PEER" =~ ^[a-zA-Z0-9+/=]+$ ]]; then log_error "Toggle: Invalid peer public key"; exit 1; fi

if [[ "$ACTION" == "remove" ]]; then
    # Idempotence: ignore failure if peer is NOT in the interface (already removed)
    /usr/bin/wg set "$INTERFACE" peer "$PEER" remove 2>/dev/null || true
elif [[ "$ACTION" == "allowed-ips" ]]; then
    if [[ ! "$VALUE" =~ ^[a-fA-F0-9:.,/\ ]+$ ]]; then log_error "Toggle: Invalid AllowedIPs"; exit 1; fi
    /usr/bin/wg set "$INTERFACE" peer "$PEER" allowed-ips "$VALUE" || { log_warn "Toggle: allowed-ips set failed (check if peer exists)"; }
else
    log_error "Toggle: Unsupported action '$ACTION'"; exit 1; fi

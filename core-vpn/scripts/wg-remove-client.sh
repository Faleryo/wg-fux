#!/bin/bash
# --- VIBE-OS : Remove Client ---

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/wg-common.sh"

check_root
load_config

CONTAINER="$1"
NAME="$2"

validate_id "$CONTAINER"
validate_id "$NAME"

CLIENT_DIR="/etc/wireguard/clients/$CONTAINER/$NAME"

if [ ! -d "$CLIENT_DIR" ]; then
    log_warn "Client '$NAME' in container '$CONTAINER' does not exist. Already removed?"
    exit 0 # Idempotence
fi

if [ -f "$CLIENT_DIR/public.key" ]; then
    PUBKEY=$(cat "$CLIENT_DIR/public.key" | tr -d '[:space:]')
    if [ -n "$PUBKEY" ]; then
        log_info "Removing peer $PUBKEY from $WG_INTERFACE..."
        # We don't want this to fail the whole script if the peer is already gone from wg interface
        wg set "$WG_INTERFACE" peer "$PUBKEY" remove 2>/dev/null || log_warn "Peer $PUBKEY not found in $WG_INTERFACE (skipping interface removal)"
    fi
fi

rm -rf "$CLIENT_DIR"
log_info "Client directory $CLIENT_DIR deleted."

# Refresh QoS rules
$SCRIPT_DIR/wg-apply-qos.sh || true

log_info "Client '$NAME' removed successfully."

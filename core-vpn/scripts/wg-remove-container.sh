#!/bin/bash
# --- VIBE-OS : Remove Container ---

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

set -euo pipefail

check_root
load_config

CONTAINER="${1:-}"
if [ -z "$CONTAINER" ]; then 
    log_warn "Usage: $0 <container_name>"
    exit 1
fi
validate_id "$CONTAINER"

TARGET_DIR="/etc/wireguard/clients/$CONTAINER"
if [ ! -d "$TARGET_DIR" ]; then 
    log_info "Container $CONTAINER does not exist (idempotent)."
    exit 0
fi

log_info "Removing all clients in container '$CONTAINER'..."
# Use a subshell or while loop to safely handle peer removal
while IFS= read -r keyfile; do
    PUBKEY=$(cat "$keyfile" | tr -d '[:space:]')
    if [ -n "$PUBKEY" ]; then
        log_info "Removing peer $PUBKEY from $WG_INTERFACE..."
        wg set "$WG_INTERFACE" peer "$PUBKEY" remove 2>/dev/null || true
    fi
done < <(find "$TARGET_DIR" -name "public.key" 2>/dev/null)

rm -rf "$TARGET_DIR"
# Refresh QoS rules to clean up deleted clients
"$SCRIPT_DIR/wg-apply-qos.sh" || true
log_success "Container '$CONTAINER' removed successfully."

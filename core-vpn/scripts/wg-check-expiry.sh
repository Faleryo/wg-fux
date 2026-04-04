#!/bin/bash
# --- VIBE-OS : Check Expiry v6.2 (Elite SRE) ---
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "$SCRIPT_DIR/wg-common.sh"

WG_INTERFACE=${WG_INTERFACE:-wg0}

if [ -f /etc/wireguard/manager.conf ]; then source /etc/wireguard/manager.conf; fi

# Simple cleanup logic (the full logic is in wg-enforcer.sh)
log_info "Running expiry check via enforcer..."
"$SCRIPT_DIR/wg-enforcer.sh"

#!/bin/bash
# --- : Check Expiry v6.2 (SRE) ---
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

check_root
load_config
WG_INTERFACE=${WG_INTERFACE:-wg0}

# Simple cleanup logic (the full logic is in wg-enforcer.sh)
log_info "Running expiry check via enforcer..."
"$SCRIPT_DIR/wg-enforcer.sh"

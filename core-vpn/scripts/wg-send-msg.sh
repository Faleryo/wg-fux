#!/bin/bash
# --- VIBE-OS : Security Alert Bridge (Unified v6.5) ---

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

MESSAGE="${1:-"No message provided"}"

# Delegation to centralized common utility
send_telegram_msg "$MESSAGE"

exit 0

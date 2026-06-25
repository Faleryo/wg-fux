#!/bin/bash
# --- : Security Alert Bridge (Unified v6.5) ---

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
set -euo pipefail
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

MESSAGE="${1:-"No message provided"}"

# Delegation to centralized common utility
if send_telegram_msg "$MESSAGE"; then
  exit 0
else
  exit 1
fi

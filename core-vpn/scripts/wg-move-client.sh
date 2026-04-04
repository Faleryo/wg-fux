#!/bin/bash
# --- VIBE-OS : Move Client v6.2 (Elite SRE) ---
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "$SCRIPT_DIR/wg-common.sh"

check_root
load_config

OLD_CONTAINER="${1:-}"
NAME="${2:-}"
NEW_CONTAINER="${3:-}"

if [[ ! "$OLD_CONTAINER" =~ ^[a-zA-Z0-9_\-]+$ || ! "$NEW_CONTAINER" =~ ^[a-zA-Z0-9_\-]+$ ]]; then
    log_error "Invalid container name."
    exit 1
fi

if [[ ! "$NAME" =~ ^[a-zA-Z0-9_\-]+$ ]]; then
    log_error "Invalid client name."
    exit 1
fi

BASE_DIR="/etc/wireguard/clients"
SRC="$BASE_DIR/$OLD_CONTAINER/$NAME"
DEST_PARENT="$BASE_DIR/$NEW_CONTAINER"
DEST="$DEST_PARENT/$NAME"

if [ ! -d "$SRC" ]; then log_error "Source client not found"; exit 1; fi
if [ ! -d "$DEST_PARENT" ]; then log_error "Destination container not found"; exit 1; fi
if [ -d "$DEST" ]; then log_error "Client already exists in destination"; exit 1; fi

mv "$SRC" "$DEST"
chown root:wg-api "$DEST"
chmod 750 "$DEST"
chown root:wg-api "$DEST/$NAME.conf"
chmod 640 "$DEST/$NAME.conf"
chown root:wg-api "$DEST/public.key"
chmod 640 "$DEST/public.key"
chown root:root "$DEST/private.key" "$DEST/preshared.key" 2>/dev/null || true
chmod 600 "$DEST/private.key" "$DEST/preshared.key" 2>/dev/null || true
sync
echo "Client moved"

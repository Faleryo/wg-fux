#!/bin/bash
# --- : Move Client v6.2 (SRE) ---
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
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

mv "$SRC" "$DEST" || { log_error "Failed to move client directory"; exit 1; }

# Permissions/ownership IDENTIQUES à wg-create-client.sh : la dir doit rester
# possédée par wg-api (l'API la lit directement). L'ancien code la passait en
# root:wg-api 750 et le .conf (qui contient la PrivateKey) en 640 lisible par le
# groupe — incohérent avec la création (700 / 600 / propriété wg-api).
_WG_API_UID=$(id -u wg-api 2>/dev/null || echo 1001)
_WG_API_GID=$(id -g wg-api 2>/dev/null || echo 1001)
chown -R "$_WG_API_UID:$_WG_API_GID" "$DEST" 2>/dev/null || true
chmod 700 "$DEST"
chmod 640 "$DEST/"* 2>/dev/null || true
chmod 600 "$DEST/private.key" "$DEST/preshared.key" "$DEST/$NAME.conf" 2>/dev/null || true
echo "Client moved successfully"

#!/bin/bash
# --- : Create Container v6.3 (Frontier Explorer) ---
set -euo pipefail

CONTAINER="${1:-}"
CPU_LIMIT="${2:-}"
MEM_LIMIT="${3:-}"

if [ -z "$CONTAINER" ]; then echo "Error: Container name required"; exit 1; fi
if [[ ! "$CONTAINER" =~ ^[a-zA-Z0-9_\-]+$ ]]; then echo "Error: Invalid container name"; exit 1; fi

BASE_DIR="/etc/wireguard/clients"
TARGET_DIR="$BASE_DIR/$CONTAINER"

if [ -d "$TARGET_DIR" ]; then
 echo "Container $CONTAINER already exists"
 exit 0
fi

mkdir -p "$TARGET_DIR"
# Use UID of wg-api user for Docker compatibility
_WG_API_UID=$(id -u wg-api 2>/dev/null || echo 1001)
_WG_API_GID=$(id -g wg-api 2>/dev/null || echo 1001)
chown "$_WG_API_UID:$_WG_API_GID" "$TARGET_DIR"
chmod 775 "$TARGET_DIR"

# BLAST-RADIUS: Define resource limits metadata for the SRE engine
LIMITS_FILE="$TARGET_DIR/limits.conf"
echo "CPU_LIMIT=${CPU_LIMIT:-unlimited}" > "$LIMITS_FILE"
echo "MEM_LIMIT=${MEM_LIMIT:-unlimited}" >> "$LIMITS_FILE"

echo "Container $CONTAINER created at $TARGET_DIR with Blast Radius limits."

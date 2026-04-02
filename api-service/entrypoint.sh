#!/bin/bash
set -e

# Interface configuration
INTERFACE=${WG_INTERFACE:-wg0}
CONFIG="/etc/wireguard/${INTERFACE}.conf"

# Ensure WireGuard is up
if [ -f "$CONFIG" ]; then
    echo "[BOOT] Starting WireGuard interface: ${INTERFACE}..."
    ip link delete "$INTERFACE" 2>/dev/null || true
    wg-quick up "$INTERFACE" || echo "[ERROR] Failed to start interface: ${INTERFACE}"
else
    echo "[BOOT] No configuration found at: ${CONFIG}"
fi

# BUG-FIX: Ensure SQLite DB belongs to wg-api
echo "[BOOT] Ensuring database permissions for wg-api..."
mkdir -p /app/data
chown -R wg-api:wg-api /app/data
chmod -R u+rw /app/data

echo "[BOOT] Starting API Server..."
exec node server.js

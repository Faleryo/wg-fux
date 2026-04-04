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

# BUG-FIX: Ensure SQLite DB and Client Configs belong to wg-api
echo "[BOOT] Ensuring system permissions for wg-api..."
mkdir -p /app/data
mkdir -p /etc/wireguard/clients
chown -R wg-api:wg-api /app/data /etc/wireguard/clients
chmod -R u+rw /app/data /etc/wireguard/clients

echo "[BOOT] Starting API Server as wg-api..."
exec runuser -u wg-api -- node server.js

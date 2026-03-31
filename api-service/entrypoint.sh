#!/bin/bash
set -e

# Interface configuration
INTERFACE=${WG_INTERFACE:-wg0}
CONFIG="/etc/wireguard/${INTERFACE}.conf"

# Ensure WireGuard is up
if [ -f "$CONFIG" ]; then
    echo "[BOOT] Starting WireGuard interface: ${INTERFACE}..."
    # Kill any existing interface to avoid conflicts
    ip link delete "$INTERFACE" 2>/dev/null || true
    wg-quick up "$INTERFACE" || echo "[ERROR] Failed to start interface: ${INTERFACE}"
else
    echo "[BOOT] No configuration found at: ${CONFIG}"
fi

# Apply optimizations
if [ -x "/usr/local/bin/wg-optimize.sh" ]; then
    /usr/local/bin/wg-optimize.sh || true
fi

echo "[BOOT] Starting API Server..."
exec node server.js

#!/bin/bash
set -e

# SRE: Hardening permissions for WireGuard
chmod 600 /etc/wireguard/*.conf 2>/dev/null || true

# Ensure system logs belong to wg-api
chown wg-api:wg-api /var/log/wg-*.log 2>/dev/null || true

# Ensure system permissions for wg-api data
mkdir -p /app/data /etc/wireguard/clients
chown -R wg-api:wg-api /app/data /etc/wireguard/clients
chmod -R u+rw /app/data /etc/wireguard/clients

echo "[BOOT] Starting API Server as wg-api..."
# Use login shell to ensure PATH is correctly loaded
# Syntax fix: -l and -u are exclusive on some runuser versions
exec runuser -m -u wg-api -- node /app/server.js

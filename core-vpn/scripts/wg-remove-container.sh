#!/bin/bash
CONTAINER=$1
if [ -z "$CONTAINER" ]; then echo "Error: Container name required"; exit 1; fi
if [[ ! "$CONTAINER" =~ ^[a-zA-Z0-9_\-]+$ ]]; then echo "Error: Invalid container name"; exit 1; fi

TARGET_DIR="/etc/wireguard/clients/$CONTAINER"
if [ ! -d "$TARGET_DIR" ]; then echo "Container $CONTAINER does not exist"; exit 0; fi

# Load config
if [ -f /etc/wireguard/manager.conf ]; then
    source /etc/wireguard/manager.conf
fi
WG_INTERFACE=${WG_INTERFACE:-wg0}

echo "Removing clients in $CONTAINER..."
find "$TARGET_DIR" -name "public.key" 2>/dev/null | while read keyfile; do
    PUBKEY=$(cat "$keyfile")
    echo "Removing peer $PUBKEY"
    wg set "$WG_INTERFACE" peer "$PUBKEY" remove
done
rm -rf "$TARGET_DIR"
# Refresh QoS rules to clean up deleted clients
/usr/local/bin/wg-apply-qos.sh
echo "Container $CONTAINER removed"

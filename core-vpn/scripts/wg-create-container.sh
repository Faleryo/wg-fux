#!/bin/bash
CONTAINER=$1
if [ -z "$CONTAINER" ]; then echo "Error: Container name required"; exit 1; fi
if [[ ! "$CONTAINER" =~ ^[a-zA-Z0-9_\-]+$ ]]; then echo "Error: Invalid container name"; exit 1; fi

BASE_DIR="/etc/wireguard/clients"
TARGET_DIR="$BASE_DIR/$CONTAINER"

if [ -d "$TARGET_DIR" ]; then echo "Container $CONTAINER already exists"; exit 0; fi

    mkdir -p "$TARGET_DIR"
    chown root:wg-api "$TARGET_DIR"
    chmod 750 "$TARGET_DIR"
    chmod 755 "$TARGET_DIR"
    echo "Container $CONTAINER created at $TARGET_DIR"

#!/bin/bash
# Ce script verifie les dates d'expiration et les quotas de donnees
BASE_DIR="/etc/wireguard/clients"
WG_INTERFACE=${WG_INTERFACE:-wg0}
LOG_FILE="/var/log/wg-check-expiry.log"
if [ -f /etc/wireguard/manager.conf ]; then source /etc/wireguard/manager.conf; fi

log() {
    echo "$(date): $1" >> "$LOG_FILE"
}

# Simple cleanup logic (the full logic is in wg-enforcer.sh)
/usr/local/bin/wg-enforcer.sh

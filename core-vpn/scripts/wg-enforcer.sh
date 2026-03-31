#!/bin/bash
# Load config
if [ -f /etc/wireguard/manager.conf ]; then
    source /etc/wireguard/manager.conf
fi
WG_INTERFACE="${WG_INTERFACE:-wg0}"
WG_INTERFACE="${WG_INTERFACE:-wg0}"
DB_FILE="/home/faleryo/ai/api-service/data/wg-fux.db"
CLIENTS_DIR="/etc/wireguard/clients"
LOG_FILE="/var/log/wg-enforcer.log"
NOW=$(date +%s)

# Check if sqlite3 is installed
if ! command -v sqlite3 &> /dev/null; then
    echo "ERROR: sqlite3 is required but not installed." >&2
    exit 1
fi

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') - $1" >> "$LOG_FILE"; }

# 1. Update Peer Cache (for monitor and enforcer speed)
CACHE_FILE="/var/run/wg-peer-cache.json"
echo "{" > "$CACHE_FILE"
FIRST=1
find "$CLIENTS_DIR" -name "public.key" 2>/dev/null | while read keyfile; do
    PUBKEY=$(cat "$keyfile" | tr -d '[:space:]')
    CLIENT_DIR=$(dirname "$keyfile")
    CLIENT_NAME=$(basename "$CLIENT_DIR")
    CONTAINER_NAME=$(basename $(dirname "$CLIENT_DIR"))
    if [ "$FIRST" -eq 1 ]; then FIRST=0; else echo "," >> "$CACHE_FILE"; fi
    echo "  \"$PUBKEY\": {\"name\": \"$CLIENT_NAME\", \"container\": \"$CONTAINER_NAME\", \"path\": \"$CLIENT_DIR\"}" >> "$CACHE_FILE"
done
echo "}" >> "$CACHE_FILE"

# 2. Enforce Limits
STATS=$(wg show "$WG_INTERFACE" dump)

find "$CLIENTS_DIR" -name "public.key" 2>/dev/null | while read keyfile; do
    PUBKEY=$(cat "$keyfile" | tr -d '[:space:]')
    CLIENT_DIR=$(dirname "$keyfile")
    CLIENT_NAME=$(basename "$CLIENT_DIR")
    
    # Check current limits
    IS_EXPIRED=0
    IS_QUOTA_EXCEEDED=0
    
    if [ -f "$CLIENT_DIR/expiry" ]; then
        EXP_DATE=$(cat "$CLIENT_DIR/expiry")
        [ -n "$EXP_DATE" ] && EXP_TS=$(date -d "$EXP_DATE" +%s 2>/dev/null)
        if [ -n "$EXP_TS" ] && [ "$NOW" -ge "$EXP_TS" ]; then IS_EXPIRED=1; fi
    fi
    
    if [ -f "$CLIENT_DIR/quota" ]; then
        QUOTA_GB=$(cat "$CLIENT_DIR/quota")
        if [ -n "$QUOTA_GB" ] && [ "$QUOTA_GB" -gt 0 ]; then
            TOTAL_USED=$(sqlite3 "$DB_FILE" "SELECT total FROM usage WHERE publicKey='$PUBKEY';" 2>/dev/null || echo 0)
            QUOTA_BYTES=$((QUOTA_GB * 1024 * 1024 * 1024))
            if [ -n "$TOTAL_USED" ] && [ "$TOTAL_USED" -ge "$QUOTA_BYTES" ]; then IS_QUOTA_EXCEEDED=1; fi
        fi
    fi

    # LOGIC: If currently disabled but limits are now OK -> UNBAN
    if [ -f "$CLIENT_DIR/disabled" ]; then
        REASON=$(cat "$CLIENT_DIR/disabled")
        if [[ "$REASON" == "Expired" && "$IS_EXPIRED" -eq 0 ]] || [[ "$REASON" == "Quota exceeded" && "$IS_QUOTA_EXCEEDED" -eq 0 ]]; then
            log "Réactivation automatique : $CLIENT_NAME (Raison $REASON résolue)"
            rm -f "$CLIENTS_DIR/disabled"
            # Re-install peer to interface
            CONF_FILE=$(find "$CLIENT_DIR" -name "*.conf" | head -1)
            ALLOWED_IPS=$(cat "$CLIENT_DIR/allowed_ips.txt" 2>/dev/null)
            PSK="$CLIENT_DIR/preshared.key"
            if [ -n "$ALLOWED_IPS" ]; then
                wg set "$WG_INTERFACE" peer "$PUBKEY" preshared-key "$PSK" allowed-ips "$ALLOWED_IPS" 2>/dev/null
                rm -f "$CLIENT_DIR/disabled"
                /usr/local/bin/wg-apply-qos.sh 2>/dev/null
            fi
        fi
        continue
    fi

    # LOGIC: If currently active but limits reached -> BAN
    if [ "$IS_EXPIRED" -eq 1 ]; then
        log "Bannissement (Expiration) : $CLIENT_NAME"
        echo "Expired" > "$CLIENT_DIR/disabled"
        wg set "$WG_INTERFACE" peer "$PUBKEY" remove 2>/dev/null
        /usr/local/bin/wg-apply-qos.sh 2>/dev/null
    elif [ "$IS_QUOTA_EXCEEDED" -eq 1 ]; then
        log "Bannissement (Quota dépassé) : $CLIENT_NAME"
        echo "Quota exceeded" > "$CLIENT_DIR/disabled"
        wg set "$WG_INTERFACE" peer "$PUBKEY" remove 2>/dev/null
        /usr/local/bin/wg-apply-qos.sh 2>/dev/null
    fi
done

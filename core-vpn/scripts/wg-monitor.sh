#!/bin/bash
if [ -f /etc/wireguard/manager.conf ]; then
    source /etc/wireguard/manager.conf
fi
STATE_FILE="/var/run/wg-monitor.state"
# FIX: Chemin DB dynamique (même fix que wg-enforcer.sh)
DB_FILE="${WG_DB_PATH:-${API_DATA_DIR:-/app/data}/wg-fux.db}"
INTERFACE="${WG_INTERFACE:-wg0}"
touch $STATE_FILE

# Check if sqlite3 is installed
if ! command -v sqlite3 &> /dev/null; then
    echo "ERROR: sqlite3 is required but not installed." >&2
    exit 1
fi

while true; do
    NOW=$(date +%s)
    
    # Lire le dump WireGuard (skip header)
    while read -r line; do
        PUB_KEY=$(echo "$line" | awk '{print $1}')
        HANDSHAKE=$(echo "$line" | awk '{print $5}')
        ENDPOINT=$(echo "$line" | awk '{print $3}')
        ALLOWED_IPS=$(echo "$line" | awk '{print $4}')
        
        if [ "$HANDSHAKE" -eq 0 ]; then continue; fi
        
        DIFF=$((NOW - HANDSHAKE))
        
        # Trouver le nom du client via CACHE
        CACHE_FILE="/var/run/wg-peer-cache.json"
        CLIENT_NAME="Inconnu"
        CONTAINER_NAME="Inconnu"
        USAGE_JSON="/opt/wireguard-api/data/usage.json"
        TODAY=$(date +%Y-%m-%d)
        USAGE_DAILY=0
        USAGE_TOTAL=0
        
        if [ -f "$CACHE_FILE" ]; then
            CM_DATA=$(jq -r ".[\"$PUB_KEY\"] // empty" "$CACHE_FILE")
            if [ -n "$CM_DATA" ]; then
                CLIENT_NAME=$(echo "$CM_DATA" | jq -r ".name")
                CONTAINER_NAME=$(echo "$CM_DATA" | jq -r ".container")
                USAGE_DATA=$(sqlite3 "$DB_FILE" "SELECT total FROM usage WHERE publicKey='$PUB_KEY';" 2>/dev/null || echo 0)
                USAGE_TOTAL=${USAGE_DATA:-0}
            fi
        fi
        
        LAST_STATE=$(grep "$PUB_KEY" $STATE_FILE | awk '{print $2}')
        
        # Si handshake < 3 min (180s), considéré connecté
        if [ $DIFF -lt 180 ]; then
            if [ "$LAST_STATE" != "CONNECTED" ]; then
                # Log History to SQLite
                sqlite3 "$DB_FILE" "INSERT INTO logs (timestamp, status, container, name, virtualIp, realIp, usageTotal) VALUES (strftime('%s','now')*1000, 'CONNECTED', '$CONTAINER_NAME', '$CLIENT_NAME', '$ALLOWED_IPS', '$ENDPOINT', $USAGE_TOTAL);"
                
                # Notify
                if [ -x /usr/local/bin/wg-send-msg.sh ]; then
                    /usr/local/bin/wg-send-msg.sh "🔌 VPN: $CLIENT_NAME connecté ($ENDPOINT)"
                fi
                
                sed -i "/$PUB_KEY/d" $STATE_FILE
                echo "$PUB_KEY CONNECTED" >> $STATE_FILE
            fi
        else
            if [ "$LAST_STATE" == "CONNECTED" ]; then
                # Log History to SQLite
                sqlite3 "$DB_FILE" "INSERT INTO logs (timestamp, status, container, name, virtualIp, realIp, usageTotal) VALUES (strftime('%s','now')*1000, 'DISCONNECTED', '$CONTAINER_NAME', '$CLIENT_NAME', '$ALLOWED_IPS', '$ENDPOINT', $USAGE_TOTAL);"
                
                # Notify
                if [ -x /usr/local/bin/wg-send-msg.sh ]; then
                    /usr/local/bin/wg-send-msg.sh "🔌 VPN: $CLIENT_NAME déconnecté"
                fi
                
                sed -i "/$PUB_KEY/d" $STATE_FILE
                echo "$PUB_KEY DISCONNECTED" >> $STATE_FILE
            fi
        fi
    done < <(wg show $INTERFACE dump | tail -n +2)
    
    sleep 60
done

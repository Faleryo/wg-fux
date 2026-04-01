#!/bin/bash
# --- VIBE-OS : WireGuard Enforcer (Quota & Expiry) ---
# BUG-FIX: DB_FILE chemin hardcodé développeur corrigé
# BUG-FIX: Double déclaration WG_INTERFACE supprimée
# BUG-FIX: rm -f "$CLIENTS_DIR/disabled" → "$CLIENT_DIR/disabled" (chemin correct)

if [ -f /etc/wireguard/manager.conf ]; then
    source /etc/wireguard/manager.conf
fi

WG_INTERFACE="${WG_INTERFACE:-wg0}"
# Résolution dynamique du chemin DB (env → fallback /app/data → fallback relatif)
DB_FILE="${WG_DB_PATH:-${API_DATA_DIR:-/app/data}/wg-fux.db}"
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
{
    echo "{"
    FIRST=1
    while IFS= read -r keyfile; do
        PUBKEY=$(tr -d '[:space:]' < "$keyfile")
        CLIENT_DIR=$(dirname "$keyfile")
        CLIENT_NAME=$(basename "$CLIENT_DIR")
        CONTAINER_NAME=$(basename "$(dirname "$CLIENT_DIR")")
        if [ "$FIRST" -eq 1 ]; then FIRST=0; else printf ",\n"; fi
        printf '  "%s": {"name": "%s", "container": "%s", "path": "%s"}' \
            "$PUBKEY" "$CLIENT_NAME" "$CONTAINER_NAME" "$CLIENT_DIR"
    done < <(find "$CLIENTS_DIR" -name "public.key" 2>/dev/null)
    echo ""
    echo "}"
} > "$CACHE_FILE"

# 2. Enforce Limits
if ! ip link show "$WG_INTERFACE" > /dev/null 2>&1; then
    log "[WARN] Interface $WG_INTERFACE not found. Skipping enforcement."
    exit 0
fi

find "$CLIENTS_DIR" -name "public.key" 2>/dev/null | while read -r keyfile; do
    PUBKEY=$(tr -d '[:space:]' < "$keyfile")
    CLIENT_DIR=$(dirname "$keyfile")
    CLIENT_NAME=$(basename "$CLIENT_DIR")

    IS_EXPIRED=0
    IS_QUOTA_EXCEEDED=0

    if [ -f "$CLIENT_DIR/expiry" ]; then
        EXP_DATE=$(cat "$CLIENT_DIR/expiry")
        if [ -n "$EXP_DATE" ]; then
            EXP_TS=$(date -d "$EXP_DATE" +%s 2>/dev/null || echo "")
            if [ -n "$EXP_TS" ] && [ "$NOW" -ge "$EXP_TS" ]; then IS_EXPIRED=1; fi
        fi
    fi

    if [ -f "$CLIENT_DIR/quota" ]; then
        QUOTA_GB=$(cat "$CLIENT_DIR/quota")
        if [ -n "$QUOTA_GB" ] && [ "$QUOTA_GB" -gt 0 ]; then
            TOTAL_USED=$(sqlite3 "$DB_FILE" "SELECT total FROM usage WHERE publicKey='$PUBKEY';" 2>/dev/null || echo "0")
            TOTAL_USED=${TOTAL_USED:-0}
            QUOTA_BYTES=$((QUOTA_GB * 1024 * 1024 * 1024))
            if [ "$TOTAL_USED" -ge "$QUOTA_BYTES" ]; then IS_QUOTA_EXCEEDED=1; fi
        fi
    fi

    # LOGIC: If currently disabled — check if limits are now resolved → UNBAN
    if [ -f "$CLIENT_DIR/disabled" ]; then
        REASON=$(cat "$CLIENT_DIR/disabled")
        if { [[ "$REASON" == "Expired" && "$IS_EXPIRED" -eq 0 ]] || \
             [[ "$REASON" == "Quota exceeded" && "$IS_QUOTA_EXCEEDED" -eq 0 ]]; }; then
            log "Réactivation automatique : $CLIENT_NAME (Raison: $REASON résolue)"
            # BUG-FIX: Correct path was "$CLIENTS_DIR/disabled" → should be "$CLIENT_DIR/disabled"
            rm -f "$CLIENT_DIR/disabled"
            ALLOWED_IPS=$(cat "$CLIENT_DIR/allowed_ips.txt" 2>/dev/null)
            PSK="$CLIENT_DIR/preshared.key"
            if [ -n "$ALLOWED_IPS" ] && [ -f "$PSK" ]; then
                wg set "$WG_INTERFACE" peer "$PUBKEY" preshared-key "$PSK" allowed-ips "$ALLOWED_IPS" 2>/dev/null && \
                    log "Peer $CLIENT_NAME re-activé sur $WG_INTERFACE"
                command -v wg-apply-qos.sh &>/dev/null && wg-apply-qos.sh 2>/dev/null || true
            fi
        fi
        continue
    fi

    # LOGIC: If currently active but limits reached → BAN
    if [ "$IS_EXPIRED" -eq 1 ]; then
        log "Bannissement (Expiration) : $CLIENT_NAME"
        echo "Expired" > "$CLIENT_DIR/disabled"
        wg set "$WG_INTERFACE" peer "$PUBKEY" remove 2>/dev/null || true
        command -v wg-apply-qos.sh &>/dev/null && wg-apply-qos.sh 2>/dev/null || true
    elif [ "$IS_QUOTA_EXCEEDED" -eq 1 ]; then
        log "Bannissement (Quota dépassé) : $CLIENT_NAME"
        echo "Quota exceeded" > "$CLIENT_DIR/disabled"
        wg set "$WG_INTERFACE" peer "$PUBKEY" remove 2>/dev/null || true
        command -v wg-apply-qos.sh &>/dev/null && wg-apply-qos.sh 2>/dev/null || true
    fi
done

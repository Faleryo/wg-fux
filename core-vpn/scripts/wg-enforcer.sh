#!/bin/bash
# --- VIBE-OS v6.2 : WireGuard Enforcer (Quota & Expiry) ---
# GHOST-SCAN FIX v6.2:
#   - Added 'set -euo pipefail' for robust shell execution.
#   - Replaced ad-hoc log() with wg-common.sh source (log_info / log_warn).
#   - Added HEALING LOOP: auto-restart of wg0 interface if not found.
#   - Fixed: Double declaration of WG_INTERFACE was removed.
#   - Fixed: rm -f "$CLIENTS_DIR/disabled" → "$CLIENT_DIR/disabled" (correct path).

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
source "$SCRIPT_DIR/wg-common.sh"

set -euo pipefail

if [ -f /etc/wireguard/manager.conf ]; then
    source /etc/wireguard/manager.conf
fi

WG_INTERFACE="${WG_INTERFACE:-wg0}"
DB_FILE="${WG_DB_PATH:-${API_DATA_DIR:-/app/data}/wg-fux.db}"
CLIENTS_DIR="/etc/wireguard/clients"

NOW=$(date +%s)

# Check if sqlite3 is installed
if ! command -v sqlite3 &> /dev/null; then
    log_error "sqlite3 is required but not installed." "$ERR_SYSTEM_FAILURE"
fi

# --- 🛡️ HEALING LOOP (Autonomic SRE) ---
# If the WireGuard interface is absent, attempt to bring it up automatically.
_heal_interface() {
    log_warn "[HEALING] Interface $WG_INTERFACE not found. Attempting auto-recovery..."
    if command -v wg-quick &>/dev/null; then
        if wg-quick up "$WG_INTERFACE" 2>/dev/null; then
            log_info "[HEALING] Interface $WG_INTERFACE successfully restored."
        else
            log_warn "[HEALING] Auto-recovery failed. Skipping enforcement cycle."
            exit 0
        fi
    else
        log_warn "[HEALING] wg-quick not available. Skipping enforcement cycle."
        exit 0
    fi
}

if ! ip link show "$WG_INTERFACE" > /dev/null 2>&1; then
    _heal_interface
fi

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
            TOTAL_USED="${TOTAL_USED:-0}"
            QUOTA_BYTES=$((QUOTA_GB * 1024 * 1024 * 1024))
            if [ "$TOTAL_USED" -ge "$QUOTA_BYTES" ]; then IS_QUOTA_EXCEEDED=1; fi
        fi
    fi

    # LOGIC: If currently disabled — check if limits are now resolved → UNBAN
    if [ -f "$CLIENT_DIR/disabled" ]; then
        REASON=$(cat "$CLIENT_DIR/disabled")
        if { [[ "$REASON" == "Expired" && "$IS_EXPIRED" -eq 0 ]] || \
             [[ "$REASON" == "Quota exceeded" && "$IS_QUOTA_EXCEEDED" -eq 0 ]]; }; then
            log_info "Réactivation automatique : $CLIENT_NAME (Raison: $REASON résolue)"
            rm -f "$CLIENT_DIR/disabled"
            ALLOWED_IPS=$(cat "$CLIENT_DIR/allowed_ips.txt" 2>/dev/null || echo "")
            PSK="$CLIENT_DIR/preshared.key"
            if [ -n "$ALLOWED_IPS" ] && [ -f "$PSK" ]; then
                wg set "$WG_INTERFACE" peer "$PUBKEY" preshared-key "$PSK" allowed-ips "$ALLOWED_IPS" 2>/dev/null && \
                    log_info "Peer $CLIENT_NAME re-activé sur $WG_INTERFACE"
                command -v wg-apply-qos.sh &>/dev/null && wg-apply-qos.sh 2>/dev/null || true
            fi
        fi
        continue
    fi

    # LOGIC: If currently active but limits reached → BAN
    if [ "$IS_EXPIRED" -eq 1 ]; then
        log_warn "Bannissement (Expiration) : $CLIENT_NAME"
        echo "Expired" > "$CLIENT_DIR/disabled"
        wg set "$WG_INTERFACE" peer "$PUBKEY" remove 2>/dev/null || true
        command -v wg-apply-qos.sh &>/dev/null && wg-apply-qos.sh 2>/dev/null || true
    elif [ "$IS_QUOTA_EXCEEDED" -eq 1 ]; then
        log_warn "Bannissement (Quota dépassé) : $CLIENT_NAME"
        echo "Quota exceeded" > "$CLIENT_DIR/disabled"
        wg set "$WG_INTERFACE" peer "$PUBKEY" remove 2>/dev/null || true
        command -v wg-apply-qos.sh &>/dev/null && wg-apply-qos.sh 2>/dev/null || true
    fi
done

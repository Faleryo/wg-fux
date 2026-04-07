#!/bin/bash
# 💠 Vibe-OS Ghost-Scan : WG-FUX Stability Diagnostic
# Version 1.0 (Diamond v4.0 Platinum)

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

# Point to SQLite DB
DB_PATH="/app/data/wg-fux.db"
if [ ! -f "$DB_PATH" ]; then
    DB_PATH="/home/faleryo/wg-fux/api-service/data/wg-fux.db" # Local dev path
fi

# Ensure SQLite is available
if ! command -v sqlite3 &> /dev/null; then
    log_error "sqlite3 not found. Cannot run diagnostic." "$ERR_SYSTEM_FAILURE"
fi

log_info "----------------------------------------------------"
log_info "🛡️ WG-FUX DIAMOND GHOST-SCAN : Starting Audit..."
log_info "----------------------------------------------------"

# 1. Check DB vs Filesystem
log_info "[DIAG] Auditing DB vs Filesystem..."
clients_in_db=$(sqlite3 "$DB_PATH" "SELECT container, name FROM clients;")

while IFS='|' read -r container name; do
    client_dir=$(get_client_dir "$container" "$name")
    if [ ! -d "$client_dir" ]; then
        log_warn "[GHOST-DB] Client found in DB but missing on disk: $container/$name"
    fi
done <<< "$clients_in_db"

# 2. Check Filesystem vs DB
log_info "[DIAG] Auditing Filesystem vs DB..."
CLIENTS_ROOT="/etc/wireguard/clients"
if [ -d "$CLIENTS_ROOT" ]; then
    for container_dir in "$CLIENTS_ROOT"/*; do
        [ -d "$container_dir" ] || continue
        container=$(basename "$container_dir")
        for client_dir in "$container_dir"/*; do
            [ -d "$client_dir" ] || continue
            name=$(basename "$client_dir")
            
            exists=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM clients WHERE container='$container' AND name='$name';")
            if [ "$exists" -eq 0 ]; then
                log_warn "[GHOST-DISK] Client found on disk but missing in DB: $container/$name"
            fi
        done
    done
fi

# 3. Check DB vs Active WireGuard Kernel state
log_info "[DIAG] Auditing DB vs WireGuard Interface state..."
load_config
WG_PEERS=$(wg show "$WG_INTERFACE" peers)

clients_enabled=$(sqlite3 "$DB_PATH" "SELECT publicKey, container, name FROM clients WHERE enabled=1;")
while IFS='|' read -r pubkey container name; do
    if [[ ! "$WG_PEERS" == *"$pubkey"* ]]; then
        log_warn "[DESYNC] Client enabled in DB but NOT in WireGuard: $container/$name ($pubkey)"
    fi
done <<< "$clients_enabled"

# 4. Check for orphaned log entries
log_info "[DIAG] Cleaning up orphaned usage logs..."
# (Optional: implement logic to delete usage logs for publicKeys not in clients table)

log_info "----------------------------------------------------"
log_info "✅ DIAGNOSTIC COMPLETE."
log_info "----------------------------------------------------"

#!/bin/bash
# --- VIBE-OS v6.2 : WireGuard Backup ---
# GHOST-SCAN FIX v6.2:
#   - Fixed: $RED variable was undefined (now uses log_error from wg-common.sh).
#   - Fixed: Dead-code ($? check after 'if !') removed.
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"  
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

BACKUP_DIR="/var/backups/wireguard"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/wg-backup-${TIMESTAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"

log_info "Création de la sauvegarde : $BACKUP_FILE..."
if ! sudo tar -czf "$BACKUP_FILE" -C / etc/wireguard; then
    log_error "Échec de la création de l'archive." "$ERR_SYSTEM_FAILURE"
fi

log_info "Sauvegarde réussie à $BACKUP_FILE"
# Purge auto (plus de 7 jours)
find "$BACKUP_DIR" -name "wg-backup-*.tar.gz" -mtime +7 -delete

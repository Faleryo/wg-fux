#!/bin/bash
# WG-FUX : Backup System
# Sauvegarde chiffrée de la base et des configs WireGuard.
#
# Variables d'env :
# BACKUP_PASSPHRASE (requis) passphrase pour le chiffrement openssl
# BACKUP_DIR (def: /app/backups)
# BACKUP_RETENTION_DAYS (def: 30)

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/app/data/backups}"
DB_FILE="/app/data/wg-fux.db"
WG_CONF_DIR="/etc/wireguard"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="wg_fux_backup_$TIMESTAMP.tar.gz.enc"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
 echo "❌ BACKUP_PASSPHRASE is not set; refusing to write unencrypted backup." >&2
 exit 2
fi

echo "📡 Starting WG-FUX Backup ($TIMESTAMP)..."
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT INT TERM

# 1. Database Backup (Safe copy for SQLite WAL)
if [ -f "$DB_FILE" ]; then
 echo "📦 Backing up SQLite database..."
  sqlite3 "$DB_FILE" ".backup ${TEMP_DIR}/database.sqlite"
fi

# 2. WireGuard Configs
if [ -d "$WG_CONF_DIR" ]; then
 echo "📦 Backing up WireGuard configurations..."
 cp -r "$WG_CONF_DIR" "$TEMP_DIR/wireguard"
fi

# 3. Compress + encrypt with AES-256 (pbkdf2)
echo "🗜️ Compressing and encrypting backup..."
OUT="$BACKUP_DIR/$BACKUP_NAME"
tar -czf - -C "$TEMP_DIR" . | \
 openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
 -pass env:BACKUP_PASSPHRASE \
 -out "$OUT"
chmod 600 "$OUT"

# 4. Retention
echo "🧹 Cleaning up backups older than $RETENTION_DAYS days..."
find "$BACKUP_DIR" -name "wg_fux_backup_*.tar.gz.enc" -mtime "+$RETENTION_DAYS" -delete

echo "✅ Encrypted backup written: $OUT"

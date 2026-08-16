#!/bin/bash
# WG-FUX : Backup System
# Sauvegarde chiffrée de la base et des configs WireGuard.
#
# Variables d'env :
# BACKUP_PASSPHRASE (requis) passphrase pour le chiffrement openssl
# BACKUP_DIR (def: /app/backups)
# BACKUP_RETENTION_DAYS (def: 30)
#
# COPIE HORS-SITE (optionnelle mais VIVEMENT recommandée) — sans elle, les
# sauvegardes vivent sur la machine même qu'elles serviraient à restaurer :
# une perte du serveur emporte simultanément la plateforme ET ses sauvegardes.
# L'archive est déjà chiffrée localement (AES-256), donc un stockage tiers ne
# voit jamais les données en clair. Compatible S3 (AWS, Backblaze B2, Wasabi,
# Scaleway, MinIO…) via `curl --aws-sigv4` — aucune dépendance à installer.
# BACKUP_S3_ENDPOINT ex: https://s3.us-west-004.backblazeb2.com
# BACKUP_S3_BUCKET   nom du bucket
# BACKUP_S3_KEY      identifiant d'accès
# BACKUP_S3_SECRET   clé secrète
# BACKUP_S3_REGION   (def: us-east-1)
# BACKUP_S3_PREFIX   (def: wg-fux) dossier logique dans le bucket

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

# ─────────────────────────────────────────────────────────────────────────────
# 5. Copie hors-site (no-op si non configurée)
# ─────────────────────────────────────────────────────────────────────────────
if [ -n "${BACKUP_S3_BUCKET:-}" ] && [ -n "${BACKUP_S3_KEY:-}" ] &&
  [ -n "${BACKUP_S3_SECRET:-}" ] && [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
  S3_REGION="${BACKUP_S3_REGION:-us-east-1}"
  S3_PREFIX="${BACKUP_S3_PREFIX:-wg-fux}"
  # Enlève un éventuel / final pour ne pas produire une double barre dans l'URL.
  S3_ENDPOINT="${BACKUP_S3_ENDPOINT%/}"
  DEST="${S3_ENDPOINT}/${BACKUP_S3_BUCKET}/${S3_PREFIX}/${BACKUP_NAME}"

  echo "☁️  Uploading off-site to ${BACKUP_S3_BUCKET}/${S3_PREFIX}/ ..."
  # `|| UPLOAD_RC=$?` : sous `set -e`, un échec curl doit être RAPPORTÉ, pas
  # tuer le script — la sauvegarde locale, elle, a déjà réussi.
  UPLOAD_RC=0
  HTTP_CODE=$(curl --proto '=https' --tlsv1.2 -sS --fail-with-body \
    --retry 3 --retry-delay 5 --max-time 900 \
    --aws-sigv4 "aws:amz:${S3_REGION}:s3" \
    --user "${BACKUP_S3_KEY}:${BACKUP_S3_SECRET}" \
    -T "$OUT" -o /dev/null -w '%{http_code}' \
    "$DEST" 2>&1) || UPLOAD_RC=$?

  if [ "$UPLOAD_RC" -eq 0 ]; then
    echo "✅ Off-site copy uploaded (HTTP $HTTP_CODE): ${S3_PREFIX}/${BACKUP_NAME}"
  else
    # Volontairement bruyant ET non nul : le job planifié journalise l'échec.
    # Une sauvegarde qui ne quitte jamais la machine n'est pas une sauvegarde.
    echo "❌ Off-site upload FAILED (curl rc=$UPLOAD_RC, réponse: $HTTP_CODE)." >&2
    echo "   La sauvegarde locale reste disponible : $OUT" >&2
    exit 3
  fi
else
  echo "ℹ️  Off-site copy not configured (BACKUP_S3_* absent) — backup stays on this host only."
fi

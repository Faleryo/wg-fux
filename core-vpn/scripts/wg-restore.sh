#!/bin/bash
# --- : Restore Config (encrypted, validated) ---
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

load_config

BACKUP_FILE=${1:-}

if [ -z "$BACKUP_FILE" ]; then
 echo "Usage: $0 <path_to_backup.tar.gz.enc>"
 echo "Requires env BACKUP_PASSPHRASE for encrypted archives."
 echo "Dernières sauvegardes :"
  ls -lh "${BACKUP_DIR:-/app/data/backups}"/wg_fux_backup_*.tar.gz.enc 2>/dev/null || true
 exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
 echo "Erreur : Fichier introuvable." >&2
 exit 1
fi

if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
 echo "❌ BACKUP_PASSPHRASE non défini." >&2
 exit 2
fi

# Decrypt to a temporary archive
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT INT TERM
ARCHIVE="$TEMP_DIR/backup.tar.gz"

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
 -pass env:BACKUP_PASSPHRASE \
 -in "$BACKUP_FILE" \
 -out "$ARCHIVE"

# 🛡️ Validate archive: refuse absolute paths, parent traversal, symlinks
if tar -tzf "$ARCHIVE" | awk '
 /^\// { print "absolute path: " $0; exit 1 }
 /(^|\/)\.\.(\/|$)/ { print "parent traversal: " $0; exit 1 }
'; then
 :
else
 echo "❌ Archive refusée : contient des chemins absolus ou ../" >&2
 exit 1
fi
if tar -tzvf "$ARCHIVE" | awk '$1 ~ /^l/ { print "symlink: " $0; exit 1 }'; then
 :
else
 echo "❌ Archive refusée : contient des liens symboliques" >&2
 exit 1
fi

echo "⚠️ RESTAURATION EN COURS (Services temporairement coupés)..."
systemctl stop wireguard-api "wg-quick@${WG_INTERFACE:-wg0}" 2>/dev/null || true

# Extract into a staging dir first, then move into place
STAGE="$TEMP_DIR/stage"
mkdir -p "$STAGE"
tar -xzf "$ARCHIVE" -C "$STAGE"

if [ ! -d "$STAGE/wireguard" ]; then
 echo "❌ Archive ne contient pas de répertoire 'wireguard'." >&2
 exit 1
fi

echo "⚠️ AVERTISSEMENT: rsync --delete va supprimer les fichiers dans /etc/wireguard/"
echo "non présents dans la sauvegarde. Voulez-vous continuer ?"
read -r -p "Confirmer la restauration ? (oui/non) " confirm
if [ "$confirm" != "oui" ]; then
  echo "❌ Restauration annulée."
  exit 1
fi
ROLLBACK_DIR="$TEMP_DIR/wireguard_before_restore"
cp -a /etc/wireguard/ "$ROLLBACK_DIR"
rsync -a --delete "$STAGE/wireguard/" /etc/wireguard/ || {
  echo "❌ rsync échoué — rollback de /etc/wireguard/ en cours..." >&2
  rsync -a --delete "$ROLLBACK_DIR/" /etc/wireguard/ || \
    { echo "❌ Rollback aussi échoué — /etc/wireguard/ peut être dans un état corrompu !" >&2; }
  exit 1
}
echo "✅ Restauration effectuée avec succès."

systemctl daemon-reload || true
systemctl start wireguard-api "wg-quick@${WG_INTERFACE:-wg0}" 2>/dev/null || true
/usr/local/bin/wg-enforcer.sh 2>/dev/null || true

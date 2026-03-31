#!/bin/bash
BACKUP_DIR="/var/backups/wireguard"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/wg-backup-${TIMESTAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"

# Fichiers et dossiers à sauvegarder
FILES="/etc/wireguard /opt/wireguard-api/data /opt/wireguard-api/.env /root/wireguard-credentials.txt"
[ -f /etc/nginx/sites-available/wireguard ] && FILES="$FILES /etc/nginx/sites-available/wireguard"

echo "Création de la sauvegarde : $BACKUP_FILE..."
tar -czf "$BACKUP_FILE" $FILES 2>/dev/null

if [ $? -eq 0 ]; then
    echo "Sauvegarde réussie à $BACKUP_FILE"
    # Purge auto (plus de 7 jours)
    find "$BACKUP_DIR" -name "wg-backup-*.tar.gz" -mtime +7 -delete
else
    echo "Erreur lors de la sauvegarde"
    exit 1
fi

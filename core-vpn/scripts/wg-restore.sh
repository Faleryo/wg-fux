#!/bin/bash
BACKUP_FILE=$1
if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: $0 <path_to_backup.tar.gz>"
    echo "Dernières sauvegardes :"
    ls -lh /var/backups/wireguard/wg-backup-*.tar.gz 2>/dev/null
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "Erreur : Fichier introuvable."
    exit 1
fi

echo "⚠️ RESTAURATION EN COURS (Services temporairement coupés)..."
systemctl stop wireguard-api wg-quick@${WG_INTERFACE:-wg0} 2>/dev/null

tar -xzf "$BACKUP_FILE" -C / 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ Restauration effectuée avec succès."
    systemctl daemon-reload
    systemctl start wireguard-api wg-quick@${WG_INTERFACE:-wg0}
    /usr/local/bin/wg-enforcer.sh 2>/dev/null
else
    echo "❌ Erreur critique lors de l'extraction."
    exit 1
fi

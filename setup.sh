#!/bin/bash

# WG-FUX Setup Script - Orchestration & Configuration
# Author: Antigravity Architect
# Vibe: Zero Bullshit / Clinical Precision

set -e

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Répertoires
API_ENV="api-service/.env"
API_DATA="api-service/data"
WG_DIR="/etc/wireguard"

uninstall() {
    echo -e "${YELLOW}[WARNING] Désinstallation de WG-FUX...${NC}"
    
    if [ -f "docker-compose.yml" ]; then
        echo -e "[INFO] Arrêt des conteneurs et suppression des volumes..."
        sudo docker compose down -v || true
    fi

    echo -e "[INFO] Suppression des fichiers de configuration API..."
    rm -f "$API_ENV"
    rm -rf "$API_DATA"

    read -p "Voulez-vous supprimer TOUTES les configurations WireGuard dans $WG_DIR ? (y/N): " purge_wg
    if [[ "$purge_wg" =~ ^[yY]$ ]]; then
        echo -e "[INFO] Suppression de $WG_DIR..."
        sudo rm -rf "$WG_DIR"
    else
        echo -e "[INFO] Conservation de $WG_DIR."
    fi

    echo -e "${GREEN}[SUCCESS] Désinstallation terminée.${NC}"
    exit 0
}

update_process() {
    echo -e "${BLUE}[INFO] Lancement de la mise à jour (Build & Restart)...${NC}"
    if [ ! -f "docker-compose.yml" ]; then
        echo -e "${RED}[ERROR] Fichier docker-compose.yml introuvable.${NC}"
        exit 1
    fi
    
    echo -e "[INFO] Reconstruction des images et redémarrage des services..."
    sudo docker compose up --build -d
    
    echo -e "${GREEN}[SUCCESS] Mise à jour terminée. Le système utilise la dernière version du code.${NC}"
    exit 0
}

# Suppression auto des flags si nécessaire ou gestion par arguments
if [ "$1" == "--uninstall" ]; then uninstall; fi
if [ "$1" == "--update" ]; then update_process; fi

echo -e "${GREEN}
██╗      ██╗ ██████╗       ███████╗██╗   ██╗██╗  ██╗
██║  ██  ██║██╔════╝       ██╔════╝██║   ██║╚██╗██╔╝
██║ ████ ██║██║  ███╗█████╗█████╗  ██║   ██║ ╚███╔╝ 
██║██╔═██╗██║██║   ██║╚════╝██╔══╝  ██║   ██║ ██╔██╗ 
╚███╔╝ ╚███╔╝╚██████╔╝      ██║     ╚██████╔╝██╔╝ ██╗
 ╚══╝   ╚══╝  ╚═════╝       ╚═╝      ╚═════╝ ╚═╝  ╚═╝
${NC}"

echo -e "1) Installer / Reconfigurer WG-FUX"
echo -e "2) Désinstaller WG-FUX"
echo -e "3) Mettre à jour (Appliquer les modifications de code)"
read -rp "Choisissez une option [1-3]: " choice

case $choice in
    2) uninstall ;;
    3) update_process ;;
    1) echo -e "${GREEN}[INFO] Initialisation de l'installation/configuration...${NC}" ;;
    *) echo -e "${RED}Option invalide.${NC}"; exit 1 ;;
esac

# 1. Vérification des dépendances
check_dependency() {
    if ! command -v "$1" &> /dev/null; then
        echo -e "${RED}[ERROR] $1 n'est pas installé.${NC}"
        return 1
    fi
    return 0
}

DEPS_MISSING=0
check_dependency "docker" || DEPS_MISSING=1
(docker compose version &>/dev/null) || DEPS_MISSING=1
check_dependency "wg" || DEPS_MISSING=1

if [ $DEPS_MISSING -eq 1 ]; then
    echo -e "${RED}[FATAL] Dépendances manquantes. Veuillez installer docker, docker-compose-v2 et wireguard-tools.${NC}"
    exit 1
fi

# 2. Gestion de la configuration existante
if [ -f "$API_ENV" ]; then
    echo -e "${YELLOW}[INFO] Une configuration existante a été détectée.${NC}"
    read -rp "Voulez-vous écraser la configuration actuelle (.env, hash admin, secrets) ? (y/N): " refresh_conf
    if [[ ! "$refresh_conf" =~ ^[yY]$ ]]; then
        echo -e "${BLUE}[INFO] Conservation de la configuration actuelle. Lancement du build...${NC}"
        update_process
    fi
fi

# 3. Configuration Réseau
echo -e "\n${GREEN}[STEP 1] Configuration Réseau${NC}"
DETECTED_IP=$(curl -s --max-time 2 ifconfig.me || ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || echo "127.0.0.1")
read -p "Entrez l'IP publique du serveur [$DETECTED_IP]: " SERVER_IP
SERVER_IP=${SERVER_IP:-$DETECTED_IP}

read -p "Entrez le port WireGuard [51820]: " SERVER_PORT
SERVER_PORT=${SERVER_PORT:-51820}

# 4. Authentification Admin
echo -e "\n${GREEN}[STEP 2] Authentification Admin${NC}"
read -rp "Username [admin]: " ADMIN_USER
ADMIN_USER=${ADMIN_USER:-admin}

read -rsp "Mot de passe admin: " ADMIN_PASS
echo ""
SALT=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)

echo -e "${GREEN}[INFO] Génération du hash sécurisé (PBKDF2-SHA512 - 600k IT)...${NC}"
ADMIN_HASH=$(docker run --rm node:20-slim -e "const crypto = require('crypto'); console.log(crypto.pbkdf2Sync('$ADMIN_PASS', '$SALT', 600000, 64, 'sha512').toString('hex'))")

# 5. WireGuard Keys
echo -e "\n${GREEN}[STEP 3] Génération des clés WireGuard${NC}"
if [ ! -d "$WG_DIR" ]; then sudo mkdir -p "$WG_DIR"; fi

if [ ! -f "$WG_DIR/server-private.key" ]; then
    PRIV_KEY=$(wg genkey)
    PUB_KEY=$(echo "$PRIV_KEY" | wg pubkey)
    echo "$PRIV_KEY" | sudo tee "$WG_DIR/server-private.key" > /dev/null
    echo "$PUB_KEY" | sudo tee "$WG_DIR/server-public.key" > /dev/null
    sudo chmod 600 "$WG_DIR/server-private.key"
    echo -e "${GREEN}[INFO] Nouvelles clés générées.${NC}"
else
    echo -e "[INFO] Utilisation des clés existantes dans $WG_DIR"
fi

# 5. Écriture des fichiers
echo -e "\n${GREEN}[STEP 4] Installation des scripts utilitaires${NC}"
SCRIPT_DIR="$(pwd)/core-vpn/scripts"
for script in "$SCRIPT_DIR"/wg-*.sh; do
    if [ -f "$script" ]; then
        target="/usr/local/bin/$(basename "$script")"
        echo -e "[INFO] Création du lien symbolique pour $(basename "$script")..."
        sudo ln -sf "$script" "$target"
        sudo chmod +x "$target"
    fi
done

echo -e "\n${GREEN}[STEP 5] Écriture des fichiers de configuration${NC}"

cat <<EOF | sudo tee "$WG_DIR/manager.conf" > /dev/null
SERVER_IP=$SERVER_IP
SERVER_PORT=$SERVER_PORT
VPN_SUBNET=10.0.0.0/24
VPN_SUBNET_V6=fd00::/64
CLIENT_DNS=1.1.1.1
SERVER_MTU=1420
WG_INTERFACE=wg0
PERSISTENT_KEEPALIVE=25
EOF

# Sync or create wg0.conf
PRIV_KEY_VAL=$(sudo cat "$WG_DIR/server-private.key")
cat <<EOF | sudo tee "$WG_DIR/wg0.conf" > /dev/null
[Interface]
Address = 10.0.0.1/24, fd00::1/64
ListenPort = $SERVER_PORT
PrivateKey = $PRIV_KEY_VAL
MTU = 1420
SaveConfig = false

PostUp = /usr/local/bin/wg-postup.sh %i
PostDown = /usr/local/bin/wg-postdown.sh %i
EOF

cat <<EOF > "$API_ENV"
PORT=3000
JWT_SECRET=$JWT_SECRET
SERVER_IP=$SERVER_IP
WG_INTERFACE=wg0
ADMIN_USER=$ADMIN_USER
ADMIN_PASSWORD_HASH=$ADMIN_HASH
ADMIN_PASSWORD_SALT=$SALT
EOF

echo -e "${GREEN}[SUCCESS] Configuration terminée.${NC}"
echo -e "${BLUE}[TIP] Après le lancement, vous pouvez activer la 2FA (TOTP) via le Dashboard ou l'endpoint /api/auth/2fa/setup.${NC}"
update_process

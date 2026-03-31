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

    echo -e "[INFO] Désactivation du service Sentinel..."
    sudo systemctl stop sentinel.service 2>/dev/null || true
    sudo systemctl disable sentinel.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/sentinel.service
    sudo systemctl daemon-reload

    echo -e "[INFO] Suppression des fichiers de configuration API..."
    rm -f "$API_ENV"
    rm -rf "$API_DATA"

    local swap_file="/swap_wgfux"
    if [ -f "$swap_file" ]; then
        read -rp "Voulez-vous supprimer le fichier Swap ($swap_file) créé par WG-FUX ? (y/N): " purge_swap
        if [[ "$purge_swap" =~ ^[yY]$ ]]; then
            echo -e "[INFO] Désactivation et suppression du Swap..."
            sudo swapoff "$swap_file" 2>/dev/null || true
            sudo rm -f "$swap_file"
            sudo sed -i "\|# WG-FUX Swap|d" /etc/fstab 2>/dev/null || true
            sudo sed -i "\|$swap_file|d" /etc/fstab 2>/dev/null || true
        fi
    fi

    read -rp "Voulez-vous supprimer TOUTES les configurations WireGuard dans $WG_DIR ? (y/N): " purge_wg
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

    # 💠 SRE Optimization: Check disk before build
    local free_kb
    free_kb=$(df -k / | awk 'NR==2 {print $4}')
    if [ "$free_kb" -lt 2097152 ]; then # < 2GB free
        echo -e "${YELLOW}[WARNING] Espace disque faible (< 2GB). Nettoyage sécurisé de Docker...${NC}"
        # On supprime les images inutilisées et le cache de build, mais on GARDE les volumes (données critiques)
        sudo docker image prune -a -f || true
        sudo docker builder prune -f || true
    fi
    
    # 💠 SRE: Ensure SSL and Firewall are ready before starting Docker
    setup_ssl
    setup_firewall
    
    echo -e "[INFO] Reconstruction des images et redémarrage des services..."
    sudo docker compose up --build -d
    
    local ip_final="${SERVER_IP:-$(detect_public_ip)}"
    echo -e "\n${GREEN}==================================================${NC}"
    echo -e "${GREEN}        WG-FUX EST PRÊT À L'ACTION !            ${NC}"
    echo -e "${GREEN}==================================================${NC}"
    echo -e "Dashboard URL (SSL) : ${BLUE}https://$ip_final${NC}"
    echo -e "Dashboard URL (HTTP): ${BLUE}http://$ip_final${NC}"
    echo -e "${YELLOW}[NOTE] Si vous utilisez le SSL auto-signé, votre navigateur${NC}"
    echo -e "${YELLOW}affichera une alerte de sécurité. C'est normal.${NC}"
    echo -e "${GREEN}==================================================${NC}\n"
    
    exit 0
}

git_upgrade() {
    echo -e "${BLUE}[INFO] Récupération des dernières mises à jour depuis Git...${NC}"
    git pull || { echo -e "${RED}[ERROR] Échec du git pull. Vérifiez votre connexion ou l'état du dépôt.${NC}"; exit 1; }
    update_process
}

install_deps() {
    echo -e "${BLUE}[INFO] Tentative d'installation des dépendances...${NC}"
    if command -v apt-get &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y docker.io docker-compose-v2 wireguard-tools
    else
        echo -e "${RED}[ERROR] Gestionnaire de paquets 'apt' non trouvé. Veuillez installer manuellement : docker, docker-compose-v2, wireguard-tools.${NC}"
        exit 1
    fi
}

detect_public_ip() {
    local result
    for service in "ifconfig.me" "api.ipify.org" "ident.me"; do
        result=$(curl -s --max-time 3 "$service" 2>/dev/null)
        if [[ $result =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
            echo "$result"
            return 0
        fi
    done

    result=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+')
    if [[ $result =~ ^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$ ]]; then
        echo "$result"
        return 0
    fi

    echo "127.0.0.1"
}

setup_swap() {
    local swap_file="/swap_wgfux"
    local target_size_mb=4096 # Standard for low RAM
    local ram_kb
    ram_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local ram_mb=$((ram_kb / 1024))

    # Activation automatique si RAM < 2GB
    if [ "$ram_mb" -lt 2048 ]; then
        echo -e "${YELLOW}[WARNING] Mémoire vive faible détectée (${ram_mb}MB).${NC}"

        # 1. Vérification si Swap déjà actif (globale) et suffisant (> 1GB)
        local swap_total_kb
        swap_total_kb=$(grep SwapTotal /proc/meminfo | awk '{print $2}')
        local swap_total_mb=$((swap_total_kb / 1024))

        if [ "$swap_total_mb" -gt 1024 ]; then
            echo -e "${BLUE}[INFO] Un swap suffisant (${swap_total_mb}MB) est déjà actif. Poursuite...${NC}"
            return 0
        fi

        if [ -f "$swap_file" ]; then
            echo -e "${BLUE}[INFO] Un fichier de swap WG-FUX ($swap_file) existe déjà. Réactivation...${NC}"
            sudo swapon "$swap_file" 2>/dev/null || true
            return 0
        fi

        # 2. Calcul de l'espace disque disponible (/)
        local free_kb
        free_kb=$(df -k / | awk 'NR==2 {print $4}')
        local free_mb=$((free_kb / 1024))
        local safety_margin=1024
        local available_for_swap=$((free_mb - safety_margin))

        if [ "$available_for_swap" -lt 512 ]; then
            echo -e "${RED}[ERROR] Espace disque critique (${free_mb}MB libre). Impossible de créer un Swap.${NC}"
            echo -e "${YELLOW}[TIP] Libérez de l'espace disque pour permettre le build Docker.${NC}"
            return 0
        fi

        # Ajuster la taille du swap selon l'espace disponible
        if [ "$target_size_mb" -gt "$available_for_swap" ]; then
            target_size_mb=$available_for_swap
            echo -e "${YELLOW}[INFO] Espace disque restreint. Ajustement du Swap à ${target_size_mb}MB.${NC}"
        fi

        echo -e "${BLUE}[INFO] Création du fichier Swap de ${target_size_mb}MB...${NC}"
        
        # Tentative de création avec fallocate puis dd en secours
        if sudo fallocate -l "${target_size_mb}M" "$swap_file" 2>/dev/null || \
           sudo dd if=/dev/zero of="$swap_file" bs=1M count="$target_size_mb" status=progress; then
            
            sudo chmod 600 "$swap_file"
            sudo mkswap "$swap_file"
            if sudo swapon "$swap_file"; then
                # Persistance
                if ! grep -q "$swap_file" /etc/fstab; then
                    echo -e "\n# WG-FUX Swap\n$swap_file none swap sw 0 0" | sudo tee -a /etc/fstab > /dev/null
                fi
                echo -e "${GREEN}[SUCCESS] Swap de ${target_size_mb}MB activé.${NC}"
            else
                echo -e "${RED}[ERROR] Échec de l'activation du swap. Nettoyage...${NC}"
                sudo rm -f "$swap_file"
            fi
        else
            echo -e "${RED}[ERROR] Échec physique de création du swap. Nettoyage...${NC}"
            sudo rm -f "$swap_file"
        fi
    fi
}

setup_ssl() {
    local ssl_dir="infra/ssl"
    if [ ! -d "$ssl_dir" ]; then mkdir -p "$ssl_dir"; fi

    if [ ! -f "$ssl_dir/server.crt" ] || [ ! -f "$ssl_dir/server.key" ]; then
        echo -e "${YELLOW}[INFO] Génération d'un certificat SSL auto-signé (Secours)...${NC}"
        # Utilisation de l'IP détectée si SERVER_IP n'est pas encore défini
        local ip_for_cert="${SERVER_IP:-$(detect_public_ip)}"
        
        if openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$ssl_dir/server.key" \
            -out "$ssl_dir/server.crt" \
            -subj "/C=FR/ST=Sentinel/L=Sentinel/O=WG-FUX/OU=Dashboard/CN=$ip_for_cert" 2>/dev/null; then
            echo -e "${GREEN}[SUCCESS] SSL auto-signé généré dans $ssl_dir.${NC}"
        else
            echo -e "${RED}[ERROR] Échec de la génération SSL. Vérifiez qu'openssl est installé.${NC}"
        fi
    else
        echo -e "${BLUE}[INFO] Certificats SSL existants trouvés.${NC}"
    fi
}

setup_firewall() {
    local port="${SERVER_PORT:-51820}"
    echo -e "${BLUE}[INFO] Configuration du pare-feu (Ports: 80, 443, $port/udp)...${NC}"

    if command -v ufw &> /dev/null; then
        echo -e "[INFO] Utilisation de UFW..."
        sudo ufw allow 80/tcp 2>/dev/null || true
        sudo ufw allow 443/tcp 2>/dev/null || true
        sudo ufw allow "$port"/udp 2>/dev/null || true
        sudo ufw allow 22/tcp 2>/dev/null || true # Safety for SSH
        echo -e "${GREEN}[SUCCESS] Règles UFW appliquées.${NC}"
    elif command -v iptables &> /dev/null; then
        echo -e "[INFO] Utilisation de iptables..."
        sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
        sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
        sudo iptables -I INPUT -p udp --dport "$port" -j ACCEPT 2>/dev/null || true
        echo -e "${GREEN}[SUCCESS] Règles iptables appliquées.${NC}"
    else
        echo -e "${YELLOW}[WARNING] Aucun gestionnaire de pare-feu (ufw/iptables) détecté. Ouvrez les ports manuellement.${NC}"
    fi
}

# Suppression auto des flags si nécessaire ou gestion par arguments
if [ "$1" == "--uninstall" ]; then uninstall; fi
if [ "$1" == "--update" ]; then update_process; fi
if [ "$1" == "--upgrade" ]; then git_upgrade; fi

# 0. Initialisation du matériel (Swap si RAM < 2GB)
setup_swap

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
echo -e "4) Upgrade (Télécharger depuis GitHub & Mettre à jour)"
read -rp "Choisissez une option [1-4]: " choice

case $choice in
    2) uninstall ;;
    3) update_process ;;
    4) git_upgrade ;;
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
    echo -e "${YELLOW}[WARNING] Dépendances manquantes détectées.${NC}"
    read -rp "Voulez-vous tenter une installation automatique via apt ? (y/N): " install_now
    if [[ "$install_now" =~ ^[yY]$ ]]; then
        install_deps
        # Re-vérification
        DEPS_MISSING=0
        check_dependency "docker" || DEPS_MISSING=1
        (docker compose version &>/dev/null) || DEPS_MISSING=1
        check_dependency "wg" || DEPS_MISSING=1
        if [ $DEPS_MISSING -eq 1 ]; then
             echo -e "${RED}[FATAL] L'installation a échoué ou des dépendances manquent encore.${NC}"
             exit 1
        fi
    else
        echo -e "${RED}[FATAL] Dépendances manquantes. Veuillez installer docker, docker-compose-v2 et wireguard-tools.${NC}"
        exit 1
    fi
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
DETECTED_IP=$(detect_public_ip)
read -rp "Entrez l'IP publique du serveur [$DETECTED_IP]: " SERVER_IP
SERVER_IP=${SERVER_IP:-$DETECTED_IP}

read -rp "Entrez le port WireGuard [51820]: " SERVER_PORT
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
SERVER_IP="$SERVER_IP"
SERVER_PORT="$SERVER_PORT"
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
JWT_SECRET="$JWT_SECRET"
SERVER_IP="$SERVER_IP"
WG_INTERFACE=wg0
ADMIN_USER="$ADMIN_USER"
ADMIN_PASSWORD_HASH="$ADMIN_HASH"
ADMIN_PASSWORD_SALT="$SALT"
EOF

# 6. Sentinel & Alerts
echo -e "\n${GREEN}[STEP 6] Sentinel Monitoring & Alerts (SRE)${NC}"
read -rp "Voulez-vous activer les alertes Telegram via Bot API ? (y/N): " enable_telegram
if [[ "$enable_telegram" =~ ^[yY]$ ]]; then
    read -rp "Entrez le Telegram Bot Token: " TG_TOKEN
    read -rp "Entrez le Telegram Chat ID: " TG_CHATID
    echo "TELEGRAM_BOT_TOKEN=\"$TG_TOKEN\"" | sudo tee /etc/wireguard/sentinel.conf > /dev/null
    echo "TELEGRAM_CHAT_ID=\"$TG_CHATID\"" | sudo tee -a /etc/wireguard/sentinel.conf > /dev/null
    echo -e "${GREEN}[INFO] Configuration Telegram sauvegardée dans /etc/wireguard/sentinel.conf${NC}"
else
    echo -e "${YELLOW}[INFO] Alertes Telegram ignorées.${NC}"
fi

echo -e "\n${BLUE}[INFO] Installation du service Sentinel Watchdog...${NC}"
sudo cp "$(pwd)/core-vpn/scripts/sentinel.service" /etc/systemd/system/sentinel.service
# Mise à jour du chemin dans l'unité systemd si nécessaire
sudo sed -i "s|WorkingDirectory=.*|WorkingDirectory=$(pwd)|" /etc/systemd/system/sentinel.service
sudo sed -i "s|ExecStart=.*|ExecStart=/bin/bash $(pwd)/core-vpn/scripts/sentinel.sh|" /etc/systemd/system/sentinel.service

sudo systemctl daemon-reload
sudo systemctl enable sentinel.service
sudo systemctl restart sentinel.service
echo -e "${GREEN}[SUCCESS] Sentinel Watchdog est actif et surveille le système.${NC}"

# 7. Finalisation & Lancement
echo -e "\n${GREEN}[SUCCESS] Configuration terminée.${NC}"
echo -e "${BLUE}[TIP] Après le lancement, vous pouvez activer la 2FA (TOTP) via le Dashboard ou l'endpoint /api/auth/2fa/setup.${NC}"
update_process

#!/bin/bash
# 💠 Vibe-OS v6.5 Obsidian Check
if [ "$EUID" -ne 0 ]; then
    echo -e "\033[0;31m[ERROR] Ce script doit être exécuté avec des privilèges root (Sudo).\033[0m"
    exit 1
fi

# WG-FUX Setup Script - Orchestration & Configuration
# Author: Antigravity Architect
# Vibe: Zero Bullshit / Clinical Precision

set -e

# SRE: Mode Simulation (Dry-Run)
DRY_RUN=false
for arg in "$@"; do
    if [ "$arg" == "--dry-run" ]; then DRY_RUN=true; log "INFO" "MODE DRY-RUN ACTIVÉ (Simulation)"; fi
done

# Sanitization Helper
sanitize() {
    echo "$1" | sed 's/[^a-zA-Z0-9._-]*//g'
}

# Couleurs & Style
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

# Fichiers & Logs
LOG_FILE=".vibe/logs/setup.log"
mkdir -p "$(dirname "$LOG_FILE")"
exec 3>&1 # Dup stdout sur fd 3

log() {
    local level="$1"; shift
    local msg="$*"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    printf "[%s] [%s] %s\n" "$timestamp" "$level" "$msg" >> "$LOG_FILE"
    case "$level" in
        "ERROR") printf "${RED}${BOLD}[ERROR]${NC} %s\n" "$msg" >&3 ;;
        "SUCCESS") printf "${GREEN}${BOLD}[SUCCESS]${NC} %s\n" "$msg" >&3 ;;
        "WARNING") printf "${YELLOW}${BOLD}[WARNING]${NC} %s\n" "$msg" >&3 ;;
        "INFO") printf "${BLUE}${BOLD}[INFO]${NC} %s\n" "$msg" >&3 ;;
        *) printf "[%s] %s\n" "$level" "$msg" >&3 ;;
    esac
}

# 💠 SRE: Initialisation et Export global de l'environnement (.env)
if [ -f .env ]; then
    set -a
    # shellcheck source=/dev/null
    source .env
    set +a
    log "INFO" "Environnement chargé depuis .env (Domain: ${DOMAIN:-N/A})"
fi

# Gestion des erreurs
cleanup() {
    local exit_code=$?
    if [ $exit_code -ne 0 ]; then
        log "ERROR" "Le script s'est arrêté prématurément (Code: $exit_code)."
    fi
    # Nettoyage des fichiers temporaires (secrets)
    rm -f /tmp/wg-hash-*.js /tmp/wg-env-*.tmp 2>/dev/null
}
trap cleanup EXIT

# Répertoires
API_ENV="api-service/.env"
API_DATA="api-service/data"
WG_DIR="/etc/wireguard"
SWAP_FILE="/swap_wgfux"

preflight_scan() {
    log "INFO" "Lancement du Scan de Pré-vol (v6.5 Multilingual Guardian)..."
    
    # 1. Architecture CPU
    local arch; arch=$(uname -m)
    log "INFO" "Architecture : $arch"
    
    # 2. Mémoire Vive
    local ram_kb; ram_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local ram_mb=$((ram_kb / 1024))
    if [ "$ram_mb" -lt 1024 ]; then
        log "WARNING" "Mémoire vive faible (${ram_mb}MB). Le build Docker pourrait échouer sans swap."
    else
        log "SUCCESS" "Mémoire vive OK (${ram_mb}MB)."
    fi
    
    # 3. Espace Disque (/)
    local free_kb; free_kb=$(df -k / | awk 'NR==2 {print $4}')
    local free_gb=$((free_kb / 1024 / 1024))
    if [ "$free_gb" -lt 5 ]; then
        log "WARNING" "Espace disque restreint (${free_gb}GB libres). 5GB minimum recommandés."
    else
        log "SUCCESS" "Espace disque OK (${free_gb}GB)."
    fi
    
    # 4. Connectivité
    if ping -c 1 8.8.8.8 &>/dev/null; then
        log "SUCCESS" "Connectivité Internet OK."
    else
        log "ERROR" "Pas de connectivité Internet. Impossible de télécharger les dépendances."
        exit 1
    fi

    # 5. WARN-2 : Vérification des permissions /etc/wireguard (critique en production)
    # SRE: Changé de 700 à 755 pour permettre à l'utilisateur wg-api de traverser vers /etc/wireguard/clients
    if [ -d "$WG_DIR" ]; then
        local wg_perms; wg_perms=$(stat -c "%a %U:%G" "$WG_DIR")
        local wg_perm_octal; wg_perm_octal=$(echo "$wg_perms" | awk '{print $1}')
        if [ "$wg_perm_octal" != "755" ]; then
            log "WARNING" "/etc/wireguard permissions = $wg_perms (requis : 755 pour accès API)"
            log "WARNING" "Correction automatique des permissions..."
            sudo chmod 755 "$WG_DIR"
            sudo chown root:root "$WG_DIR"
            log "SUCCESS" "/etc/wireguard configuré à 755 root:root"
        else
            log "SUCCESS" "/etc/wireguard permissions OK ($wg_perms)"
        fi
    fi
}

check_and_install_deps() {
    log "INFO" "Vérification des composants système indispensables..."
    
    local ram_kb; ram_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local ram_mb=$((ram_kb / 1024))

    if ! command -v docker &>/dev/null || ! command -v docker compose version &>/dev/null; then
        log "WARNING" "Docker ou Docker Compose v2 manquant. Installation..."
        install_deps
    else
        # 💠 SRE: Optimisation Docker pour faible RAM (< 1GB)
        if [ "$ram_mb" -lt 1024 ]; then
            log "WARNING" "Faible RAM détectée (< 1GB). Application de l'optimisation SRE Low-RAM..."
            sudo mkdir -p /etc/docker
            sudo tee /etc/docker/daemon.json > /dev/null <<EOF
{
  "max-concurrent-downloads": 1,
  "max-concurrent-uploads": 1,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "iptables": true,
  "default-ulimits": {
    "nofile": {"Name": "nofile", "Hard": 1024, "Soft": 1024}
  }
}
EOF
            log "SUCCESS" "Configuration Docker optimisée pour ${ram_mb}MB de RAM. Redémarrage du service..."
            sudo systemctl restart docker 2>/dev/null || true
        fi
    fi
}

ensure_docker_ready() {
    local max_attempts=40 # Encore plus patient pour les petits VPS
    local attempt=1
    
    # Premier check passif
    if sudo docker ps &>/dev/null; then return 0; fi

    # 💠 SRE: Déblocage agressif du service (Unmask, Reload, Start)
    sudo systemctl unmask docker.service docker.socket 2>/dev/null || true
    sudo systemctl daemon-reload
    sudo systemctl restart docker 2>/dev/null || sudo service docker restart 2>/dev/null || true
    
    while [ $attempt -le $max_attempts ]; do
        if [ -S /run/docker.sock ] || [ -S /var/run/docker.sock ]; then
            if sudo docker ps &>/dev/null; then
                log "SUCCESS" "Docker est prêt et opérationnel."
                return 0
            fi
        fi
        
        # 💠 SRE: Si on arrive à l'essai 20 et que ça ne marche toujours pas, on tente le bootstrap auto
        if [ "$attempt" -eq 20 ]; then
            if [ "${DOCKER_REPAIR_TRIED:-false}" != "true" ]; then
                log "WARNING" "Délai d'attente prolongé (20/40). Tentative de diagnostic/réparation auto..."
                export DOCKER_REPAIR_TRIED=true
                check_and_install_deps
            else
                log "ERROR" "Échec critique: Docker ne répond toujours pas après tentative de réinstallation."
                exit 1
            fi
        fi


        sleep 3
        attempt=$((attempt + 1))
    done

    log "ERROR" "Impossible de joindre le démon Docker après ${max_attempts} essais."
    return 1
}

uninstall() {
    log "WARNING" "Désinstallation de WG-FUX lancée..."
    
    if [ -f "docker-compose.yml" ]; then
        log "INFO" "Arrêt des conteneurs et suppression des volumes..."
        sudo docker compose down -v || true
        
        printf "%b[?] Voulez-vous supprimer les IMAGES Docker du projet (Libère ~3GB) ? (y/N): %b" "${YELLOW}" "${NC}"
        read -r purge_images
        if [[ "$purge_images" =~ ^[yY]$ ]]; then
            log "INFO" "Suppression des images du projet WG-FUX..."
            # SRE SURGICAL: Supprime uniquement les images commençant par wg-fux-
            # Évite d'utiliser 'prune' qui pourrait impacter d'autres services VPS
            sudo docker images "wg-fux-*" -q | xargs -r sudo docker rmi -f 2>/dev/null || true
            # Clean unused builder cache related to our build only
            sudo docker builder prune -f --filter "label=com.docker.compose.project=wg-fux" 2>/dev/null || true
        fi
    fi

    # Nettoyage du Pare-feu (SRE Surgical)
    log "INFO" "Nettoyage des règles du pare-feu pour WG-FUX..."
    local port
    if [ -f "$WG_DIR/manager.conf" ]; then
        port=$(grep SERVER_PORT "$WG_DIR/manager.conf" | cut -d'"' -f2)
    fi
    port=${port:-51820}
    
    printf "%b[?] Voulez-vous retirer les règles de pare-feu pour le port WireGuard ($port/udp) ? (y/N): %b" "${YELLOW}" "${NC}"
    read -r drop_wg_port
    if [[ "$drop_wg_port" =~ ^[yY]$ ]]; then
        sudo ufw delete allow "$port"/udp 2>/dev/null || true
        sudo iptables -D INPUT -p udp --dport "$port" -j ACCEPT 2>/dev/null || true
    fi

    printf "%b[?] Voulez-vous retirer les règles pour les ports Web (80/443) ? (ATTENTION: Ne faites pas cela si d'autres sites sont hébergés sur ce serveur) (y/N): %b" "${YELLOW}" "${NC}"
    read -r drop_web_ports
    if [[ "$drop_web_ports" =~ ^[yY]$ ]]; then
        if command -v ufw &> /dev/null; then
            sudo ufw delete allow 80/tcp 2>/dev/null || true
            sudo ufw delete allow 443/tcp 2>/dev/null || true
        elif command -v iptables &> /dev/null; then
            sudo iptables -D INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
            sudo iptables -D INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
        fi
        log "SUCCESS" "Règles Web retirées."
    fi

    log "INFO" "Désactivation du service Sentinel..."
    sudo systemctl stop sentinel.service 2>/dev/null || true
    sudo systemctl disable sentinel.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/sentinel.service
    sudo systemctl daemon-reload

    log "INFO" "Suppression des fichiers de configuration API..."
    rm -f "$API_ENV"
    rm -rf "$API_DATA"
    rm -f .env

    # Nettoyage des liens symboliques
    log "INFO" "Nettoyage des outils utilitaires..."
    sudo rm -f /usr/local/bin/wg-*.sh 2>/dev/null || true

    if [ -f "$SWAP_FILE" ]; then
        printf "%b[?] Voulez-vous supprimer le fichier Swap ($SWAP_FILE) créé par WG-FUX ? (y/N): %b" "${YELLOW}" "${NC}"
        read -r purge_swap
        if [[ "$purge_swap" =~ ^[yY]$ ]]; then
            log "INFO" "Désactivation et suppression du Swap..."
            sync; sudo tee /proc/sys/vm/drop_caches <<< 3 > /dev/null 2>&1 || true
            if sudo swapoff "$SWAP_FILE" 2>/dev/null || ! swapon --show | grep -q "$SWAP_FILE"; then
                sudo rm -f "$SWAP_FILE"
                log "INFO" "Swap désactivé et supprimé."
            else
                log "WARNING" "Impossible de désactiver le Swap à chaud (Mémoire occupée). Le fichier sera supprimé au prochain reboot par le système si non remonté."
                log "INFO" "Entrée fstab retirée pour éviter le remontage."
            fi
            sudo sed -i "\|# WG-FUX Swap|d" /etc/fstab 2>/dev/null || true
            sudo sed -i "\|$SWAP_FILE|d" /etc/fstab 2>/dev/null || true
        fi
    fi

    printf "%b[?] Voulez-vous supprimer TOUTES les configurations WireGuard dans $WG_DIR ? (y/N): %b" "${YELLOW}" "${NC}"
    read -r purge_wg
    if [[ "$purge_wg" =~ ^[yY]$ ]]; then
        log "INFO" "Suppression de $WG_DIR..."
        sudo rm -rf "$WG_DIR"
    fi

    log "SUCCESS" "Désinstallation de WG-FUX terminée."
    log "INFO" "Note: Le moteur Docker et les outils système sont restés intacts pour vos autres applications."
    exit 0
}

restart_proxy() {
    log "INFO" "Redémarrage du Proxy Sentinel (Nginx)..."
    sudo docker compose restart nginx
    log "SUCCESS" "Proxy redémarré. Les résolutions amont (Upstream) ont été rafraîchies."
}

health_audit() {
    log "INFO" "Lancement de l'Audit de Santé (The Multilingual Guardian v6.5)..."
    if [ -f "./.vibe/tools/vibe-audit-v6.5.sh" ]; then
        chmod +x ./.vibe/tools/vibe-audit-v6.5.sh
        ./.vibe/tools/vibe-audit-v6.5.sh
    else
        log "ERROR" "Script d'audit introuvable."
    fi
}

update_process() {
    log "INFO" "Lancement de la mise à jour (Build & Restart)..."
    if [ ! -f "docker-compose.yml" ]; then
        log "ERROR" "Fichier docker-compose.yml introuvable."
        exit 1
    fi

    # 💠 SRE: Backup current config before update
    log "INFO" "Sauvegarde et Export global de l'env actuelle"
    if [ -f .env ]; then
        set -a
        # shellcheck source=/dev/null
        source .env
        set +a
    fi
    cp "$API_ENV" "${API_ENV}.bak" 2>/dev/null || true

    # 💠 SRE Optimization: Check disk before build
    local free_kb
    free_kb=$(df -k / | awk 'NR==2 {print $4}')
    if [ "$free_kb" -lt 5242880 ]; then # < 5GB free
        log "WARNING" "Espace disque faible (< 5GB). Nettoyage agressif du cache Docker..."
        sudo docker system prune -f 2>/dev/null || true
        sudo docker builder prune -a -f 2>/dev/null || true
    else
        sudo docker builder prune -f --filter "until=24h" 2>/dev/null || true
    fi
    
    # 💠 SRE Logic: Check deps and Open Ports BEFORE anything else
    check_and_install_deps
    setup_firewall
    ensure_docker_ready

    # 💠 SRE: Ensure SSL is ready (Port 80 must be open)
    setup_ssl
    
    log "INFO" "Reconstruction des images et redémarrage des services..."
    if ! sudo DOCKER_BUILDKIT=1 docker compose build; then
        log "ERROR" "Échec de la reconstruction. Annulation..."
        return 1
    fi

    if ! sudo docker compose up -d; then
        log "ERROR" "Échec du lancement des services. Tentative de restauration de la config..."
        mv "${API_ENV}.bak" "$API_ENV" 2>/dev/null || true
        return 1
    fi
    
    # Vérification post-install : attendre que les containers soient healthy
    echo -e "${BLUE}[INFO] Vérification de l'état des containers (max 120s)...${NC}"
    local timeout=120
    local waited=0
    while [ $waited -lt $timeout ]; do
        local unhealthy
        unhealthy=$(sudo docker compose ps --format json 2>/dev/null | \
            python3 -c "import sys,json; data=[json.loads(l) for l in sys.stdin if l.strip()]; \
            bad=[c['Name'] for c in data if c.get('Health','') not in ('healthy','')]; print(' '.join(bad))" 2>/dev/null || echo "")
        if [ -z "$unhealthy" ] || [ "$unhealthy" = " " ]; then
            echo -e "${GREEN}[SUCCESS] Tous les containers sont opérationnels.${NC}"
            break
        fi
        echo -e "${YELLOW}[INFO] Attente des containers: $unhealthy (${waited}s/${timeout}s)...${NC}"
        sleep 10
        waited=$((waited + 10))
    done
    if [ $waited -ge $timeout ]; then
        echo -e "${YELLOW}[WARNING] Timeout atteint. Vérifiez avec: sudo docker compose ps${NC}"
    fi
    
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
    log "INFO" "Récupération des dernières mises à jour depuis Git (Guration et Hard Reset)..."
    git fetch --all 2>/dev/null
    local current_branch
    current_branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")
    
    # 💠 SRE: On force le reset pour éviter les blocages de pull dus aux modifs locales
    if git reset --hard "origin/$current_branch"; then
        log "SUCCESS" "Mise à jour du code source terminée."
        update_process
    else
        log "ERROR" "Échec du reset Git. Vérifiez votre connexion ou l'état du dépôt."
        exit 1
    fi
}

install_deps() {
    log "INFO" "Tentative d'installation des dépendances..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y docker.io docker-compose-v2 wireguard-tools openssl curl nodejs
        sudo systemctl enable --now docker
        ensure_docker_ready
    else
        log "ERROR" "Gestionnaire de paquets 'apt' non trouvé. Veuillez installer manuellement : docker, docker-compose-v2, wireguard-tools, openssl, curl, nodejs."
        exit 1
    fi
}

detect_public_ip() {
    local result
    for service in "ifconfig.me" "api.ipify.org" "ident.me"; do
        result=$(curl -4 -s --max-time 3 "$service" 2>/dev/null)
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
    local target_size_mb=4096 # Standard for low RAM
    local ram_kb
    ram_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local ram_mb=$((ram_kb / 1024))

    # Activation automatique si RAM < 3GB (seuil relevé pour Docker builds)
    if [ "$ram_mb" -lt 3072 ]; then
        log "WARNING" "Mémoire vive réduite détectée (${ram_mb}MB)."

        # 1. Vérification intelligente de TOUT swap actif sur le système
        local swap_active_mb
        swap_active_mb=$(swapon --show=SIZE --bytes --noheadings | awk '{s+=$1} END {print s/1024/1024}')
        swap_active_mb=${swap_active_mb:-0}
        swap_active_mb=$(printf "%.0f" "$swap_active_mb")

        if [ "$swap_active_mb" -gt 1024 ]; then
            log "INFO" "Un swap total suffisant (${swap_active_mb}MB) est déjà présent. Esquive..."
            return 0
        fi

        if [ -f "$SWAP_FILE" ]; then
            log "INFO" "Fichier de swap WG-FUX ($SWAP_FILE) déjà présent."
            if swapon --show | grep -q "$SWAP_FILE"; then
                log "INFO" "Swap déjà actif. Rien à faire."
            else
                sudo chmod 600 "$SWAP_FILE"
                sudo mkswap "$SWAP_FILE" 2>/dev/null || true
                sudo swapon "$SWAP_FILE" 2>/dev/null || true
            fi
            return 0
        fi

        # 2. Calcul de l'espace disque disponible (/)
        local free_kb
        free_kb=$(df -k / | awk 'NR==2 {print $4}')
        local free_mb=$((free_kb / 1024))
        local safety_margin=1024
        local available_for_swap=$((free_mb - safety_margin))

        if [ "$available_for_swap" -lt 512 ]; then
            log "ERROR" "Espace disque critique (${free_mb}MB libre). Impossible de créer un Swap."
            log "INFO" "Libérez de l'espace disque pour permettre le build Docker."
            return 0
        fi

        # Ajuster la taille du swap selon l'espace disponible
        if [ "$target_size_mb" -gt "$available_for_swap" ]; then
            target_size_mb=$available_for_swap
            log "INFO" "Espace disque restreint. Ajustement du Swap à ${target_size_mb}MB."
        fi

        log "INFO" "Création du fichier Swap de ${target_size_mb}MB..."
        
        # Tentative de création avec fallocate puis dd en secours
        if sudo fallocate -l "${target_size_mb}M" "$SWAP_FILE" 2>/dev/null || \
           sudo dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$target_size_mb" status=none; then
            
            sudo chmod 600 "$SWAP_FILE"
            sudo mkswap "$SWAP_FILE" > /dev/null
            if sudo swapon "$SWAP_FILE"; then
                # Persistance
                if ! grep -q "$SWAP_FILE" /etc/fstab; then
                    echo -e "\n# WG-FUX Swap\n$SWAP_FILE none swap sw 0 0" | sudo tee -a /etc/fstab > /dev/null
                fi
                log "SUCCESS" "Swap de ${target_size_mb}MB activé."
            else
                log "ERROR" "Échec de l'activation du swap. Nettoyage..."
                sudo rm -f "$SWAP_FILE"
            fi
        else
            log "ERROR" "Échec physique de création du swap. Nettoyage..."
            sudo rm -f "$SWAP_FILE"
        fi
    fi
}

# --- Gestion SSL & Let's Encrypt (v6.5 - Consolidated) ---
setup_ssl() {
    if [ -f "scripts/setup-ssl.sh" ]; then
        chmod +x scripts/setup-ssl.sh
        bash scripts/setup-ssl.sh
    else
        log "ERROR" "Script scripts/setup-ssl.sh introuvable pour la configuration SSL."
        return 1
    fi
}

setup_firewall() {
    local port="${SERVER_PORT:-51820}"
    log "INFO" "Configuration du pare-feu (Ports: 80, 443, $port/udp)..."

    if command -v ufw &> /dev/null; then
        log "INFO" "Configuration et activation proactive de UFW (Ports: 80, 443, $port/udp, 22/tcp)..."
        sudo ufw allow 80/tcp 2>/dev/null || true
        sudo ufw allow 443/tcp 2>/dev/null || true
        sudo ufw allow "$port"/udp 2>/dev/null || true
        sudo ufw allow 22/tcp 2>/dev/null || true # Garder SSH ouvert
        echo "y" | sudo ufw enable 2>/dev/null || true
        log "SUCCESS" "UFW est maintenant actif et configuré."
    elif command -v iptables &> /dev/null; then
        log "INFO" "Utilisation de iptables..."
        sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
        sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
        sudo iptables -I INPUT -p udp --dport "$port" -j ACCEPT 2>/dev/null || true
        log "SUCCESS" "Règles iptables appliquées."
    else
        log "WARNING" "Aucun gestionnaire de pare-feu (ufw/iptables) détecté. Ouvrez les ports manuellement."
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
echo -e "5) Redémarrage du Proxy API/UI"
echo -e "6) Audit de Santé (Watcher's Eye)"
echo -e "7) Configuration SSL (Let's Encrypt / Certbot)"
read -rp "Choisissez une option [1-7]: " choice

case $choice in
    2) uninstall ;;
    3) update_process ;;
    4) git_upgrade ;;
    5) restart_proxy ;;
    6) health_audit ;;
    7) setup_ssl ;;
    1) echo -e "${GREEN}[INFO] Initialisation de l'installation/configuration...${NC}" ;;
    *) echo -e "${RED}Option invalide.${NC}"; exit 1 ;;
esac

# 1. Vérification/Installation des dépendances (Nouveau Workflow SRE)
check_and_install_deps
ensure_docker_ready

log "INFO" "Démarrage du processus d'installation/configuration..."
preflight_scan

# 2. Gestion de la configuration existante
if [ -f "$API_ENV" ]; then
    log "WARNING" "Une configuration existante a été détectée."
    printf "%b[?] Voulez-vous écraser la configuration actuelle (.env, hash admin, secrets) ? (y/N): %b" "${YELLOW}" "${NC}"
    read -r refresh_conf
    if [[ ! "$refresh_conf" =~ ^[yY]$ ]]; then
        log "INFO" "Conservation de la configuration actuelle. Lancement du build..."
        update_process
    fi
fi

# 3. Configuration Réseau
echo -e "\n${GREEN}[STEP 1] Configuration Réseau${NC}"
DETECTED_IP=$(detect_public_ip)
read -rp "Entrez l'IP publique du serveur [$DETECTED_IP]: " SERVER_IP
SERVER_IP=$(sanitize "${SERVER_IP:-$DETECTED_IP}")

read -rp "Entrez le port WireGuard [51820]: " SERVER_PORT
SERVER_PORT=$(sanitize "${SERVER_PORT:-51820}")

# 4. Authentification Admin
log "INFO" "Étape 2 : Authentification Admin"
printf "%b[?] Username [admin]: %b" "${YELLOW}" "${NC}"
read -r ADMIN_USER
ADMIN_USER=$(sanitize "${ADMIN_USER:-admin}")

read -rsp "Mot de passe admin: " ADMIN_PASS
echo ""
SALT=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -hex 32)
SENTINEL_TOKEN=$(openssl rand -hex 24)

log "INFO" "Génération du hash sécurisé (PBKDF2-SHA512)..."
BUF_SCRIPT=$(mktemp /tmp/wg-hash-XXXXXX.js)
cat > "$BUF_SCRIPT" << 'NODESCRIPT'
const crypto = require('crypto');
const pass = process.env.WGFUX_PASS;
const salt = process.env.WGFUX_SALT;
if (!pass || !salt) { process.exit(1); }
process.stdout.write(crypto.pbkdf2Sync(pass, salt, 600000, 64, 'sha512').toString('hex'));
NODESCRIPT

ADMIN_HASH=""
# Tentative 1 : Node local
if command -v node &>/dev/null; then
    log "INFO" "Utilisation de Node.js local..."
    ADMIN_HASH=$(WGFUX_PASS="$ADMIN_PASS" WGFUX_SALT="$SALT" node "$BUF_SCRIPT" 2>/dev/null || echo "")
fi

# Tentative 2 : Python3 local (Backup ultra-robuste)
if [ -z "$ADMIN_HASH" ] && command -v python3 &>/dev/null; then
    log "INFO" "Node.js absent. Utilisation de Python3 local..."
    ADMIN_HASH=$(WGFUX_PASS="$ADMIN_PASS" WGFUX_SALT="$SALT" python3 -c 'import hashlib, os, binascii; dk = hashlib.pbkdf2_hmac("sha512", os.environ["WGFUX_PASS"].encode(), os.environ["WGFUX_SALT"].encode(), 600000); print(binascii.hexlify(dk).decode())' 2>/dev/null || echo "")
fi

# Tentative 3 : Docker (Dernier recours)
if [ -z "$ADMIN_HASH" ]; then
    log "INFO" "Node/Python absents. Tentative via Docker (node:20-slim)..."
    if sudo docker image inspect node:20-slim &>/dev/null || sudo docker pull node:20-slim &>/dev/null; then
        ADMIN_HASH=$(sudo docker run --rm -e "WGFUX_PASS=$ADMIN_PASS" -e "WGFUX_SALT=$SALT" \
            -v "$BUF_SCRIPT:/tmp/hash.js:ro" node:20-slim node /tmp/hash.js 2>/dev/null || echo "")
    fi
fi

rm -f "$BUF_SCRIPT"

if [ -z "$ADMIN_HASH" ]; then
    log "ERROR" "Échec critique de la génération du hash."
    log "INFO" "Installez manuellement nodejs ou python3 pour continuer."
    exit 1
fi
log "SUCCESS" "Hash généré avec succès."

# 5. WireGuard Keys
log "INFO" "Étape 3 : Génération des clés WireGuard"
if [ ! -d "$WG_DIR" ]; then sudo mkdir -p "$WG_DIR"; fi

if [ ! -f "$WG_DIR/server-private.key" ]; then
    PRIV_KEY=$(wg genkey)
    PUB_KEY=$(echo "$PRIV_KEY" | wg pubkey)
    echo "$PRIV_KEY" | sudo tee "$WG_DIR/server-private.key" > /dev/null
    echo "$PUB_KEY" | sudo tee "$WG_DIR/server-public.key" > /dev/null
    sudo chmod 600 "$WG_DIR/server-private.key"
    log "SUCCESS" "Nouvelles clés WireGuard générées dans $WG_DIR."
else
    log "INFO" "Utilisation des clés existantes dans $WG_DIR."
fi

# 5. Écriture des fichiers
log "INFO" "Étape 4 : Préparation des scripts utilitaires"
# Note: L'API utilise désormais getScriptPath pour une résolution interne robuste.
# On garde les liens symboliques pour l'usage manuel dans le terminal.
SCRIPT_DIR="$(pwd)/core-vpn/scripts"
for script in "$SCRIPT_DIR"/wg-*.sh; do
    if [ -f "$script" ]; then
        target="/usr/local/bin/$(basename "$script")"
        log "INFO" "Lien symbolique : $(basename "$script") -> $target"
        sudo ln -sf "$script" "$target"
        sudo chmod +x "$target"
    fi
done

log "INFO" "Étape 5 : Écriture des fichiers de configuration"

cat <<EOF | sudo tee "$WG_DIR/manager.conf" > /dev/null
SERVER_IP="$SERVER_IP"
SERVER_PORT="$SERVER_PORT"
VPN_SUBNET=10.0.0.0/24
VPN_SUBNET_V6=fd00::/64
CLIENT_DNS=1.1.1.1
SERVER_MTU=1280
WG_INTERFACE=wg0
PERSISTENT_KEEPALIVE=5
EOF

# Sync or create wg0.conf
PRIV_KEY_VAL=$(sudo cat "$WG_DIR/server-private.key")
cat <<EOF | sudo tee "$WG_DIR/wg0.conf" > /dev/null
[Interface]
Address = 10.0.0.1/24, fd00::1/64
ListenPort = $SERVER_PORT
PrivateKey = $PRIV_KEY_VAL
MTU = 1280
SaveConfig = false

PostUp = /usr/local/bin/wg-postup.sh %i
PostDown = /usr/local/bin/wg-postdown.sh %i
EOF

# BUG-FIX: JWT_SECRET écrit directement via printf sans passer par une variable shell
# intermédiaire exposée (protège contre set -x, ps aux, /proc/environ leaks)
# BUG-FIX: Force ALLOWED_ORIGINS dynamique pour inclure le DOMAINE si présent
# SRE: Inclusion du SENTINEL_TOKEN pour le watchdog interne
ALLOWED_ORIGINS="http://$SERVER_IP,https://$SERVER_IP,http://localhost,https://localhost,http://localhost:3000,http://127.0.0.1:3000"
if [ -n "${DOMAIN:-}" ]; then
    ALLOWED_ORIGINS="$ALLOWED_ORIGINS,http://$DOMAIN,https://$DOMAIN"
fi

printf 'PORT=3000\nNODE_ENV="production"\nSENTINEL_TOKEN="%s"\nALLOWED_ORIGINS="%s"\nJWT_SECRET="%s"\nSERVER_IP="%s"\nSERVER_PORT="%s"\nWG_INTERFACE=wg0\nADMIN_USER="%s"\nADMIN_PASSWORD_HASH="%s"\nADMIN_PASSWORD_SALT="%s"\n' \
  "$SENTINEL_TOKEN" "$ALLOWED_ORIGINS" "$JWT_SECRET" "$SERVER_IP" "$SERVER_PORT" "$ADMIN_USER" "$ADMIN_HASH" "$SALT" > "$API_ENV"
# BUG-FIX: Root .env for Docker Compose interpolation (interpolation requires .env in compose file dir)
echo "SERVER_PORT=\"$SERVER_PORT\"" > .env
unset JWT_SECRET ADMIN_HASH SALT ADMIN_PASS

# 6. Sentinel & Alerts
log "INFO" "Étape 6 : Sentinel Monitoring & Alerts (SRE)"
printf "%b[?] Voulez-vous activer les alertes Telegram via Bot API ? (y/N): %b" "${YELLOW}" "${NC}"
read -r enable_telegram
if [[ "$enable_telegram" =~ ^[yY]$ ]]; then
    printf "%b[?] Entrez le Telegram Bot Token: %b" "${YELLOW}" "${NC}"
    read -r TG_TOKEN
    printf "%b[?] Entrez le Telegram Chat ID: %b" "${YELLOW}" "${NC}"
    read -r TG_CHATID
    echo "TELEGRAM_BOT_TOKEN=\"$TG_TOKEN\"" | sudo tee /etc/wireguard/sentinel.conf > /dev/null
    echo "TELEGRAM_CHAT_ID=\"$TG_CHATID\"" | sudo tee -a /etc/wireguard/sentinel.conf > /dev/null
    log "SUCCESS" "Configuration Telegram sauvegardée dans /etc/wireguard/sentinel.conf"
else
    log "INFO" "Alertes Telegram ignorées."
fi

log "INFO" "Installation du service Sentinel Watchdog..."
sudo cp "$(pwd)/core-vpn/scripts/sentinel.service" /etc/systemd/system/sentinel.service
sudo sed -i "s|WorkingDirectory=.*|WorkingDirectory=$(pwd)|" /etc/systemd/system/sentinel.service
sudo sed -i "s|ExecStart=.*|ExecStart=/bin/bash $(pwd)/core-vpn/scripts/sentinel.sh|" /etc/systemd/system/sentinel.service

sudo systemctl daemon-reload
sudo systemctl enable sentinel.service
echo "SENTINEL_TOKEN=\"$SENTINEL_TOKEN\"" | sudo tee core-vpn/scripts/sentinel.env > /dev/null
sudo systemctl restart sentinel.service
log "SUCCESS" "Sentinel Watchdog est actif et surveille le système."

# 7. Finalisation & Lancement
log "SUCCESS" "Configuration terminée."
update_process

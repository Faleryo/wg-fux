#!/bin/bash
# 💠 Vibe-OS v6.5.0-Obsidian+ Hardening
# WG-FUX Setup Script - Orchestration & Configuration
# Author: Antigravity Architect
# Vibe: Zero Bullshit / Clinical Precision

# 💠 SRE: Unification des utilitaires
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
COMMON_SH="$SCRIPT_DIR/core-vpn/scripts/wg-common.sh"

if [ -f "$COMMON_SH" ]; then
    # shellcheck disable=SC1090
    source "$COMMON_SH"
else
    echo -e "\033[0;31m[ERROR] Fichier utilitaire wg-common.sh introuvable.\033[0m"
    exit 1
fi

if [ "$EUID" -ne 0 ]; then
    log_error "Ce script doit être exécuté avec des privilèges root (Sudo)."
    exit 1
fi

# Variables Globales (SRE Hardened)
API_ENV="api-service/.env"
API_DATA="api-service/data"
WG_DIR="/etc/wireguard"
SWAP_FILE="/swap_wgfux"

# SRE: Modes Spéciaux (Simulation, Auto, Désinstallation)
DRY_RUN=false
AUTO_MODE=false
UNINSTALL=false
PURGE=false

for arg in "$@"; do
    case $arg in
        --dry-run) DRY_RUN=true; log_sre "MODE DRY-RUN ACTIVÉ" ;;
        --auto) AUTO_MODE=true; log_sre "MODE AUTO-PILOT ACTIVÉ" ;;
        --uninstall) UNINSTALL=true ;;
        --purge) PURGE=true ;;
    esac
done

if [ "$UNINSTALL" = true ]; then
    if [ "$PURGE" = true ]; then
        uninstall "--purge"
    else
        uninstall
    fi
    exit 0
fi

# 💠 SRE: Initialisation et Export global de l'environnement (.env)
if [ -f .env ]; then
    set -a
    # shellcheck source=/dev/null
    source .env
    set +a
    [ "$DRY_RUN" = true ] && log_sre "Environnement chargé en mode simulation."
    log_info "Environnement chargé depuis .env (Domain: ${DOMAIN:-N/A})"
fi

# Gestion des erreurs
cleanup() {
    local exit_code=$?
    if [ $exit_code -ne 0 ]; then
        log_error "Le script s'est arrêté prématurément (Code: $exit_code)."
    fi
    # Nettoyage des fichiers temporaires (secrets)
    rm -f /tmp/wg-hash-*.js /tmp/wg-env-*.tmp 2>/dev/null
}
trap cleanup EXIT

# --- Module Loading ---
for mod in scripts/setup/*.sh; do
    [ -f "$mod" ] && source "$mod"
done

uninstall() {
    local purge_all=0
    if [[ "${1:-}" == "--purge" ]]; then purge_all=1; fi

    log_warn "Désinstallation de WG-FUX lancée (Grade Obsidian+ Cleanup)..."
    
    # 1. WireGuard Shutdown (Host level)
    if [ -d "$WG_DIR" ]; then
        log_info "Recherche et arrêt des interfaces WireGuard actives..."
        for conf in "$WG_DIR"/*.conf; do
            [ -e "$conf" ] || continue
            interface=$(basename "$conf" .conf)
            if ip link show "$interface" &>/dev/null; then
                log_warn "Arrêt de l'interface $interface..."
                sudo wg-quick down "$interface" 2>/dev/null || true
            fi
        done
    fi

    # 2. Docker Services & Volumes
    if [ -f "docker-compose.yml" ]; then
        log_info "Arrêt des conteneurs et suppression des volumes (incluant SSL)..."
        sudo docker compose down -v || true
        
        local purge_images="n"
        if [ "$purge_all" -eq 1 ] || [ "$AUTO_MODE" = true ]; then purge_images="y"; else
            printf "%b[?] Voulez-vous supprimer les IMAGES Docker du projet (~3GB) ? (y/N): %b" "${YELLOW}" "${NC}"
            read -r purge_images
        fi
        
        if [[ "$purge_images" =~ ^[yY]$ ]]; then
            log_info "Suppression des images du projet WG-FUX..."
            sudo docker images "wg-fux-*" -q | xargs -r sudo docker rmi -f 2>/dev/null || true
            sudo docker builder prune -f --filter "label=com.docker.compose.project=wg-fux" 2>/dev/null || true
        fi
    fi

    # 3. Kernel & Network Hardening Reversion
    log_info "Nettoyage des paramètres Kernel (Sysctl)..."
    if [ -f "/etc/sysctl.d/99-wg-fux.conf" ]; then
        sudo rm -f "/etc/sysctl.d/99-wg-fux.conf"
        sudo sysctl --system > /dev/null 2>&1
        log_success "Paramètres Kernel persistants supprimés."
    fi

    # 4. Firewall Cleanup
    log_info "Nettoyage des règles du pare-feu..."
    local port
    [ -f "$WG_DIR/manager.conf" ] && port=$(grep SERVER_PORT "$WG_DIR/manager.conf" | cut -d'"' -f2)
    port=${port:-51820}
    
    sudo ufw delete allow "$port"/udp 2>/dev/null || true
    sudo iptables -D INPUT -p udp --dport "$port" -j ACCEPT 2>/dev/null || true
    
    local drop_web="n"
    if [ "$purge_all" -eq 1 ] || [ "$AUTO_MODE" = true ]; then drop_web="y"; else
        printf "%b[?] Voulez-vous retirer les règles Web (80/443) ? (y/N): %b" "${YELLOW}" "${NC}"
        read -r drop_web
    fi
    if [[ "$drop_web" =~ ^[yY]$ ]]; then
        sudo ufw delete allow 80/tcp 2>/dev/null || true
        sudo ufw delete allow 443/tcp 2>/dev/null || true
        sudo iptables -D INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
        sudo iptables -D INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
    fi

    # 5. Services & Systemd
    log_info "Désactivation du service Sentinel..."
    sudo systemctl stop sentinel.service 2>/dev/null || true
    sudo systemctl disable sentinel.service 2>/dev/null || true
    sudo rm -f /etc/systemd/system/sentinel.service
    sudo systemctl daemon-reload

    # 6. Docker Daemon Revert (Low-RAM Optimization)
    if [ -f /etc/docker/daemon.json ]; then
        if grep -q "max-concurrent-downloads" /etc/docker/daemon.json; then
            log_warn "Déclaration d'optimisation Low-RAM Docker détectée."
            local revert_docker="n"
            if [ "$purge_all" -eq 1 ]; then revert_docker="y"; else
                printf "%b[?] Voulez-vous réinitialiser la configuration Docker (/etc/docker/daemon.json) ? (y/N): %b" "${YELLOW}" "${NC}"
                read -r revert_docker
            fi
            if [[ "$revert_docker" =~ ^[yY]$ ]]; then
                sudo rm -f /etc/docker/daemon.json
                sudo systemctl restart docker 2>/dev/null || true
                log_success "Configuration Docker réinitialisée."
            fi
        fi
    fi

    # 7. Filesystem & Swap
    log_info "Suppression des configurations et fichiers de données..."
    rm -f "$API_ENV" .env core-vpn/scripts/sentinel.env 2>/dev/null || true
    rm -rf "$API_DATA" 2>/dev/null || true
    sudo rm -rf infra/ssl infra/nginx/ssl 2>/dev/null || true # CRITICAL-Cleanup: Certificates must be removed
    sudo rm -f /usr/local/bin/wg-*.sh 2>/dev/null || true
    rm -f /tmp/wg-hash-*.js 2>/dev/null || true

    if [ -f "$SWAP_FILE" ]; then
        local p_swap="n"
        [ "$purge_all" -eq 1 ] && p_swap="y" || { printf "%b[?] Supprimer le fichier Swap ($SWAP_FILE) ? (y/N): %b" "${YELLOW}" "${NC}"; read -r p_swap; }
        if [[ "$p_swap" =~ ^[yY]$ ]]; then
            log_info "Désactivation et suppression du Swap..."
            sudo swapoff "$SWAP_FILE" 2>/dev/null || true
            sudo rm -f "$SWAP_FILE"
            sudo sed -i "\|# WG-FUX Swap|d" /etc/fstab 2>/dev/null || true
            sudo sed -i "\|$SWAP_FILE|d" /etc/fstab 2>/dev/null || true
            log_success "Swap supprimé."
        fi
    fi

    local p_wg="n"
    [ "$purge_all" -eq 1 ] && p_wg="y" || { printf "%b[?] Supprimer TOUTES les configurations WireGuard ($WG_DIR) ? (y/N): %b" "${YELLOW}" "${NC}"; read -r p_wg; }
    if [[ "$p_wg" =~ ^[yY]$ ]]; then
        sudo rm -rf "$WG_DIR"
        log_success "Dossier $WG_DIR supprimé."
    fi

    log_success "Désinstallation de WG-FUX terminée proprement."
    exit 0
}

restart_proxy() {
    log_info "Redémarrage du Proxy Sentinel (Nginx)..."
    sudo docker compose restart nginx
    log_success "Proxy redémarré. Les résolutions amont (Upstream) ont été rafraîchies."
}

health_audit() {
    log_info "Lancement de l'Audit de Santé (The Multilingual Guardian v6.5)..."
    if [ -f "./.vibe/tools/vibe-audit-v6.5.sh" ]; then
        chmod +x ./.vibe/tools/vibe-audit-v6.5.sh
        bash ./.vibe/tools/vibe-audit-v6.5.sh
    else
        log_error "Script d'audit introuvable."
    fi
}

update_process() {
    log_info "Lancement de la mise à jour (Build & Restart)..."
    if [ ! -f "docker-compose.yml" ]; then
        log_error "Fichier docker-compose.yml introuvable."
        exit 1
    fi

    # 💠 SRE Diamond: Force Swap check before any build to prevent VPS freezing
    setup_swap

    # 💠 SRE: Backup current config before update
    log_info "Sauvegarde et Export global de l'env actuelle"
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
        log_warn "Espace disque faible (< 5GB). Nettoyage agressif du cache Docker..."
        sudo docker system prune -f 2>/dev/null || true
        sudo docker builder prune -a -f 2>/dev/null || true
    else
        sudo docker builder prune -f --filter "until=24h" 2>/dev/null || true
    fi

    # 💠 SRE Logic: Check deps and Open Ports BEFORE anything else
    check_and_install_deps
    setup_firewall
    ensure_docker_ready

    log_info "Reconstruction des images et redémarrage des services..."
    if ! sudo DOCKER_BUILDKIT=1 docker compose build; then
        log_error "Échec de la reconstruction. Annulation..."
        return 1
    fi

    if ! sudo docker compose up -d; then
        log_error "Échec du lancement des services. Tentative de restauration de la config..."
        mv "${API_ENV}.bak" "$API_ENV" 2>/dev/null || true
        return 1
    fi

    # Vérification post-install : attendre que les containers soient healthy
    log_info "Vérification de l'état des containers (max 180s)..."
    local timeout=180
    local waited=0
    while [ $waited -lt $timeout ]; do
        local unhealthy
        unhealthy=$(sudo docker compose ps --format json 2>/dev/null | \
            python3 -c "import sys,json; data=[json.loads(l) for l in sys.stdin if l.strip()]; \
            bad=[c['Name'] for c in data if c.get('Health','') not in ('healthy','')]; print(' '.join(bad))" 2>/dev/null || echo "")
        if [ -z "$unhealthy" ] || [ "$unhealthy" = " " ]; then
            log_success "Tous les containers sont opérationnels."
            break
        fi
        log_info "Attente des containers: $unhealthy (${waited}s/${timeout}s)..."
        sleep 10
        waited=$((waited + 10))
    done
    if [ $waited -ge $timeout ]; then
        log_warn "Timeout atteint. Vérifiez avec: sudo docker compose ps"
    fi

    # 💠 SRE: SSL Bootstrap (Phase 0)
    # Crée un certificat auto-signé temporaire si nécessaire pour permettre à Nginx de démarrer
    setup_ssl_bootstrap

    # 💠 SRE: SSL après le démarrage des services (Nginx doit être UP pour le challenge ACME)
    if [ -n "${DOMAIN:-}" ]; then
        log_info "Lancement de la configuration SSL (Phase 2 / Let's Encrypt)..."
        setup_ssl
    fi

    local ip_final="${SERVER_IP:-$(detect_public_ip)}"
    local domain_display="${DOMAIN:-$ip_final}"
    echo -e "\n${GREEN}==================================================${NC}"
    echo -e "${GREEN}        WG-FUX EST PRÊT À L'ACTION !            ${NC}"
    echo -e "${GREEN}==================================================${NC}"
    echo -e "Dashboard URL (SSL) : ${BLUE}https://${domain_display}${NC}"
    echo -e "Dashboard URL (IP)  : ${BLUE}https://$ip_final${NC}"
    if [ -z "${DOMAIN:-}" ]; then
        echo -e "${YELLOW}[NOTE] Mode IP-only - cert auto-signé. Votre navigateur affichera une${NC}"
        echo -e "${YELLOW}alerte de sécurité - cliquez 'Avancé' puis 'Continuer'. C'est normal.${NC}"
    fi
    echo -e "${GREEN}==================================================${NC}\n"

    exit 0
}


git_upgrade() {
    log_info "Récupération des dernières mises à jour depuis Git (Guration et Hard Reset)..."
    
    # 💠 SRE: Suppression préventive du verrou Git (index.lock) qui peut bloquer les updates
    rm -f .git/index.lock 2>/dev/null || true
    
    # 💠 SRE Diamond: Security check for local changes before hard reset
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        log_warn "Des modifications locales non-commitées ont été détectées."
        if [ "$AUTO_MODE" = false ]; then
            printf "%b[?] ATTENTION : 'Upgrade' va écraser VOS modifications locales. Continuer ? (y/N): %b" "${RED}" "${NC}"
            read -r confirm
            if [[ ! "$confirm" =~ ^[yY]$ ]]; then
                log_info "Upgrade annulé par l'utilisateur."
                exit 0
            fi
        fi
    fi

    git fetch --all 2>/dev/null
    local current_branch
    current_branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")
    
    # 💠 SRE: On stash les modifs locales avant le reset pour éviter de perdre les patches de sécurité
    log_info "Sauvegarde (Stash) des modifications locales..."
    git stash save "WG-FUX Local Hardening Backup $(date +%Y%m%d)" 2>/dev/null || true
    
    # 💠 SRE: On force le reset pour éviter les blocages de pull dus aux modifs locales
    if git reset --hard "origin/$current_branch"; then
        log_success "Mise à jour du code source terminée (Branche: $current_branch)."
        update_process
    else
        log_error "Échec du reset Git. Vérifiez votre connexion ou l'état du dépôt."
        exit 1
    fi
}

# Suppression auto des flags si nécessaire ou gestion par arguments
if [ "${1:-}" == "--uninstall" ]; then shift; uninstall "$@"; fi
if [ "${1:-}" == "--update" ]; then update_process; fi
if [ "${1:-}" == "--upgrade" ]; then git_upgrade; fi

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
    2) uninstall; exit 0 ;;
    3) update_process; exit 0 ;;
    4) git_upgrade; exit 0 ;;
    5) restart_proxy; exit 0 ;;
    6) health_audit; exit 0 ;;
    7) setup_ssl; exit 0 ;;
    1) echo -e "${GREEN}[INFO] Initialisation de l'installation/configuration...${NC}" ;;
    *) echo -e "${RED}Option invalide.${NC}"; exit 1 ;;
esac

# 1. Vérification/Installation des dépendances (Nouveau Workflow SRE)
check_and_install_deps
ensure_docker_ready

log_info "Démarrage du processus d'installation/configuration..."
preflight_scan

# 2. Gestion de la configuration existante
if [ -f "$API_ENV" ]; then
    log_warn "Une configuration existante a été détectée."
    printf "%b[?] Voulez-vous écraser la configuration actuelle (.env, hash admin, secrets) ? (y/N): %b" "${YELLOW}" "${NC}"
    read -r refresh_conf
    if [[ ! "$refresh_conf" =~ ^[yY]$ ]]; then
        log_info "Conservation de la configuration actuelle. Lancement du build..."
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

read -rp "Entrez votre nom de domaine (laisser vide pour utiliser l'IP) : " USER_DOMAIN
DOMAIN=$(sanitize "${USER_DOMAIN:-}")

if [ -n "$DOMAIN" ]; then
    read -rp "Entrez votre email Let's Encrypt (pour les notifications de renouvellement, laisser vide = sans email) : " USER_EMAIL
    EMAIL=$(sanitize "${USER_EMAIL:-}")
else
    EMAIL=""
fi

# 4. Authentification Admin & Security Tokens
log_info "Étape 2 : Sécurité & Authentification"

# SRE-DIAMOND: Reuse existing secrets if they are in the loaded environment
SALT="${ADMIN_PASSWORD_SALT:-$(openssl rand -hex 16)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
SENTINEL_TOKEN="${SENTINEL_TOKEN:-$(openssl rand -hex 24)}"

# SRE-DIAMOND: Automatic CORS configuration (ALLOWED_ORIGINS)
if [ -n "$DOMAIN" ]; then
    ALLOWED_ORIGINS="https://$DOMAIN"
else
    ALLOWED_ORIGINS="http://$SERVER_IP:80,http://$SERVER_IP,http://localhost"
fi

printf "%b[?] Username [admin]: %b" "${YELLOW}" "${NC}"
read -r ADMIN_USER
ADMIN_USER=$(sanitize "${ADMIN_USER:-admin}")

read -rsp "Mot de passe admin: " ADMIN_PASS
echo ""

# 4.1. AdGuard Home Configuration (SRE: Direct integration)
log_info "Étape 2.1 : Authentification AdGuard Home (API Proxy)"
printf "%b[?] AGH Username [admin]: %b" "${YELLOW}" "${NC}"
read -r AGH_USER
AGH_USER=$(sanitize "${AGH_USER:-admin}")

read -rsp "AGH Password: " AGH_PASS
echo ""
# SALT, JWT and SENTINEL are now either reused or generated above.
ADMIN_HASH=$(generate_admin_hash "$ADMIN_PASS" "$SALT")

if [ -z "$ADMIN_HASH" ]; then
    log_error "Échec critique de la génération du hash."
    exit 1
fi
log_success "Hash généré avec succès."

# 5. WireGuard Keys
log_info "Étape 3 : Génération des clés WireGuard"
if [ ! -d "$WG_DIR" ]; then sudo mkdir -p "$WG_DIR"; fi

if [ ! -f "$WG_DIR/server-private.key" ]; then
    PRIV_KEY=$(wg genkey)
    PUB_KEY=$(echo "$PRIV_KEY" | wg pubkey)
    echo "$PRIV_KEY" | sudo tee "$WG_DIR/server-private.key" > /dev/null
    echo "$PUB_KEY" | sudo tee "$WG_DIR/server-public.key" > /dev/null
    sudo chmod 600 "$WG_DIR/server-private.key"
    log_success "Nouvelles clés WireGuard générées dans $WG_DIR."
else
    log_info "Utilisation des clés existantes dans $WG_DIR."
fi

# 5. Écriture des fichiers
log_info "Étape 4 : Préparation des scripts utilitaires"
SCRIPTS_INTERNAL_DIR="$(pwd)/core-vpn/scripts"
for script in "$SCRIPTS_INTERNAL_DIR"/wg-*.sh; do
    if [ -f "$script" ]; then
        target="/usr/local/bin/$(basename "$script")"
        log_info "Lien symbolique : $(basename "$script") -> $target"
        sudo ln -sf "$script" "$target"
        sudo chmod +x "$target"
    fi
done

log_info "Étape 5 : Écriture des fichiers de configuration"

cat <<EOF | sudo tee "$WG_DIR/manager.conf" > /dev/null
SERVER_IP="${SERVER_IP:-}"
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

sudo chmod 600 "$WG_DIR/wg0.conf"

# BUG-FIX: Force ALLOWED_ORIGINS dynamique
ALLOWED_ORIGINS="http://$SERVER_IP,https://$SERVER_IP,http://localhost,https://localhost,http://localhost:3000,http://127.0.0.1:3000"
if [ -n "${DOMAIN:-}" ]; then
    ALLOWED_ORIGINS="$ALLOWED_ORIGINS,http://$DOMAIN,https://${DOMAIN:-}"
fi

# SRE: Inclusion des secrets pour communication interne
cat <<ENDEFF > "$API_ENV"
PORT=3000
NODE_ENV="production"
SENTINEL_TOKEN="$SENTINEL_TOKEN"
ALLOWED_ORIGINS="$ALLOWED_ORIGINS"
JWT_SECRET="$JWT_SECRET"
SERVER_IP="${SERVER_IP:-}"
SERVER_PORT="$SERVER_PORT"
WG_INTERFACE=wg0
ADMIN_USER="$ADMIN_USER"
ADMIN_PASSWORD_HASH="$ADMIN_HASH"
ADMIN_PASSWORD_SALT="$SALT"
AGH_USER="$AGH_USER"
AGH_PASSWORD="$AGH_PASS"
DOMAIN="$DOMAIN"
ENDEFF

cat <<EOF > .env
SERVER_PORT="$SERVER_PORT"
SERVER_IP="$SERVER_IP"
DOMAIN="$DOMAIN"
EMAIL="$EMAIL"
WG_INTERFACE="wg0"
AGH_USER="$AGH_USER"
AGH_PASSWORD="$AGH_PASS"
JWT_SECRET="$JWT_SECRET"
SENTINEL_TOKEN="$SENTINEL_TOKEN"
ADMIN_USER="$ADMIN_USER"
ADMIN_PASSWORD_HASH="$ADMIN_HASH"
ADMIN_PASSWORD_SALT="$SALT"
ALLOWED_ORIGINS="$ALLOWED_ORIGINS"
EOF

unset JWT_SECRET ADMIN_HASH SALT ADMIN_PASS

# 6. Sentinel & Alerts
log_info "Étape 6 : Sentinel Monitoring & Alerts (SRE)"
if [ "$AUTO_MODE" = false ]; then
    printf "%b[?] Voulez-vous activer les alertes Telegram via Bot API ? (y/N): %b" "${YELLOW}" "${NC}"
    read -r enable_telegram
    if [[ "$enable_telegram" =~ ^[yY]$ ]]; then
        printf "%b[?] Entrez le Telegram Bot Token: %b" "${YELLOW}" "${NC}"
        read -r TG_TOKEN
        printf "%b[?] Entrez le Telegram Chat ID: %b" "${YELLOW}" "${NC}"
        read -r TG_CHATID
        echo "TELEGRAM_BOT_TOKEN=\"$TG_TOKEN\"" | sudo tee /etc/wireguard/sentinel.conf > /dev/null
        echo "TELEGRAM_CHAT_ID=\"$TG_CHATID\"" | sudo tee -a /etc/wireguard/sentinel.conf > /dev/null
    fi
fi

log_info "Installation du service Sentinel Watchdog..."
sudo cp "$(pwd)/core-vpn/scripts/sentinel.service" /etc/systemd/system/sentinel.service
sudo sed -i "s|WorkingDirectory=.*|WorkingDirectory=$(pwd)|" /etc/systemd/system/sentinel.service
sudo sed -i "s|ExecStart=.*|ExecStart=/bin/bash $(pwd)/core-vpn/scripts/sentinel.sh|" /etc/systemd/system/sentinel.service

sudo systemctl daemon-reload
sudo systemctl enable sentinel.service
echo "SENTINEL_TOKEN=\"$SENTINEL_TOKEN\"" | sudo tee core-vpn/scripts/sentinel.env > /dev/null
sudo systemctl restart sentinel.service

# 7. Finalisation & Lancement
log_info "Étape 7 : Application des optimisations persistantes..."
sudo bash "$SCRIPT_DIR/core-vpn/scripts/wg-harden.sh"
sudo bash "$SCRIPT_DIR/core-vpn/scripts/wg-optimize.sh" gaming

log_success "Configuration terminée."
update_process

if [ -n "$DOMAIN" ] && [ "$AUTO_MODE" = false ]; then
    printf "%b[?] Voulez-vous lancer la configuration SSL (Let's Encrypt) maintenant ? (Y/n): %b" "${YELLOW}" "${NC}"
    read -r start_ssl
    if [[ ! "$start_ssl" =~ ^[nN]$ ]]; then
        setup_ssl
    fi
fi

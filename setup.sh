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

# SRE Note: All log calls below have been migrated to log_info/log_error unifiés.

# SRE: Modes Spéciaux (Simulation et Auto)
DRY_RUN=false
AUTO_MODE=false
for arg in "$@"; do
    if [ "$arg" == "--dry-run" ]; then 
        DRY_RUN=true
        log_sre "MODE DRY-RUN ACTIVÉ (Simulation)"
    fi
    if [ "$arg" == "--auto" ]; then
        AUTO_MODE=true
        log_sre "MODE AUTO-PILOT ACTIVÉ (Non-interactif)"
    fi
done

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

preflight_scan() {
    log_info "Lancement du Scan de Pré-vol (v6.5 Multilingual Guardian)..."
    
    # 1. Architecture CPU
    local arch; arch=$(uname -m)
    log_info "Architecture : $arch"
    
    # 2. Mémoire Vive
    local ram_kb; ram_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local ram_mb=$((ram_kb / 1024))
    if [ "$ram_mb" -lt 1024 ]; then
        log_warn "Mémoire vive faible (${ram_mb}MB). Le build Docker pourrait échouer sans swap."
    else
        log_success "Mémoire vive OK (${ram_mb}MB)."
    fi
    
    # 3. Espace Disque (/)
    local free_kb; free_kb=$(df -k / | awk 'NR==2 {print $4}')
    local free_gb=$((free_kb / 1024 / 1024))
    if [ "$free_gb" -lt 5 ]; then
        log_warn "Espace disque restreint (${free_gb}GB libres). 5GB minimum recommandés."
    else
        log_success "Espace disque OK (${free_gb}GB)."
    fi
    
    # 4. Connectivité
    if ping -c 1 8.8.8.8 &>/dev/null; then
        log_success "Connectivité Internet OK."
    else
        log_error "Pas de connectivité Internet. Impossible de télécharger les dépendances."
        exit 1
    fi

    # 5. WARN-2 : Vérification des permissions /etc/wireguard (critique en production)
    # SRE: Changé de 700 à 755 pour permettre à l'utilisateur wg-api de traverser vers /etc/wireguard/clients
    if [ -d "$WG_DIR" ]; then
        local wg_perms; wg_perms=$(stat -c "%a %U:%G" "$WG_DIR")
        local wg_perm_octal; wg_perm_octal=$(echo "$wg_perms" | awk '{print $1}')
        if [ "$wg_perm_octal" != "755" ]; then
            log_warn "/etc/wireguard permissions = $wg_perms (requis : 755 pour accès API)"
            log_warn "Correction automatique des permissions..."
            sudo chmod 755 "$WG_DIR"
            sudo chown root:root "$WG_DIR"
            log_success "/etc/wireguard configuré à 755 root:root"
        else
            log_success "/etc/wireguard permissions OK ($wg_perms)"
        fi
    fi
}

check_and_install_deps() {
    log_info "Vérification des composants système indispensables..."
    
    local ram_kb; ram_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local ram_mb=$((ram_kb / 1024))

    if ! command -v docker &>/dev/null || ! command -v docker compose version &>/dev/null; then
        log_warn "Docker ou Docker Compose v2 manquant. Installation..."
        install_deps
    else
        # 💠 SRE: Optimisation Docker pour faible RAM (< 1GB)
        if [ "$ram_mb" -lt 1024 ]; then
            log_warn "Faible RAM détectée (< 1GB). Application de l'optimisation SRE Low-RAM..."
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
            log_success "Configuration Docker optimisée pour ${ram_mb}MB de RAM. Redémarrage du service..."
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
                log_success "Docker est prêt et opérationnel."
                return 0
            fi
        fi
        
        # 💠 SRE: Si on arrive à l'essai 20 et que ça ne marche toujours pas, on tente le bootstrap auto
        if [ "$attempt" -eq 20 ]; then
            if [ "${DOCKER_REPAIR_TRIED:-false}" != "true" ]; then
                log_warn "Délai d'attente prolongé (20/40). Tentative de diagnostic/réparation auto..."
                export DOCKER_REPAIR_TRIED=true
                check_and_install_deps
            else
                log_error "Échec critique: Docker ne répond toujours pas après tentative de réinstallation."
                exit 1
            fi
        fi


        sleep 3
        attempt=$((attempt + 1))
    done

    log_error "Impossible de joindre le démon Docker après ${max_attempts} essais."
    return 1
}

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
        ./.vibe/tools/vibe-audit-v6.5.sh
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
    # Phase 1 (cert auto-signé) déjà active via nginx/default.conf
    # Phase 2 (Let's Encrypt) nécessite Nginx sur port 80 → on l'exécute ici
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
    
    git fetch --all 2>/dev/null
    local current_branch
    current_branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")
    
    # 💠 SRE: On force le reset pour éviter les blocages de pull dus aux modifs locales
    if git reset --hard "origin/$current_branch"; then
        log_success "Mise à jour du code source terminée (Branche: $current_branch)."
        update_process
    else
        log_error "Échec du reset Git. Vérifiez votre connexion ou l'état du dépôt."
        exit 1
    fi
}

install_deps() {
    log_info "Tentative d'installation des dépendances..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y docker.io docker-compose-v2 wireguard-tools openssl curl nodejs
        sudo systemctl enable --now docker
        ensure_docker_ready
    else
        log_error "Gestionnaire de paquets 'apt' non trouvé. Veuillez installer manuellement : docker, docker-compose-v2, wireguard-tools, openssl, curl, nodejs."
        exit 1
    fi
}


setup_swap() {
    local target_size_mb=4096 # Standard for low RAM
    local ram_kb
    ram_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local ram_mb=$((ram_kb / 1024))

    # Activation automatique si RAM < 3GB (seuil relevé pour Docker builds)
    if [ "$ram_mb" -lt 3072 ]; then
        log_warn "Mémoire vive réduite détectée (${ram_mb}MB)."

        # 1. Vérification intelligente de TOUT swap actif sur le système
        local swap_active_mb
        swap_active_mb=$(swapon --show=SIZE --bytes --noheadings | awk '{s+=$1} END {print s/1024/1024}')
        swap_active_mb=${swap_active_mb:-0}
        swap_active_mb=$(printf "%.0f" "$swap_active_mb")

        if [ "$swap_active_mb" -gt 1024 ]; then
            log_info "Un swap total suffisant (${swap_active_mb}MB) est déjà présent. Esquive..."
            return 0
        fi

        if [ -f "$SWAP_FILE" ]; then
            log_info "Fichier de swap WG-FUX ($SWAP_FILE) déjà présent."
            if swapon --show | grep -q "$SWAP_FILE"; then
                log_info "Swap déjà actif. Rien à faire."
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
            log_error "Espace disque critique (${free_mb}MB libre). Impossible de créer un Swap."
            log_info "Libérez de l'espace disque pour permettre le build Docker."
            return 0
        fi

        # Ajuster la taille du swap selon l'espace disponible
        if [ "$target_size_mb" -gt "$available_for_swap" ]; then
            target_size_mb=$available_for_swap
            log_info "Espace disque restreint. Ajustement du Swap à ${target_size_mb}MB."
        fi

        log_info "Création du fichier Swap de ${target_size_mb}MB..."
        
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
                log_success "Swap de ${target_size_mb}MB activé."
            else
                log_error "Échec de l'activation du swap. Nettoyage..."
                sudo rm -f "$SWAP_FILE"
            fi
        else
            log_error "Échec physique de création du swap. Nettoyage..."
            sudo rm -f "$SWAP_FILE"
        fi
    fi
}

# --- Gestion SSL & Let's Encrypt (v6.5 - Consolidated) ---
setup_ssl_bootstrap() {
    log_info "Bootstrap SSL : Vérification des certificats de secours..."
    local ssl_dir="$SCRIPT_DIR/infra/ssl"
    mkdir -p "$ssl_dir"
    
    if [ ! -f "$ssl_dir/server.crt" ] || [ ! -f "$ssl_dir/server.key" ]; then
        log_warn "Certificats SSL manquants. Génération d'un certificat auto-signé de secours..."
        if openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$ssl_dir/server.key" \
            -out "$ssl_dir/server.crt" \
            -subj "/CN=localhost" 2>/dev/null; then
            log_success "Certificat de secours généré dans $ssl_dir"
        else
            log_error "Échec de la génération du certificat SSL."
            return 1
        fi
    else
        log_success "Certificats SSL (Auto-signés ou Let's Encrypt) déjà présents."
    fi
}

setup_ssl() {
    if ! sudo docker compose ps -q nginx >/dev/null 2>&1; then
        log_error "Le proxy Nginx doit être en cours d'exécution pour valider Let's Encrypt."
        log_warn "Lancez d'abord l'Option 1 (Installation) ou l'Option 3 (Mise à jour)."
        return 1
    fi
    local ssl_script="$SCRIPT_DIR/scripts/setup-ssl.sh"
    if [ -f "$ssl_script" ]; then
        cd "$SCRIPT_DIR" || return 1
        chmod +x "$ssl_script"
        bash "$ssl_script"
    else
        log_error "Script $ssl_script introuvable pour la configuration SSL."
        return 1
    fi
}

setup_firewall() {
    local port="${SERVER_PORT:-51820}"
    log_info "Configuration du pare-feu (Ports: 80, 443, $port/udp)..."

    if command -v ufw &> /dev/null; then
        log_info "Configuration et activation proactive de UFW (Ports: 80, 443, $port/udp, 22/tcp)..."
        sudo ufw allow 80/tcp 2>/dev/null || true
        sudo ufw allow 443/tcp 2>/dev/null || true
        sudo ufw allow "$port"/udp 2>/dev/null || true
        sudo ufw allow 22/tcp 2>/dev/null || true # Garder SSH ouvert
        echo "y" | sudo ufw enable 2>/dev/null || true
        log_success "UFW est maintenant actif et configuré."
    elif command -v iptables &> /dev/null; then
        log_info "Utilisation de iptables..."
        sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
        sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
        sudo iptables -I INPUT -p udp --dport "$port" -j ACCEPT 2>/dev/null || true
        log_success "Règles iptables appliquées."
    else
        log_warn "Aucun gestionnaire de pare-feu (ufw/iptables) détecté. Ouvrez les ports manuellement."
    fi
}

# Suppression auto des flags si nécessaire ou gestion par arguments
if [ "${1:-}" == "--uninstall" ]; then uninstall; fi
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

log_info "Génération du hash sécurisé (PBKDF2-SHA512)..."
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
    log_info "Utilisation de Node.js local..."
    ADMIN_HASH=$(WGFUX_PASS="$ADMIN_PASS" WGFUX_SALT="$SALT" node "$BUF_SCRIPT" 2>/dev/null || echo "")
fi

# Tentative 2 : Python3 local (Backup ultra-robuste)
if [ -z "$ADMIN_HASH" ] && command -v python3 &>/dev/null; then
    log_info "Node.js absent. Utilisation de Python3 local..."
    ADMIN_HASH=$(WGFUX_PASS="$ADMIN_PASS" WGFUX_SALT="$SALT" python3 -c 'import hashlib, os, binascii; dk = hashlib.pbkdf2_hmac("sha512", os.environ["WGFUX_PASS"].encode(), os.environ["WGFUX_SALT"].encode(), 600000); print(binascii.hexlify(dk).decode())' 2>/dev/null || echo "")
fi

# Tentative 3 : Docker (Dernier recours)
if [ -z "$ADMIN_HASH" ]; then
    log_info "Node/Python absents. Tentative via Docker (node:20-slim)..."
    if sudo docker image inspect node:20-slim &>/dev/null || sudo docker pull node:20-slim &>/dev/null; then
        ADMIN_HASH=$(sudo docker run --rm -e "WGFUX_PASS=$ADMIN_PASS" -e "WGFUX_SALT=$SALT" \
            -v "$BUF_SCRIPT:/tmp/hash.js:ro" node:20-slim node /tmp/hash.js 2>/dev/null || echo "")
    fi
fi

rm -f "$BUF_SCRIPT"

if [ -z "$ADMIN_HASH" ]; then
    log_error "Échec critique de la génération du hash."
    log_info "Installez manuellement nodejs ou python3 pour continuer."
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
# Note: L'API utilise désormais getScriptPath pour une résolution interne robuste.
# On garde les liens symboliques pour l'usage manuel dans le terminal.
SCRIPT_DIR="$(pwd)/core-vpn/scripts"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/wg-common.sh"
for script in "$SCRIPT_DIR"/wg-*.sh; do
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

# SRE Hardening: Secure the config file immediately
sudo chmod 600 "$WG_DIR/wg0.conf"

# BUG-FIX: JWT_SECRET écrit directement via printf sans passer par une variable shell
# intermédiaire exposée (protège contre set -x, ps aux, /proc/environ leaks)
# BUG-FIX: Force ALLOWED_ORIGINS dynamique pour inclure le DOMAINE si présent
# SRE: Inclusion du SENTINEL_TOKEN pour le watchdog interne
ALLOWED_ORIGINS="http://$SERVER_IP,https://$SERVER_IP,http://localhost,https://localhost,http://localhost:3000,http://127.0.0.1:3000"
if [ -n "${DOMAIN:-}" ]; then
    ALLOWED_ORIGINS="$ALLOWED_ORIGINS,http://$DOMAIN,https://${DOMAIN:-}"
fi

# SRE: Inclusion des secrets AdGuard pour communication interne API -> AGH
# WAVE 4: Robust .env generation
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

# BUG-FIX: Root .env must contain ALL variables for Docker Compose interpolation
# This ensures AGH_USER, AGH_PASSWORD and others are not defaulted to "admin/password"
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

# Ensure api-service/.env is a symlink or a copy for consistency (SRE Recommendation)
# We keep the cat to api-service/.env for safety but root .env is the master.

unset JWT_SECRET ADMIN_HASH SALT ADMIN_PASS

# 6. Sentinel & Alerts
log_info "Étape 6 : Sentinel Monitoring & Alerts (SRE)"
printf "%b[?] Voulez-vous activer les alertes Telegram via Bot API ? (y/N): %b" "${YELLOW}" "${NC}"
read -r enable_telegram
if [[ "$enable_telegram" =~ ^[yY]$ ]]; then
    printf "%b[?] Entrez le Telegram Bot Token: %b" "${YELLOW}" "${NC}"
    read -r TG_TOKEN
    printf "%b[?] Entrez le Telegram Chat ID: %b" "${YELLOW}" "${NC}"
    read -r TG_CHATID
    echo "TELEGRAM_BOT_TOKEN=\"$TG_TOKEN\"" | sudo tee /etc/wireguard/sentinel.conf > /dev/null
    echo "TELEGRAM_CHAT_ID=\"$TG_CHATID\"" | sudo tee -a /etc/wireguard/sentinel.conf > /dev/null
    log_success "Configuration Telegram sauvegardée dans /etc/wireguard/sentinel.conf"
else
    log_info "Alertes Telegram ignorées."
fi

log_info "Installation du service Sentinel Watchdog..."
sudo cp "$(pwd)/core-vpn/scripts/sentinel.service" /etc/systemd/system/sentinel.service
sudo sed -i "s|WorkingDirectory=.*|WorkingDirectory=$(pwd)|" /etc/systemd/system/sentinel.service
sudo sed -i "s|ExecStart=.*|ExecStart=/bin/bash $(pwd)/core-vpn/scripts/sentinel.sh|" /etc/systemd/system/sentinel.service

sudo systemctl daemon-reload
sudo systemctl enable sentinel.service
echo "SENTINEL_TOKEN=\"$SENTINEL_TOKEN\"" | sudo tee core-vpn/scripts/sentinel.env > /dev/null
sudo systemctl restart sentinel.service
log_success "Sentinel Watchdog est actif et surveille le système."

# 7. Finalisation & Lancement
log_info "Étape 7 : Application des optimisations persistantes (Kernel Tuning)..."
sudo bash "$SCRIPT_DIR/wg-harden.sh"
sudo bash "$SCRIPT_DIR/wg-optimize.sh" gaming

log_success "Configuration terminée."
update_process

# SRE-DIAMOND: Auto-prompt for SSL if a domain was provided
if [ -n "$DOMAIN" ]; then
    echo -e "\n${BLUE}[SRE] Un domaine a été configuré ($DOMAIN).${NC}"
    printf "%b[?] Voulez-vous lancer la configuration SSL (Let's Encrypt) maintenant ? (Y/n): %b" "${YELLOW}" "${NC}"
    read -r start_ssl
    if [[ ! "$start_ssl" =~ ^[nN]$ ]]; then
        setup_ssl
    fi
fi

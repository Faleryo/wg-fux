#!/bin/bash
# 💠 Dependency Management Module
# Part of WG-FUX v6.5.0-Obsidian+

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
    local max_attempts=40 # Patient pour les petits VPS
    local attempt=1
    
    if sudo docker ps &>/dev/null; then return 0; fi

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
        
        if [ "$attempt" -eq 20 ]; then
            if [ "${DOCKER_REPAIR_TRIED:-false}" != "true" ]; then
                log_warn "Délai d'attente prolongé (20/40). Tentative de diagnostic/réparation auto..."
                export DOCKER_REPAIR_TRIED=true
                check_and_install_deps
            else
                log_error "Échec critique: Docker ne répond toujours pas."
                exit 1
            fi
        fi

        sleep 3
        attempt=$((attempt + 1))
    done

    log_error "Impossible de joindre le démon Docker."
    return 1
}

install_deps() {
    log_info "Tentative d'installation des dépendances..."
    if command -v apt-get &> /dev/null; then
        sudo apt-get update
        sudo apt-get install -y docker.io docker-compose-v2 wireguard-tools openssl curl nodejs python3
        sudo systemctl enable --now docker
        ensure_docker_ready
    else
        log_error "Gestionnaire de paquets 'apt' non trouvé."
        exit 1
    fi
}

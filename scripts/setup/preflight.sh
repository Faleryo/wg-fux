#!/bin/bash
# Preflight host checks. Read-only — never modifies state except chmod /etc/wireguard.

preflight_scan() {
    log_info "Preflight…"

    local arch; arch=$(uname -m)
    log_info "  arch          : $arch"

    local ram_kb ram_mb
    ram_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    ram_mb=$((ram_kb / 1024))
    if [ "$ram_mb" -lt 1024 ]; then
        log_warn "  ram           : ${ram_mb}MB (<1GB — docker build may need swap)"
    else
        log_success "  ram           : ${ram_mb}MB"
    fi

    # Seuil calibré sur une installation réelle : les images de la pile (api, ui,
    # AdGuard, nginx, certbot) + leur construction occupent ~4,5 Go. En dessous
    # de 6 Go libres, `docker build` échoue en cours de route sur « no space left
    # on device » — mieux vaut le dire ICI que vingt minutes plus tard.
    local free_kb free_gb
    free_kb=$(df -k / | awk 'NR==2 {print $4}')
    free_gb=$((free_kb / 1024 / 1024))
    if [ "$free_gb" -lt 6 ]; then
        log_warn "  disk free /   : ${free_gb}GB (<6GB — la construction des images risque d'échouer ;"
        log_warn "                  prévoir ~6GB libres, ou un disque de 15GB pour être confortable)"
    else
        log_success "  disk free /   : ${free_gb}GB"
    fi

    if ping -c 1 -W 3 1.1.1.1 &>/dev/null || ping -c 1 -W 3 8.8.8.8 &>/dev/null; then
        log_success "  network       : ok"
    else
        log_error "  network       : no outbound connectivity"
        return 1
    fi

    # /etc/wireguard exists & is readable (normalize permissions for safety)
    if [ -d "$WG_DIR" ]; then
        local perms; perms=$(stat -c "%a %U:%G" "$WG_DIR")
        if [ "$(echo "$perms" | awk '{print $1}')" != "755" ]; then
            log_warn "  $WG_DIR : perms=$perms — normalising to 755 root:root"
            sudo chmod 755 "$WG_DIR"
            sudo chown root:root "$WG_DIR"
        else
            log_success "  $WG_DIR : 755 root:root"
        fi
    fi
}

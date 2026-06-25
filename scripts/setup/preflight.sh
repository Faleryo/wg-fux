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

    local free_kb free_gb
    free_kb=$(df -k / | awk 'NR==2 {print $4}')
    free_gb=$((free_kb / 1024 / 1024))
    if [ "$free_gb" -lt 5 ]; then
        log_warn "  disk free /   : ${free_gb}GB (<5GB — may run out during build)"
    else
        log_success "  disk free /   : ${free_gb}GB"
    fi

    if ping -c 1 -W 3 1.1.1.1 &>/dev/null || ping -c 1 -W 3 8.8.8.8 &>/dev/null; then
        log_success "  network       : ok"
    else
        log_error "  network       : no outbound connectivity"
        return 1
    fi

    # /etc/wireguard exists & is readable
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

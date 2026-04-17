#!/bin/bash
# 💠 Swap & SSL Module
# Part of WG-FUX v6.5.0-Obsidian+

setup_swap() {
    local target_size_mb=4096
    local ram_kb; ram_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local ram_mb=$((ram_kb / 1024))

    if [ "$ram_mb" -lt 3072 ]; then
        log_warn "Mémoire vive réduite détectée (${ram_mb}MB)."
        local swap_active_mb; swap_active_mb=$(swapon --show=SIZE --bytes --noheadings | awk '{s+=$1} END {print s/1024/1024}')
        swap_active_mb=$(printf "%.0f" "${swap_active_mb:-0}")

        if [ "$swap_active_mb" -gt 1024 ]; then
            log_info "Swap suffisant déjà présent."
            return 0
        fi

        if [ -f "$SWAP_FILE" ]; then
            sudo swapon "$SWAP_FILE" 2>/dev/null || true
            return 0
        fi

        log_info "Création du Swap de ${target_size_mb}MB..."
        if sudo fallocate -l "${target_size_mb}M" "$SWAP_FILE" 2>/dev/null || \
           sudo dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$target_size_mb" status=none; then
            sudo chmod 600 "$SWAP_FILE"
            sudo mkswap "$SWAP_FILE" > /dev/null
            if sudo swapon "$SWAP_FILE"; then
                echo -e "\n# WG-FUX Swap\n$SWAP_FILE none swap sw 0 0" | sudo tee -a /etc/fstab > /dev/null
                log_success "Swap activé."
            fi
        fi
    fi
}

setup_ssl_bootstrap() {
    local ssl_dir="$SCRIPT_DIR/infra/ssl"
    mkdir -p "$ssl_dir"
    if [ ! -f "$ssl_dir/server.crt" ]; then
        log_warn "Génération certificat SSL de secours..."
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout "$ssl_dir/server.key" -out "$ssl_dir/server.crt" \
            -subj "/CN=localhost" 2>/dev/null
    fi
}

setup_ssl() {
    local ssl_script="core-vpn/scripts/setup-ssl.sh"
    if [ -f "$ssl_script" ]; then
        bash "$ssl_script"
    else
        log_error "Script SSL introuvable."
        return 1
    fi
}

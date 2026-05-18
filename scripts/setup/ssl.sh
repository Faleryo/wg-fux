#!/bin/bash
# Swap, SSL bootstrap & Let's Encrypt orchestration.

setup_swap() {
    local target_mb=4096
    local ram_mb; ram_mb=$(($(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024))

    [ "$ram_mb" -ge 3072 ] && return 0   # plenty of ram — skip swap

    local active_mb
    active_mb=$(swapon --show=SIZE --bytes --noheadings 2>/dev/null | \
                awk '{s+=$1} END {printf "%d", s/1024/1024}')
    active_mb="${active_mb:-0}"
    if [ "$active_mb" -gt 1024 ]; then
        log_info "Swap already adequate (${active_mb}MB active)."
        return 0
    fi

    if [ -f "$SWAP_FILE" ]; then
        log_info "Re-enabling existing swap file."
        sudo swapon "$SWAP_FILE" 2>/dev/null || true
        return 0
    fi

    log_info "Creating ${target_mb}MB swap file at $SWAP_FILE…"
    if sudo fallocate -l "${target_mb}M" "$SWAP_FILE" 2>/dev/null \
       || sudo dd if=/dev/zero of="$SWAP_FILE" bs=1M count="$target_mb" status=none; then
        sudo chmod 600 "$SWAP_FILE"
        sudo mkswap "$SWAP_FILE" >/dev/null
        if sudo swapon "$SWAP_FILE"; then
            if ! grep -q "$SWAP_FILE" /etc/fstab 2>/dev/null; then
                printf '\n# WG-FUX Swap\n%s none swap sw 0 0\n' "$SWAP_FILE" | \
                    sudo tee -a /etc/fstab >/dev/null
            fi
            log_success "Swap active and persisted."
        fi
    else
        log_warn "Failed to create swap file (continuing without)."
    fi
}

setup_ssl_bootstrap() {
    local ssl_dir="$SCRIPT_DIR/infra/ssl"
    mkdir -p "$ssl_dir"
    if [ -f "$ssl_dir/server.crt" ] && [ -f "$ssl_dir/server.key" ]; then
        return 0
    fi
    log_info "Generating self-signed cert (bootstrap so nginx can start)…"
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "$ssl_dir/server.key" \
        -out    "$ssl_dir/server.crt" \
        -subj "/CN=${DOMAIN:-localhost}" 2>/dev/null
    chmod 600 "$ssl_dir/server.key"
    chmod 644 "$ssl_dir/server.crt"
}

setup_ssl() {
    local ssl_script="$SCRIPT_DIR/scripts/setup-ssl.sh"
    if [ ! -f "$ssl_script" ]; then
        log_error "scripts/setup-ssl.sh missing — cannot run Let's Encrypt."
        return 1
    fi
    bash "$ssl_script"
}

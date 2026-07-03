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
    DOMAIN="$DOMAIN" EMAIL="$EMAIL" bash "$ssl_script"
}

# ── Sauvegarde / restauration des certificats Let's Encrypt ──────────────────
# Les certs vivent dans le volume Docker `*_certbot_certs`. Let's Encrypt limite
# les émissions (5 certs identiques / semaine) : perdre les certs à une
# désinstallation puis en redemander à la réinstallation peut BLOQUER l'accès
# HTTPS pendant une semaine. On sauvegarde donc vers un tarball hôte portable et
# on restaure automatiquement à l'installation si le volume est vide.
LE_BACKUP_FILE="${LE_BACKUP_FILE:-/var/backups/wg-fux-letsencrypt.tar.gz}"

_certbot_volume() {
    sudo docker volume ls -q --filter name=certbot_certs 2>/dev/null | head -1
}

# Sauvegarde le volume des certificats vers $LE_BACKUP_FILE (best-effort).
backup_letsencrypt_certs() {
    local vol; vol=$(_certbot_volume)
    [ -n "$vol" ] || { log_warn "Aucun volume de certificats à sauvegarder."; return 1; }
    sudo mkdir -p "$(dirname "$LE_BACKUP_FILE")"
    if sudo docker run --rm -v "$vol":/data:ro \
            -v "$(dirname "$LE_BACKUP_FILE")":/backup alpine \
            tar czf "/backup/$(basename "$LE_BACKUP_FILE")" -C /data . >/dev/null 2>&1; then
        sudo chmod 600 "$LE_BACKUP_FILE" 2>/dev/null || true
        log_success "Certificats Let's Encrypt sauvegardés → $LE_BACKUP_FILE"
        return 0
    fi
    log_warn "Échec de la sauvegarde des certificats."
    return 1
}

# Restaure les certs depuis le tarball SI le volume ne contient pas déjà de
# certs live. Appelé à l'installation, après `docker compose up` (volume créé).
restore_letsencrypt_certs() {
    [ -f "$LE_BACKUP_FILE" ] || return 0
    local vol; vol=$(_certbot_volume)
    [ -n "$vol" ] || return 0   # volume pas encore là : rien à faire
    # Ne restaure pas par-dessus des certs déjà présents.
    if sudo docker run --rm -v "$vol":/data alpine \
            sh -c '[ -d /data/live ] && [ -n "$(ls -A /data/live 2>/dev/null)" ]' >/dev/null 2>&1; then
        return 0
    fi
    log_info "Restauration des certificats Let's Encrypt depuis $LE_BACKUP_FILE…"
    if sudo docker run --rm -v "$vol":/data \
            -v "$(dirname "$LE_BACKUP_FILE")":/backup:ro alpine \
            tar xzf "/backup/$(basename "$LE_BACKUP_FILE")" -C /data >/dev/null 2>&1; then
        log_success "Certificats restaurés — Let's Encrypt ne sera pas re-sollicité."
    else
        log_warn "Échec de la restauration (on continuera avec certbot)."
    fi
}

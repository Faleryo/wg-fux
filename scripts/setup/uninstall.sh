#!/bin/bash
# Uninstall module — stops services and removes wg-fux artifacts.
#
# Honours: $PURGE (true = skip confirmations), $AUTO (true = same).

# shellcheck disable=SC2154   # globals come from setup.sh

_uninstall_confirm() {
    local prompt="$1" default="${2:-n}"
    if [ "${PURGE:-false}" = true ] || [ "${AUTO:-false}" = true ]; then
        [[ "$default" =~ ^[yY]$ ]] && return 0
        # In AUTO mode without PURGE, destructive operations require explicit opt-in
        return 1
    fi
    ask_yes_no "$prompt" "$default"
}

do_uninstall() {
    log_warn "Uninstalling wg-fux…"

    _maybe_preserve_certs
    _stop_wg_interfaces
    _stop_docker
    _maybe_remove_images
    _cleanup_sysctl
    _cleanup_firewall
    _cleanup_systemd
    _maybe_revert_docker_daemon
    _cleanup_files
    _maybe_remove_swap
    _maybe_remove_wg_dir

    if [ "${KEEP_CERTS:-false}" = true ]; then
        log_success "Certificats conservés (${LE_BACKUP_FILE:-/var/backups/wg-fux-letsencrypt.tar.gz} + volume Docker). Ils seront réutilisés automatiquement à la réinstallation."
    fi
    log_success "wg-fux uninstall finished."
}

_stop_wg_interfaces() {
    [ -d "$WG_DIR" ] || return 0
    for conf in "$WG_DIR"/*.conf; do
        [ -e "$conf" ] || continue
        local iface; iface=$(basename "$conf" .conf)
        if ip link show "$iface" &>/dev/null; then
            log_info "Stopping interface $iface…"
            sudo wg-quick down "$iface" 2>/dev/null || true
        fi
    done
}

# Propose de conserver les certificats Let's Encrypt (défaut : OUI). Si accepté,
# on les sauvegarde dans un tarball hôte ET on garde le volume Docker (KEEP_CERTS)
# → réutilisables tels quels à la prochaine installation, sans re-solliciter
# Let's Encrypt (sa limite hebdomadaire peut bloquer l'accès HTTPS 1 semaine).
KEEP_CERTS=false
_maybe_preserve_certs() {
    [ -f docker-compose.yml ] || return 0
    # Rien à préserver s'il n'y a pas de volume de certs.
    [ -n "$(_certbot_volume 2>/dev/null)" ] || return 0
    if _uninstall_confirm "Conserver les certificats Let's Encrypt pour un futur usage ?" "y"; then
        KEEP_CERTS=true
        backup_letsencrypt_certs || true
    fi
}

_stop_docker() {
    [ -f docker-compose.yml ] || return 0
    if [ "${KEEP_CERTS:-false}" = true ]; then
        # `down` SANS -v : les volumes (dont les certificats) survivent et seront
        # réutilisés si l'on réinstalle dans ce même dossier.
        log_info "Stopping containers (volumes préservés)…"
        sudo docker compose down || true
    else
        log_info "Stopping containers and removing volumes…"
        sudo docker compose down -v || true
    fi
}

_maybe_remove_images() {
    if _uninstall_confirm "Remove docker images for this project (~3GB)?" "n"; then
        log_info "Removing wg-fux images…"
        sudo docker images "wg-fux-*" -q 2>/dev/null | xargs -r sudo docker rmi -f 2>/dev/null || true
        sudo docker builder prune -f --filter "label=com.docker.compose.project=wg-fux" 2>/dev/null || true
    fi
}

_cleanup_sysctl() {
    if [ -f /etc/sysctl.d/99-wg-fux.conf ]; then
        log_info "Removing kernel sysctl tunings…"
        sudo rm -f /etc/sysctl.d/99-wg-fux.conf
        sudo sysctl --system >/dev/null 2>&1 || true
    fi
}

_cleanup_firewall() {
    log_info "Removing firewall rules…"
    local port="${SERVER_PORT:-51820}"
    [ -f "$WG_DIR/manager.conf" ] && \
        port=$(grep SERVER_PORT "$WG_DIR/manager.conf" | cut -d'"' -f2)
    port=${port:-51820}

    sudo ufw delete allow "$port"/udp 2>/dev/null || true
    sudo iptables -D INPUT -p udp --dport "$port" -j ACCEPT 2>/dev/null || true

    if _uninstall_confirm "Remove web firewall rules (80/443)?" "n"; then
        sudo ufw delete allow 80/tcp 2>/dev/null || true
        sudo ufw delete allow 443/tcp 2>/dev/null || true
        sudo iptables -D INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
        sudo iptables -D INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
    fi
}

_cleanup_systemd() {
    if [ -f /etc/systemd/system/sentinel.service ]; then
        log_info "Disabling sentinel watchdog…"
        sudo systemctl stop sentinel.service 2>/dev/null || true
        sudo systemctl disable sentinel.service 2>/dev/null || true
        sudo rm -f /etc/systemd/system/sentinel.service
        sudo systemctl daemon-reload
    fi
}

_maybe_revert_docker_daemon() {
    [ -f /etc/docker/daemon.json ] || return 0
    grep -q "max-concurrent-downloads" /etc/docker/daemon.json || return 0
    if _uninstall_confirm "Reset Docker daemon config (/etc/docker/daemon.json)?" "n"; then
        sudo rm -f /etc/docker/daemon.json
        sudo systemctl restart docker 2>/dev/null || true
    fi
}

_cleanup_files() {
    log_info "Removing configuration files and data…"
    rm -f "$API_ENV" "$ROOT_ENV" core-vpn/scripts/sentinel.env 2>/dev/null || true
    rm -rf "$API_DATA" 2>/dev/null || true
    sudo rm -rf infra/ssl infra/nginx/ssl 2>/dev/null || true
    sudo rm -f /usr/local/bin/wg-*.sh 2>/dev/null || true
    rm -f /tmp/wg-hash-*.js 2>/dev/null || true
}

_maybe_remove_swap() {
    [ -f "$SWAP_FILE" ] || return 0
    if _uninstall_confirm "Remove swap file ($SWAP_FILE)?" "n"; then
        log_info "Removing swap…"
        sudo swapoff "$SWAP_FILE" 2>/dev/null || true
        sudo rm -f "$SWAP_FILE"
        sudo sed -i "\|# WG-FUX Swap|d" /etc/fstab 2>/dev/null || true
        sudo sed -i "\|$SWAP_FILE|d" /etc/fstab 2>/dev/null || true
    fi
}

_maybe_remove_wg_dir() {
    [ -d "$WG_DIR" ] || return 0
    if _uninstall_confirm "Delete ALL WireGuard configs in $WG_DIR ?" "n"; then
        sudo rm -rf "$WG_DIR"
        log_success "$WG_DIR removed."
    fi
}

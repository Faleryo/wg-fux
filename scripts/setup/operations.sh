#!/bin/bash
# Operations module for setup.sh — adds 12 maintenance commands.

WG_SCRIPTS="$SCRIPT_DIR/core-vpn/scripts"

# ─── cmd_backup ─────────────────────────────────────────────────
cmd_backup() {
    require_root
    local script="$WG_SCRIPTS/wg-backup.sh"
    [ -x "$script" ] || { log_error "wg-backup.sh not found or not executable."; exit 1; }
    exec bash "$script"
}

# ─── cmd_restore ────────────────────────────────────────────────
cmd_restore() {
    require_root
    local backup_file="${1:-}"
    if [ -z "$backup_file" ]; then
        log_error "Usage: setup.sh --restore <backup-file>"
        exit 1
    fi
    [ -f "$backup_file" ] || { log_error "Backup file not found: $backup_file"; exit 1; }
    local script="$WG_SCRIPTS/wg-restore.sh"
    [ -x "$script" ] || { log_error "wg-restore.sh not found."; exit 1; }
    exec bash "$script" "$backup_file"
}

# ─── cmd_diagnose ───────────────────────────────────────────────
cmd_diagnose() {
    require_root
    local script="$WG_SCRIPTS/wg-diagnose.sh"
    [ -x "$script" ] || { log_error "wg-diagnose.sh not found."; exit 1; }
    # Pas de `shift` ici : le dispatch appelle `cmd_diagnose` SANS argument, et
    # `shift` sur une liste vide renvoie 1 → sous `set -euo pipefail` le trap ERR
    # avortait setup.sh avant même de lancer le diagnostic. `--diagnose` ne
    # démarrait donc jamais.
    exec bash "$script"
}

# ─── cmd_speedtest ──────────────────────────────────────────────
cmd_speedtest() {
    require_root
    local script="$WG_SCRIPTS/wg-speedtest.sh"
    [ -x "$script" ] || { log_error "wg-speedtest.sh not found."; exit 1; }
    exec bash "$script"
}

# ─── cmd_health ─────────────────────────────────────────────────
cmd_health() {
    require_root
    local script="$WG_SCRIPTS/wg-health.sh"
    [ -x "$script" ] || { log_error "wg-health.sh not found."; exit 1; }
    exec bash "$script"
}

# ─── cmd_monitor ────────────────────────────────────────────────
cmd_monitor() {
    require_root
    local script="$WG_SCRIPTS/wg-monitor.sh"
    [ -x "$script" ] || { log_error "wg-monitor.sh not found."; exit 1; }

    if command -v systemctl &>/dev/null && [ -f /etc/systemd/system/sentinel.service ]; then
        log_info "Sentinel watchdog is already installed (systemd)."
        log_info "Use 'systemctl start sentinel' or run wg-monitor.sh directly."
        return 0
    fi

    log_info "Starting wg-monitor.sh in background (screen)…"
    if command -v screen &>/dev/null; then
        screen -dmS wg-monitor bash "$script"
        log_success "Monitor started in screen session 'wg-monitor'. Reattach: screen -r wg-monitor"
    else
        nohup bash "$script" >/var/log/wg-monitor.log 2>&1 &
        log_info "Monitor PID $!. Log: /var/log/wg-monitor.log"
    fi
}

# ─── cmd_optimize ───────────────────────────────────────────────
cmd_optimize() {
    require_root
    local profile="${1:-gaming}"
    local script="$WG_SCRIPTS/wg-optimize.sh"
    [ -x "$script" ] || { log_error "wg-optimize.sh not found."; exit 1; }
    log_info "Applying network profile: $profile"
    exec bash "$script" "$profile"
}

# ─── cmd_user ───────────────────────────────────────────────────
cmd_user() {
    require_root
    local script="$WG_SCRIPTS/wg-users"
    [ -x "$script" ] || { log_error "wg-users not found."; exit 1; }
    exec bash "$script" "$@"
}

# ─── cmd_logs ───────────────────────────────────────────────────
cmd_logs() {
    local service="${1:-}"
    [ -f docker-compose.yml ] || { log_error "docker-compose.yml not found in $SCRIPT_DIR"; exit 1; }

    if [ -z "$service" ]; then
        sudo docker compose logs --tail=50 -f
    else
        case "$service" in
            api|server|backend)    sudo docker compose logs --tail=50 -f api ;;
            nginx|proxy)           sudo docker compose logs --tail=50 -f nginx ;;
            adguard|agh|dns)       sudo docker compose logs --tail=50 -f adguard ;;
            *)                     sudo docker compose logs --tail=50 -f "$service" ;;
        esac
    fi
}

# ─── cmd_cron ───────────────────────────────────────────────────
cmd_cron() {
    require_root
    log_info "Installing cron jobs for wg-fux…"

    local cron_file="/etc/cron.d/wg-fux"
    local backup_script="$WG_SCRIPTS/wg-backup.sh"
    local expiry_script="$WG_SCRIPTS/wg-check-expiry.sh"

    cat > "$cron_file" <<EOF
# wg-fux maintenance tasks — installed by setup.sh
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Daily backup at 03:00
0 3 * * * root [ -x $backup_script ] && $backup_script >/dev/null 2>&1

# Check peer expiry every hour
0 * * * * root [ -x $expiry_script ] && $expiry_script >/dev/null 2>&1
EOF
    chmod 644 "$cron_file"
    log_success "Cron jobs installed: $cron_file"
    log_info "  - Daily backup at 03:00"
    log_info "  - Expiry check every hour"
}

# ─── cmd_reset_password ─────────────────────────────────────────
cmd_reset_password() {
    require_root

    [ -f "$API_ENV" ] || { log_error "api-service/.env not found. Run --install first."; exit 1; }

    log_info "Reset admin password for the API dashboard."

    local user pass salt hash
    user=$(grep ^ADMIN_USER= "$API_ENV" | cut -d= -f2-)
    user="${user:-admin}"

    echo
    echo "  Current admin user: $user"

    # La saisie masquée exige un terminal. Sans TTY (typiquement
    # `ssh serveur './setup.sh --reset-password'` sans -t), `read -rsp` ne
    # masque RIEN et lit un flux vide : l'ancien code bouclait sur « Password
    # cannot be empty » puis affichait le mot de passe EN CLAIR à l'écran.
    # On refuse explicitement ce cas, en proposant les deux issues valides.
    if [ ! -t 0 ]; then
        if [ -n "${ADMIN_PASSWORD:-}" ]; then
            pass="$ADMIN_PASSWORD"
            log_info "Non-interactive mode: password read from ADMIN_PASSWORD."
        else
            log_error "No terminal available: the password prompt cannot hide your input."
            echo
            echo "  Use an interactive session (note the -t):"
            echo "      ssh -t root@<serveur> 'cd /root/wg-fux && sudo ./setup.sh --reset-password'"
            echo
            echo "  Or run it non-interactively, without echoing the password:"
            echo "      ssh root@<serveur> 'cd /root/wg-fux && sudo ADMIN_PASSWORD=\"...\" ./setup.sh --reset-password'"
            echo
            exit 1
        fi
    else
        local pass_confirm
        while true; do
            read -rsp "$(printf '%b? New password for %s: %b' "${YELLOW}" "$user" "${NC}")" pass
            echo
            [ -n "$pass" ] && break
            log_warn "Password cannot be empty."
        done
        while true; do
            read -rsp "$(printf '%b? Confirm new password: %b' "${YELLOW}" "${NC}")" pass_confirm
            echo
            [ "$pass" = "$pass_confirm" ] && break
            log_warn "Passwords do not match. Try again."
        done
        unset pass_confirm
    fi

    # reset-admin.js refuse en dessous de 8 caractères : on échoue ici plutôt
    # que d'écrire un .env que la base refusera ensuite (états désynchronisés).
    if [ "${#pass}" -lt 8 ]; then
        log_error "Password must be at least 8 characters."
        exit 1
    fi

    salt=$(openssl rand -hex 16)
    hash=$(generate_admin_hash "$pass" "$salt")
    [ -n "$hash" ] || { log_error "Hash generation failed."; exit 1; }

    # Update .env (for persistence across container rebuilds)
    sed -i "s|^ADMIN_PASSWORD_HASH=.*|ADMIN_PASSWORD_HASH=$hash|" "$API_ENV"
    sed -i "s|^ADMIN_PASSWORD_SALT=.*|ADMIN_PASSWORD_SALT=$salt|" "$API_ENV"
    # Ensure the lines exist even if sed matched nothing
    grep -q '^ADMIN_PASSWORD_HASH=' "$API_ENV" || echo "ADMIN_PASSWORD_HASH=$hash" >> "$API_ENV"
    grep -q '^ADMIN_PASSWORD_SALT=' "$API_ENV" || echo "ADMIN_PASSWORD_SALT=$salt" >> "$API_ENV"
    log_success "Password hash updated in $API_ENV"

    # Update the database directly inside the running container.
    # This guarantees the password works even if sed failed or init sync is skipped.
    # `ps -q` renvoie 0 même sans conteneur : on teste que la sortie est NON VIDE.
    local db_updated=0
    if [ -n "$(docker compose ps -q api 2>/dev/null)" ]; then
        local exec_out
        # On capture la sortie pour afficher la VRAIE cause : l'ancien code
        # annonçait « container not running? » quel que soit l'échec, ce qui a
        # masqué un MODULE_NOT_FOUND (reset-admin.js absent de l'image).
        if exec_out=$(docker compose exec -T -e ADMIN_PASSWORD="$pass" api \
                        node /app/reset-admin.js 2>&1); then
            db_updated=1
            log_success "Password updated directly in database."
        else
            log_warn "Database update failed — the API reported:"
            printf '%s\n' "$exec_out" | sed 's/^/      /' | head -5
            log_warn "The .env value will still be applied when the API restarts."
        fi
    else
        log_warn "API container is not running — database not updated yet."
    fi

    echo
    if [ "$db_updated" -eq 1 ]; then
        log_info "Restart the API container to keep .env and database aligned."
    else
        log_warn "The API container must be restarted for the env change to take effect."
    fi
    if ask_yes_no "Apply now (recreate the API container)?" "y"; then
        # `docker compose restart` relance le MÊME conteneur : les variables
        # d'env_file étant injectées à la CRÉATION, il ne relit jamais le .env
        # et le nouveau mot de passe restait sans effet. `up -d` recrée le
        # conteneur quand le .env a changé — c'est ce qui applique la modif.
        sudo docker compose up -d api
        log_success "API container recreated with the new credentials."
    fi
}

# ─── cmd_status ─────────────────────────────────────────────────
cmd_status() {
    echo
    echo "╔══════════════════════════════════════════════════╗"
    echo "║            wg-fux Status Dashboard              ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo

    # Docker containers
    if command -v docker &>/dev/null && [ -f docker-compose.yml ]; then
        echo "── Containers ──"
        sudo docker compose ps --no-trunc 2>/dev/null | awk '
            NR==1 {printf "  %-20s %-10s %s\n", $1, $3, $NF}
            NR>1  {printf "  %-20s %-10s %s\n", $1, $3, ($NF=="" ? "-" : $NF)}
        ' || echo "  (not running)"
        echo
    fi

    # WireGuard interface
    echo "── WireGuard ──"
    local iface="${WG_INTERFACE:-wg0}"
    if ip link show "$iface" &>/dev/null; then
        local peers
        peers=$(wg show "$iface" peers 2>/dev/null | wc -l)
        wg show "$iface" 2>/dev/null | head -4
        echo "  Peers: $peers"
    else
        echo "  Interface $iface: DOWN"
    fi
    echo

    # Sentinel service
    echo "── Sentinel ──"
    if command -v systemctl &>/dev/null; then
        if systemctl is-active --quiet sentinel.service 2>/dev/null; then
            echo "  Status: ACTIVE"
        else
            echo "  Status: inactive"
        fi
    fi
    echo

    # Backup status
    local backup_dir
    backup_dir=$(grep ^BACKUP_DIR= "$API_ENV" 2>/dev/null | cut -d= -f2-)
    backup_dir="${backup_dir:-/app/data/backups}"
    if [ -d "$backup_dir" ]; then
        local count
        count=$(ls -1 "$backup_dir"/*.enc 2>/dev/null | wc -l)
        echo "── Backups ($count files) ──"
        ls -lh "$backup_dir"/*.enc 2>/dev/null | head -5 | awk '{print "  " $6, $7, $8, $9}' || echo "  (none)"
    fi
    echo

    # Disk
    echo "── System ──"
    df -h / | awk 'NR==2 {printf "  Disk: %s used / %s total (%s)\n", $3, $2, $5}'
    free -h | awk '/^Mem:/ {printf "  RAM:  %s used / %s total\n", $3, $2}'
    echo
}

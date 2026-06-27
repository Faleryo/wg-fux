#!/bin/bash
# wg-fux installer
#
# Usage:
#   sudo ./setup.sh                # interactive menu
#   sudo ./setup.sh --install      # non-interactive install (requires WGFUX_* env)
#   sudo ./setup.sh --update       # rebuild & restart docker services
#   sudo ./setup.sh --upgrade      # git pull + update
#   sudo ./setup.sh --restart      # restart nginx proxy only
#   sudo ./setup.sh --ssl          # (re)run Let's Encrypt setup
#   sudo ./setup.sh --uninstall    # stop services, ask before deleting data
#   sudo ./setup.sh --uninstall --purge  # remove everything without prompting
#   sudo ./setup.sh --check        # preflight checks only, no changes
#   sudo ./setup.sh --backup       # encrypted backup of DB + WireGuard configs
#   sudo ./setup.sh --restore <file>  # restore from a backup file
#   sudo ./setup.sh --diagnose     # comprehensive SRE diagnostic
#   sudo ./setup.sh --speedtest    # bandwidth / latency test
#   sudo ./setup.sh --health       # host NIC & system health
#   sudo ./setup.sh --monitor      # start peer connection monitor (background)
#   sudo ./setup.sh --optimize [profile]  # apply network tuning (gaming|streaming|auto)
#   sudo ./setup.sh --user <action> [args] # manage API users
#   sudo ./setup.sh --logs [svc]   # follow docker logs (api|nginx|adguard)
#   sudo ./setup.sh --cron         # install daily backup & expiry cron jobs
#   sudo ./setup.sh --reset-password  # change admin password without reinstalling
#   sudo ./setup.sh --status       # overview dashboard
#   sudo ./setup.sh --help

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
cd "$SCRIPT_DIR"

COMMON_SH="$SCRIPT_DIR/core-vpn/scripts/wg-common.sh"
if [ ! -f "$COMMON_SH" ]; then
    echo -e "\033[0;31m[ERROR]\033[0m core-vpn/scripts/wg-common.sh missing — invalid checkout?" >&2
    exit 1
fi
# shellcheck disable=SC1090
source "$COMMON_SH"

# ─── Globals ────────────────────────────────────────────────────────────────
API_ENV="api-service/.env"
ROOT_ENV=".env"
API_DATA="api-service/data"
WG_DIR="/etc/wireguard"
SWAP_FILE="/swap_wgfux"
LOG_FILE="${SETUP_LOG_FILE:-/var/log/wg-fux-setup.log}"

AUTO=false
MODE=""              # see dispatch case
PURGE=false
RESTORE_FILE=""
OPTIMIZE_PROFILE=""
LOGS_SVC=""
USER_ARGS=()
export API_DATA SWAP_FILE PURGE   # consumed by sourced modules

# ─── Logging wrapper ────────────────────────────────────────────────────────
# Try to mirror output to a log file; fall back silently if we can't write.
if mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null && \
   { [ -w "$LOG_FILE" ] || { [ ! -e "$LOG_FILE" ] && touch "$LOG_FILE" 2>/dev/null; }; }; then
    chmod 600 "$LOG_FILE" 2>/dev/null || true
    exec > >(tee -a "$LOG_FILE") 2>&1
else
    LOG_FILE="(not writable — output to stdout only)"
fi

# ─── Trap & cleanup ─────────────────────────────────────────────────────────
on_error() {
    local code=$? line=$1
    log_error "setup.sh failed (exit=$code) at line $line"
    log_warn "Full log: $LOG_FILE"
    cleanup_tmp
    exit "$code"
}
cleanup_tmp() {
    rm -f /tmp/wg-hash-*.js /tmp/wg-env-*.tmp 2>/dev/null || true
    unset WGFUX_PASS WGFUX_SALT ADMIN_PASS AGH_PASS 2>/dev/null || true
}
trap 'on_error $LINENO' ERR
trap cleanup_tmp EXIT

# ─── Helpers ────────────────────────────────────────────────────────────────

usage() {
    sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
    exit "${1:-0}"
}

require_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must run as root (use sudo)."
        exit 1
    fi
}

# Ask a value, with default, validation regex, and optional retry.
ask() {
    local prompt="$1" default="${2-}" regex="${3-}" answer=""
    if [ "$AUTO" = true ]; then
        echo "${default}"
        return 0
    fi
    while true; do
        if [ -n "$default" ]; then
            read -rp "$(printf '%b? %s [%s]: %b' "${YELLOW}" "$prompt" "$default" "${NC}")" answer
            answer="${answer:-$default}"
        else
            read -rp "$(printf '%b? %s: %b' "${YELLOW}" "$prompt" "${NC}")" answer
        fi
        if [ -z "$regex" ] || [[ "$answer" =~ $regex ]]; then
            echo "$answer"
            return 0
        fi
        log_warn "Invalid value. Try again."
    done
}

ask_secret() {
    local prompt="$1" answer=""
    read -rsp "$(printf '%b? %s: %b' "${YELLOW}" "$prompt" "${NC}")" answer
    echo "" >&2
    echo "$answer"
}

ask_yes_no() {
    local prompt="$1" default="${2:-n}" answer=""
    if [ "$AUTO" = true ]; then
        [[ "$default" =~ ^[yY]$ ]] && return 0 || return 1
    fi
    local hint="y/N"
    [[ "$default" =~ ^[yY]$ ]] && hint="Y/n"
    read -rp "$(printf '%b? %s (%s): %b' "${YELLOW}" "$prompt" "$hint" "${NC}")" answer
    answer="${answer:-$default}"
    [[ "$answer" =~ ^[yY]$ ]]
}

random_secret() {
    local bytes="${1:-32}"
    openssl rand -hex "$bytes"
}

# ─── Module loading ─────────────────────────────────────────────────────────
for mod in "$SCRIPT_DIR"/scripts/setup/*.sh; do
    [ -f "$mod" ] || continue
    # shellcheck disable=SC1090
    source "$mod"
done

# ─── Phase: preflight ───────────────────────────────────────────────────────

preflight() {
    log_info "Preflight check…"
    preflight_scan
    check_kernel_wireguard
    check_docker_compose_v2
    log_success "Preflight OK."
}

check_kernel_wireguard() {
    if lsmod 2>/dev/null | grep -q '^wireguard'; then
        log_success "WireGuard kernel module loaded."
        return 0
    fi
    if modprobe wireguard 2>/dev/null; then
        log_success "WireGuard kernel module loaded on demand."
        return 0
    fi
    if command -v wg &>/dev/null; then
        log_warn "WireGuard tools found but kernel module not loaded. The api container will try to load it."
    else
        log_warn "WireGuard not installed on host. Will install with dependencies."
    fi
}

check_docker_compose_v2() {
    if ! command -v docker &>/dev/null; then
        log_warn "Docker not installed yet."
        return 0
    fi
    if ! docker compose version &>/dev/null; then
        log_error "Docker Compose v2 plugin missing. Install 'docker-compose-plugin' or 'docker-compose-v2'."
        return 1
    fi
}

# ─── Phase: configuration ───────────────────────────────────────────────────

configure_interactive() {
    log_info "Configuration"

    echo
    echo "── Network ──"
    local detected_ip; detected_ip=$(detect_public_ip)
    SERVER_IP="$detected_ip"
    WG_ENDPOINT=$(ask "Endpoint WireGuard (IP ou domaine)" "$detected_ip" '^[a-zA-Z0-9.:\-]+$')
    SERVER_PORT=$(ask "WireGuard UDP port" "51820" '^(0[0-9]{0,4}|[1-9][0-9]{0,4}|[1-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5])$')
    DOMAIN=$(ask "Domaine du dashboard HTTPS (laisser vide = IP-only)" "")
    if [ -n "$DOMAIN" ]; then
        EMAIL=$(ask "Let's Encrypt email (laisser vide = pas d'email)" "")
    else
        EMAIL=""
    fi

    echo
    echo "── Admin account ──"
    ADMIN_USER=$(ask "Admin username" "admin" '^[a-zA-Z0-9_-]{2,32}$')
    while true; do
        ADMIN_PASS=$(ask_secret "Admin password")
        [ -n "$ADMIN_PASS" ] && break
        log_warn "Password cannot be empty."
    done
    local admin_confirm
    while true; do
        admin_confirm=$(ask_secret "Confirm admin password")
        [ "$ADMIN_PASS" = "$admin_confirm" ] && break
        log_warn "Passwords do not match. Try again."
    done
    unset admin_confirm

    echo
    echo "── AdGuard Home ──"
    AGH_USER=$(ask "AGH username" "admin" '^[a-zA-Z0-9_-]+$')
    while true; do
        AGH_PASS=$(ask_secret "AGH password (min 8 chars)")
        if [ "${#AGH_PASS}" -ge 8 ]; then break; fi
        log_warn "AGH password too short."
    done
    local agh_confirm
    while true; do
        agh_confirm=$(ask_secret "Confirm AGH password")
        [ "$AGH_PASS" = "$agh_confirm" ] && break
        log_warn "Passwords do not match. Try again."
    done
    unset agh_confirm

    echo
    echo "── Optional: Telegram alerts ──"
    if ask_yes_no "Enable Telegram alerts?" "n"; then
        TG_TOKEN=$(ask "Telegram bot token" "")
        TG_CHATID=$(ask "Telegram chat id" "")
    else
        TG_TOKEN=""
        TG_CHATID=""
    fi
}

configure_from_env() {
    # Non-interactive install — every secret must come from env.
    SERVER_IP="${WGFUX_SERVER_IP:-$(detect_public_ip)}"
    SERVER_PORT="${WGFUX_SERVER_PORT:-51820}"
    WG_ENDPOINT="${WGFUX_WG_ENDPOINT:-${WGFUX_DOMAIN:-$SERVER_IP}}"
    [[ "$WG_ENDPOINT" =~ ^[a-zA-Z0-9.:\-]+$ ]] || { log_error "WGFUX_WG_ENDPOINT valeur invalide (^[a-zA-Z0-9.:-]+$ requis)."; exit 2; }
    DOMAIN="${WGFUX_DOMAIN:-}"
    EMAIL="${WGFUX_EMAIL:-}"
    ADMIN_USER="${WGFUX_ADMIN_USER:-admin}"
    ADMIN_PASS="${WGFUX_ADMIN_PASS:-}"
    AGH_USER="${WGFUX_AGH_USER:-admin}"
    AGH_PASS="${WGFUX_AGH_PASS:-}"
    TG_TOKEN="${WGFUX_TELEGRAM_TOKEN:-}"
    TG_CHATID="${WGFUX_TELEGRAM_CHAT:-}"

    local missing=()
    [ -z "$ADMIN_PASS" ] && missing+=("WGFUX_ADMIN_PASS")
    [ -z "$AGH_PASS" ] && missing+=("WGFUX_AGH_PASS")
    if [ "${#missing[@]}" -gt 0 ]; then
        log_error "Non-interactive install requires: ${missing[*]}"
        exit 2
    fi
    [ "${#AGH_PASS}" -ge 8 ] || { log_error "WGFUX_AGH_PASS too short (<8 — AdGuard Home requirement)."; exit 2; }
}

write_env_files() {
    log_info "Writing configuration files…"

    local salt jwt sentinel backup_pass admin_hash
    salt="${ADMIN_PASSWORD_SALT:-$(openssl rand -hex 16)}"
    jwt="${JWT_SECRET:-$(random_secret 32)}"
    sentinel="${SENTINEL_TOKEN:-$(random_secret 24)}"
    backup_pass="${BACKUP_PASSPHRASE:-$(random_secret 32)}"

    admin_hash=$(generate_admin_hash "$ADMIN_PASS" "$salt")
    [ -n "$admin_hash" ] || { log_error "Hash generation failed (no node/python3?)"; exit 1; }

    local allowed_origins="http://localhost:3000,http://127.0.0.1:3000"
    [ -n "$DOMAIN" ]    && allowed_origins+=",https://$DOMAIN,http://$DOMAIN"
    [ -n "$SERVER_IP" ] && allowed_origins+=",https://$SERVER_IP,http://$SERVER_IP"

    install -m 0600 /dev/null "$API_ENV"
    cat > "$API_ENV" <<EOF
# Generated by setup.sh on $(date -Is) -- DO NOT COMMIT
PORT=3000
NODE_ENV=production
JWT_SECRET=$jwt
SENTINEL_TOKEN=$sentinel
ALLOWED_ORIGINS=$allowed_origins
SERVER_IP=$SERVER_IP
SERVER_PORT=$SERVER_PORT
WG_INTERFACE=wg0
ADMIN_USER=$ADMIN_USER
ADMIN_PASSWORD_HASH=$admin_hash
ADMIN_PASSWORD_SALT=$salt
AGH_USER=$AGH_USER
AGH_PASSWORD=$AGH_PASS
DOMAIN=$DOMAIN
BACKUP_PASSPHRASE=$backup_pass
TELEGRAM_BOT_TOKEN=$TG_TOKEN
TELEGRAM_CHAT_ID=$TG_CHATID
EOF
    chmod 600 "$API_ENV"

    install -m 0600 /dev/null "$ROOT_ENV"
    cat > "$ROOT_ENV" <<EOF
# Generated by setup.sh on $(date -Is) -- DO NOT COMMIT
SERVER_PORT=$SERVER_PORT
SERVER_IP=$SERVER_IP
DOMAIN=$DOMAIN
EMAIL=$EMAIL
WG_INTERFACE=wg0
AGH_USER=$AGH_USER
AGH_PASSWORD=$AGH_PASS
JWT_SECRET=$jwt
SENTINEL_TOKEN=$sentinel
ADMIN_USER=$ADMIN_USER
ADMIN_PASSWORD_HASH=$admin_hash
ADMIN_PASSWORD_SALT=$salt
ALLOWED_ORIGINS=$allowed_origins
BACKUP_PASSPHRASE=$backup_pass
EOF
    chmod 600 "$ROOT_ENV"

    # WireGuard manager.conf
    sudo mkdir -p "$WG_DIR"
    sudo install -m 0644 /dev/null "$WG_DIR/manager.conf"
    cat <<EOF | sudo tee "$WG_DIR/manager.conf" > /dev/null
SERVER_IP="$SERVER_IP"
SERVER_PORT="$SERVER_PORT"
VPN_SUBNET=10.0.0.0/24
VPN_SUBNET_V6=fd00::/64
CLIENT_DNS=1.1.1.1
# Standard WG MTU = 1500 - 80 (transport overhead). Gaming profile drops to
# 1280 (IPv6 min) for zero fragmentation over mobile/4G.
SERVER_MTU=1420
WG_INTERFACE=wg0
# 25s = NAT-traversal sweet spot (RFC 4787). 5s wastes battery on mobile peers.
PERSISTENT_KEEPALIVE=25
# Upstream bandwidth of the host link. Used by wg-apply-qos.sh to size CAKE
# so it can actually manage bufferbloat. Set to ~90% of your real upstream.
# Examples: 100mbit, 500mbit, 1gbit. Default 10gbit = effectively disabled.
UPSTREAM_BANDWIDTH=10gbit
# Set to true to drop peer-to-peer traffic inside the tunnel (peer isolation).
PEER_ISOLATION=false
EOF
    echo "SERVER_DOMAIN=\"${WG_ENDPOINT}\"" | sudo tee -a "$WG_DIR/manager.conf" > /dev/null

    # Stash sensitive vars from the live env so they don't leak into subprocesses.
    unset ADMIN_PASS admin_hash salt jwt sentinel backup_pass
}

generate_wg_keys() {
    sudo mkdir -p "$WG_DIR"
    if [ -f "$WG_DIR/server-private.key" ]; then
        log_info "Reusing existing WireGuard server key."
        return 0
    fi
    log_info "Generating WireGuard server key…"
    local priv pub
    priv=$(wg genkey)
    pub=$(echo "$priv" | wg pubkey)
    echo "$priv" | sudo tee "$WG_DIR/server-private.key" > /dev/null
    echo "$pub"  | sudo tee "$WG_DIR/server-public.key"  > /dev/null
    sudo chmod 600 "$WG_DIR/server-private.key"
    sudo chmod 644 "$WG_DIR/server-public.key"
}

write_wg0_conf() {
    local priv; priv=$(sudo cat "$WG_DIR/server-private.key")
    sudo install -m 0600 /dev/null "$WG_DIR/wg0.conf"
    cat <<EOF | sudo tee "$WG_DIR/wg0.conf" > /dev/null
[Interface]
Address    = 10.0.0.1/24, fd00::1/64
ListenPort = $SERVER_PORT
PrivateKey = $priv
MTU        = 1420
SaveConfig = false

PostUp   = /usr/local/bin/wg-postup.sh %i
PostDown = /usr/local/bin/wg-postdown.sh %i
EOF
}

link_scripts() {
    log_info "Linking helper scripts into /usr/local/bin…"
    for script in "$SCRIPT_DIR"/core-vpn/scripts/wg-*.sh; do
        [ -f "$script" ] || continue
        sudo ln -sf "$script" "/usr/local/bin/$(basename "$script")"
        sudo chmod +x "$script"
    done
}

install_sentinel_service() {
    local svc="/etc/systemd/system/sentinel.service"
    local src="$SCRIPT_DIR/core-vpn/scripts/sentinel.service"
    if [ ! -f "$src" ]; then
        log_warn "sentinel.service template not found, skipping watchdog install."
        return 0
    fi
    if ! command -v systemctl &>/dev/null; then
        log_warn "systemd not detected, skipping watchdog install."
        return 0
    fi
    sudo cp "$src" "$svc"
    sudo sed -i "s|WorkingDirectory=.*|WorkingDirectory=$SCRIPT_DIR|" "$svc"
    sudo sed -i "s|ExecStart=.*|ExecStart=/bin/bash $SCRIPT_DIR/core-vpn/scripts/sentinel.sh|" "$svc"

    echo "SENTINEL_TOKEN=$(grep ^SENTINEL_TOKEN= "$API_ENV" | cut -d= -f2-)" | \
        sudo tee "$SCRIPT_DIR/core-vpn/scripts/sentinel.env" > /dev/null
    sudo chmod 600 "$SCRIPT_DIR/core-vpn/scripts/sentinel.env"

    if [ -n "$TG_TOKEN" ] && [ -n "$TG_CHATID" ]; then
        sudo install -m 0600 /dev/null "$WG_DIR/sentinel.conf"
        printf 'TELEGRAM_BOT_TOKEN=%s\nTELEGRAM_CHAT_ID=%s\n' "$TG_TOKEN" "$TG_CHATID" | \
            sudo tee "$WG_DIR/sentinel.conf" > /dev/null
    fi

    sudo systemctl daemon-reload
    sudo systemctl enable --now sentinel.service
}

# ─── Phase: docker bring-up ─────────────────────────────────────────────────

bring_up_services() {
    log_info "⚙️  Building and starting Docker services…"

    # CRITICAL: api-service/.env must exist (referenced by docker-compose.yml as env_file)
    if [ ! -f "$API_ENV" ]; then
        log_error "Configuration file $API_ENV not found."
        log_error "Run 'sudo ./setup.sh --install' first to generate it."
        exit 1
    fi

    setup_swap
    setup_ssl_bootstrap
    setup_firewall

    # Backup current api .env in case build fails
    cp "$API_ENV" "${API_ENV}.bak.$(date +%s)"

    # Disk pressure: prune cache if free space < 5 GB
    local free_kb; free_kb=$(df -k / | awk 'NR==2 {print $4}')
    if [ "$free_kb" -lt 5242880 ]; then
        log_warn "Disk free <5GB — running aggressive docker prune."
        sudo docker system prune -f >/dev/null 2>&1 || true
        sudo docker builder prune -a -f >/dev/null 2>&1 || true
    else
        sudo docker builder prune -f --filter "until=24h" >/dev/null 2>&1 || true
    fi

    log_info "🐳 Building Docker images (this may take a while)…"
    local build_log; build_log=$(sudo DOCKER_BUILDKIT=1 docker compose build 2>&1) || {
        log_error "Docker build failed. Relevant output:"
        echo "$build_log" | grep -iE "error|failed" || echo "$build_log"
        exit 1
    }
    echo "$build_log" | grep -iE "error|failed|warn" || true

    log_info "🚀 Starting containers…"
    sudo docker compose stop 2>/dev/null || true
    sudo docker compose up -d

    wait_for_healthy 180

    if [ -n "$DOMAIN" ]; then
        log_info "🔐 Running Let's Encrypt setup…"
        setup_ssl || log_warn "SSL setup returned non-zero; nginx remains on self-signed."
    fi
}

wait_for_healthy() {
    local timeout="${1:-180}" waited=0
    log_info "Waiting up to ${timeout}s for containers to be healthy…"
    while [ "$waited" -lt "$timeout" ]; do
        local unhealthy
        unhealthy=$(sudo docker compose ps --no-trunc 2>/dev/null | \
            awk 'NR>1 && $3 == "Up" && $NF != "(healthy)" && $NF != "" {printf "%s ", $1}' || echo "")
        if [ -z "${unhealthy// /}" ]; then
            log_success "Containers healthy."
            return 0
        fi
        log_info "Waiting for: $unhealthy (${waited}s/${timeout}s)"
        sleep 10
        waited=$((waited + 10))
    done
    log_warn "Timeout waiting for healthy. Inspect with: sudo docker compose ps"
}

print_done_banner() {
    local target="${DOMAIN:-$SERVER_IP}"
    echo
    echo "================================================================"
    echo "  wg-fux is up."
    echo "  Dashboard: https://$target/"
    if [ -z "$DOMAIN" ]; then
        echo "  (IP-only mode → self-signed cert, browser will warn.)"
    fi
    echo "  Setup log: $LOG_FILE"
    echo "================================================================"
    echo
}

# ─── High-level commands ────────────────────────────────────────────────────

cmd_install() {
    require_root
    preflight
    check_and_install_deps
    ensure_docker_ready

    if [ -f "$API_ENV" ] && [ "$AUTO" = false ]; then
        if ! ask_yes_no "Existing configuration detected. Overwrite?" "n"; then
            log_info "Keeping current configuration, going straight to rebuild."
            bring_up_services
            print_done_banner
            return 0
        fi
    fi

    if [ "$AUTO" = true ]; then
        configure_from_env
    else
        configure_interactive
    fi

    generate_wg_keys
    write_env_files
    write_wg0_conf
    link_scripts
    install_sentinel_service

    # Optional kernel/network hardening (best-effort, don't fail install)
    [ -x "$SCRIPT_DIR/core-vpn/scripts/wg-harden.sh" ] && \
        sudo bash "$SCRIPT_DIR/core-vpn/scripts/wg-harden.sh" || true
    [ -x "$SCRIPT_DIR/core-vpn/scripts/wg-optimize.sh" ] && \
        sudo bash "$SCRIPT_DIR/core-vpn/scripts/wg-optimize.sh" gaming || true

    bring_up_services
    print_done_banner
}

cmd_update() {
    require_root
    [ -f docker-compose.yml ] || { log_error "docker-compose.yml not found."; exit 1; }
    preflight
    check_and_install_deps
    ensure_docker_ready
    bring_up_services
    print_done_banner
}

cmd_upgrade() {
    require_root
    log_info "Fetching latest from git…"
    rm -f .git/index.lock 2>/dev/null || true

    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        log_warn "Working tree has local changes."
        if [ "$AUTO" = false ]; then
            ask_yes_no "Hard-reset and overwrite local changes?" "n" || \
                { log_info "Upgrade aborted."; exit 0; }
        fi
        git stash push --include-untracked -m "wg-fux setup.sh autostash $(date +%s)" 2>/dev/null || true
    fi

    git fetch --all --prune
    local branch; branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")
    if git rev-parse --verify "origin/$branch" >/dev/null 2>&1; then
        git reset --hard "origin/$branch"
    else
        log_warn "Branch '$branch' has no remote tracking. Skipping hard reset."
        git reset --hard HEAD
    fi
    log_success "Code updated (branch=$branch)."
    cmd_update
}

cmd_restart() {
    require_root
    log_info "Restarting nginx proxy…"
    sudo docker compose restart nginx
    log_success "Done."
}

cmd_ssl() {
    require_root
    setup_ssl_bootstrap
    setup_ssl
}

cmd_uninstall() {
    require_root
    do_uninstall
}

cmd_check() {
    log_info "Running preflight only (no changes will be made)…"
    preflight
    log_success "Preflight passed."
}

# ─── Interactive menu ───────────────────────────────────────────────────────

interactive_menu() {
    echo
    echo "  ┌─ wg-fux setup ──────────────────────────────┐"
    echo "  │  1) Install / reconfigure                   │"
    echo "  │  2) Update (rebuild & restart)              │"
    echo "  │  3) Upgrade (git pull + rebuild)            │"
    echo "  │  4) Restart nginx proxy                     │"
    echo "  │  5) (Re)run SSL / Let's Encrypt             │"
    echo "  │  6) Uninstall                               │"
    echo "  │  7) Preflight check only                    │"
    echo "  │  8) Backup (encrypted)                      │"
    echo "  │  9) Restore from backup                     │"
    echo "  │ 10) Full diagnostic                         │"
    echo "  │ 11) Speed test                              │"
    echo "  │ 12) Health check                            │"
    echo "  │ 13) Status dashboard                        │"
    echo "  │ 14) Follow logs (api|nginx|adguard)         │"
    echo "  │ 15) Apply network optimize profile          │"
    echo "  │ 16) Reset admin password                    │"
    echo "  │ 17) Install cron jobs                       │"
    echo "  │  q) Quit                                    │"
    echo "  └─────────────────────────────────────────────┘"
    local choice; read -rp "Choose: " choice
    case "$choice" in
        1) cmd_install ;;
        2) cmd_update ;;
        3) cmd_upgrade ;;
        4) cmd_restart ;;
        5) cmd_ssl ;;
        6) cmd_uninstall ;;
        7) cmd_check ;;
        8) cmd_backup ;;
        9) echo; read -rp "Backup file path: " f; cmd_restore "$f" ;;
        10) cmd_diagnose ;;
        11) cmd_speedtest ;;
        12) cmd_health ;;
        13) cmd_status ;;
        14) echo; read -rp "Service (api|nginx|adguard) [all]: " s; cmd_logs "$s" ;;
        15) echo; read -rp "Profile (gaming|streaming|auto) [gaming]: " p; cmd_optimize "${p:-gaming}" ;;
        16) cmd_reset_password ;;
        17) cmd_cron ;;
        q|Q|"") log_info "Bye."; exit 0 ;;
        *) log_error "Invalid choice."; exit 1 ;;
    esac
}

# ─── Arg parsing ────────────────────────────────────────────────────────────

while [ "$#" -gt 0 ]; do
    case "$1" in
        --help|-h)    usage 0 ;;
        --install)    MODE=install ;;
        --update)     MODE=update ;;
        --upgrade)    MODE=upgrade ;;
        --restart|--restart-proxy) MODE=restart ;;
        --ssl)        MODE=ssl ;;
        --uninstall)  MODE=uninstall ;;
        --check)      MODE=check ;;
        --backup)     MODE=backup ;;
        --restore)    MODE=restore; RESTORE_FILE="$2"; shift ;;
        --diagnose)   MODE=diagnose ;;
        --speedtest)  MODE=speedtest ;;
        --health)     MODE=health ;;
        --monitor)    MODE=monitor ;;
        --optimize)   MODE=optimize; OPTIMIZE_PROFILE="${2:-gaming}"; [ $# -gt 1 ] && shift ;;
        --user)       MODE=user; shift; USER_ARGS=("$@"); set --; break ;;
        --logs)       MODE=logs; LOGS_SVC="${2:-}"; [ $# -gt 1 ] && shift ;;
        --cron)       MODE=cron ;;
        --reset-password) MODE=reset_password ;;
        --status)     MODE=status ;;
        --purge)      PURGE=true ;;
        --auto|--non-interactive) AUTO=true ;;
        *) log_error "Unknown argument: $1"; usage 1 ;;
    esac
    shift
done

# ─── Dispatch ───────────────────────────────────────────────────────────────

if [ -f "$ROOT_ENV" ]; then
    if grep -qP '\x1b\[' "$ROOT_ENV" 2>/dev/null; then
        log_error ".env contains ANSI escape sequences leaked from a previous failed run."
        log_error "Fix: rm -f '$ROOT_ENV' 'api-service/.env' && sudo ./setup.sh --install"
        exit 1
    fi
    set -a
    # shellcheck disable=SC1090
    source "$ROOT_ENV" || log_warn "Failed to source .env (ignored)."
    set +a
fi

case "$MODE" in
    install)        cmd_install ;;
    update)         cmd_update ;;
    upgrade)        cmd_upgrade ;;
    restart)        cmd_restart ;;
    ssl)            cmd_ssl ;;
    uninstall)      cmd_uninstall ;;
    check)          cmd_check ;;
    backup)         cmd_backup ;;
    restore)        cmd_restore "$RESTORE_FILE" ;;
    diagnose)       cmd_diagnose ;;
    speedtest)      cmd_speedtest ;;
    health)         cmd_health ;;
    monitor)        cmd_monitor ;;
    optimize)       cmd_optimize "$OPTIMIZE_PROFILE" ;;
    user)           cmd_user "${USER_ARGS[@]}" ;;
    logs)           cmd_logs "$LOGS_SVC" ;;
    cron)           cmd_cron ;;
    reset_password) cmd_reset_password ;;
    status)         cmd_status ;;
    "")             require_root; interactive_menu ;;
esac

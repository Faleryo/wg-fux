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
MODE=""              # install | update | upgrade | uninstall | ssl | restart | check
PURGE=false
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
    SERVER_IP=$(ask "Public IP" "$detected_ip" '^[0-9a-fA-F:.]+$')
    SERVER_PORT=$(ask "WireGuard UDP port" "51820" '^[0-9]{2,5}$')
    DOMAIN=$(ask "Domain name (empty = IP-only)" "")
    if [ -n "$DOMAIN" ]; then
        EMAIL=$(ask "Let's Encrypt email (empty = no email)" "")
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

    echo
    echo "── AdGuard Home ──"
    AGH_USER=$(ask "AGH username" "admin" '^[a-zA-Z0-9_-]+$')
    while true; do
        AGH_PASS=$(ask_secret "AGH password (min 8 chars)")
        if [ "${#AGH_PASS}" -ge 8 ]; then break; fi
        log_warn "AGH password too short."
    done

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
    [ -n "$ADMIN_PASS" ] || { log_error "WGFUX_ADMIN_PASS empty."; exit 2; }
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
# Generated by setup.sh on $(date -Is) — DO NOT COMMIT
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
EOF
    chmod 600 "$API_ENV"

    install -m 0600 /dev/null "$ROOT_ENV"
    cat > "$ROOT_ENV" <<EOF
# Generated by setup.sh on $(date -Is) — DO NOT COMMIT
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
SERVER_MTU=1280
WG_INTERFACE=wg0
PERSISTENT_KEEPALIVE=5
EOF

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
MTU        = 1280
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
    log_info "Building and starting Docker services…"

    setup_swap
    setup_ssl_bootstrap   # self-signed cert FIRST so nginx never crashes on boot
    setup_firewall

    # Backup current api .env in case build fails
    [ -f "$API_ENV" ] && cp "$API_ENV" "${API_ENV}.bak.$(date +%s)"

    # Disk pressure: prune cache if free space < 5 GB
    local free_kb; free_kb=$(df -k / | awk 'NR==2 {print $4}')
    if [ "$free_kb" -lt 5242880 ]; then
        log_warn "Disk free <5GB — running aggressive docker prune."
        sudo docker system prune -f >/dev/null 2>&1 || true
        sudo docker builder prune -a -f >/dev/null 2>&1 || true
    else
        sudo docker builder prune -f --filter "until=24h" >/dev/null 2>&1 || true
    fi

    sudo DOCKER_BUILDKIT=1 docker compose build
    sudo docker compose up -d

    wait_for_healthy 180

    if [ -n "$DOMAIN" ]; then
        log_info "Running Let's Encrypt setup…"
        setup_ssl || log_warn "SSL setup returned non-zero; nginx remains on self-signed."
    fi
}

wait_for_healthy() {
    local timeout="${1:-180}" waited=0
    log_info "Waiting up to ${timeout}s for containers to be healthy…"
    while [ "$waited" -lt "$timeout" ]; do
        local unhealthy
        unhealthy=$(sudo docker compose ps --format json 2>/dev/null | \
            python3 -c "
import sys, json
bad=[]
for line in sys.stdin:
    line=line.strip()
    if not line: continue
    try: c=json.loads(line)
    except: continue
    h=c.get('Health','')
    s=c.get('State','')
    if s=='running' and h not in ('healthy',''):
        bad.append(c.get('Name','?'))
print(' '.join(bad))
" 2>/dev/null || echo "")
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
        git stash push -m "wg-fux setup.sh autostash $(date +%s)" 2>/dev/null || true
    fi

    git fetch --all --prune
    local branch; branch=$(git symbolic-ref --short HEAD 2>/dev/null || echo "main")
    git reset --hard "origin/$branch"
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
    echo "  ┌─ wg-fux setup ─────────────────────────┐"
    echo "  │  1) Install / reconfigure              │"
    echo "  │  2) Update (rebuild & restart)         │"
    echo "  │  3) Upgrade (git pull + rebuild)       │"
    echo "  │  4) Restart nginx proxy                │"
    echo "  │  5) (Re)run SSL / Let's Encrypt        │"
    echo "  │  6) Uninstall                          │"
    echo "  │  7) Preflight check only               │"
    echo "  │  q) Quit                               │"
    echo "  └────────────────────────────────────────┘"
    local choice; read -rp "Choose: " choice
    case "$choice" in
        1) cmd_install ;;
        2) cmd_update ;;
        3) cmd_upgrade ;;
        4) cmd_restart ;;
        5) cmd_ssl ;;
        6) cmd_uninstall ;;
        7) cmd_check ;;
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
        --purge)      PURGE=true ;;
        --auto|--non-interactive) AUTO=true ;;
        *) log_error "Unknown argument: $1"; usage 1 ;;
    esac
    shift
done

# ─── Dispatch ───────────────────────────────────────────────────────────────

if [ -f "$ROOT_ENV" ]; then
    set -a
    # shellcheck disable=SC1090
    source "$ROOT_ENV" || log_warn "Failed to source .env (ignored)."
    set +a
fi

case "$MODE" in
    install)   cmd_install ;;
    update)    cmd_update ;;
    upgrade)   cmd_upgrade ;;
    restart)   cmd_restart ;;
    ssl)       cmd_ssl ;;
    uninstall) cmd_uninstall ;;
    check)     cmd_check ;;
    "")        require_root; interactive_menu ;;
esac

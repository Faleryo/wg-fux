#!/bin/bash
# --- VIBE-OS v6.5 Obsidian Standard ---
set -euo pipefail

VERSION="6.5.0-Obsidian+"
# shellcheck disable=SC2034
PROJECT_ROOT="/home/faleryo/wg-fux"

# SRE Error Codes (Exports for scripts)
# shellcheck disable=SC2034
ERR_OK=0
# shellcheck disable=SC2034
ERR_SYSTEM_FAILURE=1
# shellcheck disable=SC2034
ERR_NETWORK_TIMEOUT=2
# shellcheck disable=SC2034
ERR_AUTH_FAILED=3
# shellcheck disable=SC2034
ERR_PERMISSION_DENIED=4
# shellcheck disable=SC2034
ERR_DOCKER_CRASH=5

# Colors & Formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'
BOLD='\033[1m'

# Unified Logging
log_info() { echo -e "${BLUE}[INFO]${NC} $*"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $*"; }
log_sre() { echo -e "${PURPLE}[SRE]${NC} ${BOLD}$*${NC}"; }

# SRE Utilities
check_dependency() {
    local dep="$1"
    if ! command -v "$dep" &>/dev/null; then
        log_error "Dependency missing: $dep. Please install it to continue."
        return 1
    fi
    return 0
}

wait_for_port() {
    local host="$1"
    local port="$2"
    local timeout="${3:-30}"
    local waited=0
    
    log_info "Waiting for service on $host:$port (max ${timeout}s)..."
    while ! timeout 2 bash -c "</dev/tcp/$host/$port" &>/dev/null; do
        sleep 2
        waited=$((waited + 2))
        if [ "$waited" -ge "$timeout" ]; then
            log_warn "Timeout reached for $host:$port."
            return 1
        fi
    done
    log_info "Service $host:$port is READY."
    return 0
}

# --- Missing SRE Utilities ---
sanitize() {
    # Remove surrounding whitespace
    echo "$1" | xargs 2>/dev/null || echo "$1"
}

    echo "$ip"
}

# --- Core SRE Functions ---
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "This script must be run with root (EUID: 0). Current: $EUID"
        exit 1
    fi
}

load_config() {
    local conf="/etc/wireguard/manager.conf"
    if [ -f "$conf" ]; then
        # shellcheck disable=SC1090
        source "$conf"
        # Export for subprocesses
        export SERVER_IP SERVER_PORT VPN_SUBNET VPN_SUBNET_V6 CLIENT_DNS SERVER_MTU WG_INTERFACE
    else
        log_warn "Manager configuration $conf missing. Using environment defaults."
    fi
}

validate_id() {
    local id="$1"
    if [[ ! "$id" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        log_error "Invalid identifier: '$id' (Only a-Z, 0-9, -, _ allowed)."
        exit 1
    fi
}

# Telegram notification hub
send_telegram_msg() {
    local message="$1"
    local level="${2:-INFO}"
    local conf_file="/etc/wireguard/sentinel.conf"
    
    if [ -f "$conf_file" ]; then
        # shellcheck disable=SC1090
        source "$conf_file"
        
        if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
            local icon="⚠️"
            if [ "$level" == "ERROR" ]; then icon="🚨"; fi
            if [ "$level" == "SUCCESS" ]; then icon="✅"; fi
            
            local esc_msg="<b>$icon ALERTE WG-FUX ($VERSION)</b>\n\n<code>$message</code>"
            
            curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
                -d "chat_id=$TELEGRAM_CHAT_ID" \
                -d "text=$esc_msg" \
                -d "parse_mode=HTML" > /dev/null
        fi
    fi
}

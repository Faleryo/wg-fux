#!/bin/bash

# --- VIBE-OS : COMMON UTILITIES FOR WIREGUARD SCRIPTS ---

set -euo pipefail

# Colors for logging
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Standard Exit Codes
ERR_SUCCESS=0
ERR_GENERAL=1
ERR_PERMISSION=2
ERR_NOT_FOUND=3
ERR_INVALID_ARGS=4
ERR_ALREADY_EXISTS=5
ERR_SYSTEM_FAILURE=6
ERR_SUBNET_EXHAUSTED=7

# Logging functions
log_info() {
    echo -e "${GREEN}[INFO]$(date +'%Y-%m-%d %H:%M:%S')${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]$(date +'%Y-%m-%d %H:%M:%S')${NC} $1"
}

log_error() {
    local msg=$1
    local code=${2:-$ERR_GENERAL}
    echo -e "${RED}[ERROR]$(date +'%Y-%m-%d %H:%M:%S')${NC} $msg" >&2
    exit "$code"
}

# Ensure script is run as root (or with sudo)
check_root() {
    if [ "$EUID" -ne 0 ]; then
        log_error "Please run as root" "$ERR_PERMISSION"
    fi
}

# Load configuration safely
load_config() {
    CONFIG_FILE="/etc/wireguard/manager.conf"
    if [ -f "$CONFIG_FILE" ]; then
        # We use a subshell to avoid polluting the current shell immediately,
        # but since we want the variables, we source it.
        # Hardening: only source if it belongs to root and is not world-writable.
        if [ "$(stat -c '%u %a' "$CONFIG_FILE")" != "0 600" ] && [ "$(stat -c '%u %a' "$CONFIG_FILE")" != "0 640" ]; then
           log_warn "Config file permissions are not optimal (should be 600 or 640 root). Current: $(stat -c '%a' "$CONFIG_FILE")"
        fi
        source "$CONFIG_FILE"
    else
        log_error "Configuration file $CONFIG_FILE not found."
        exit 1
    fi
    
    # Defaults
    WG_INTERFACE=${WG_INTERFACE:-wg0}
    SERVER_PORT=${SERVER_PORT:-51820}
    SERVER_MTU=${SERVER_MTU:-1420}
    CLIENT_DNS=${CLIENT_DNS:-"1.1.1.1, 8.8.8.8"}
}

# Validate identifier (container, client name)
validate_id() {
    if [[ ! "$1" =~ ^[a-zA-Z0-9_\-]+$ ]]; then
        log_error "Invalid identifier: $1 (only alphanumeric, underscores, and hyphens allowed)"
        exit 1
    fi
}

# Ensure necessary tools are available
check_dependencies() {
    local tools=("wg" "wg-quick" "qrencode" "ip" "grep" "awk")
    for tool in "${tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            log_error "Missing dependency: $tool. Please install it." "$ERR_SYSTEM_FAILURE"
        fi
    done
}

# Centralized path management
get_client_dir() {
    local container=$1
    local name=$2
    echo "/etc/wireguard/clients/${container}/${name}"
}

# Safe command execution wrapper
run_safe() {
    "$@" || { log_error "Command failed: $*" "$ERR_SYSTEM_FAILURE"; }
}

# Export functions for subshells
export -f log_info log_warn log_error check_root load_config validate_id run_safe check_dependencies get_client_dir


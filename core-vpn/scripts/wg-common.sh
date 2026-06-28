#!/bin/bash
# --- ---
# NOTE: Pas de set -euo pipefail ici — ce fichier est une bibliothèque sourcée.
# Chaque script principal gère son propre mode d'erreur.

VERSION="6.5.0-+"
# shellcheck disable=SC2034
# PROJECT_ROOT calculé dynamiquement pour éviter les chemins hardcodés
_WG_COMMON_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" 2>/dev/null || true
PROJECT_ROOT="$(dirname "$(dirname "$_WG_COMMON_DIR")")" 2>/dev/null || true

# SRE Hardening: Force English locale for all subprocesses (ping, df, wg, top)
# This prevents parsing errors in non-English environments.
export LC_ALL=C
export LANG=C
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"

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
# shellcheck disable=SC2034
ERR_NOT_FOUND=404
# shellcheck disable=SC2034
ERR_GENERIC=500

# Colors & Formatting
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
 RED='\033[0;31m'
 GREEN='\033[0;32m'
 YELLOW='\033[1;33m'
 BLUE='\033[0;34m'
 PURPLE='\033[0;35m'
 NC='\033[0m'
 BOLD='\033[1m'
else
 RED=''
 GREEN=''
 YELLOW=''
 BLUE=''
 PURPLE=''
 NC=''
 BOLD=''
fi

# Unified Logging — ALL output goes to stderr so $() capture is clean
log_info() { echo -e "${BLUE}[INFO]${NC} $*" >&2; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $*" >&2; }
log_sre() { echo -e "${PURPLE}[SRE]${NC} ${BOLD}$*${NC}" >&2; }

# SQL escape: doubles single quotes per SQLite spec. Use to safely embed
# untrusted strings into SQL string literals: WHERE name='$(sql_escape "$x")'
sql_escape() {
 printf "%s" "${1-}" | sed "s/'/''/g"
}

# Validates a string is a WireGuard public key (44-char base64 ending in =).
# Returns 0 if valid, 1 otherwise.
is_valid_wg_key() {
 [[ "${1-}" =~ ^[A-Za-z0-9+/]{43}=$ ]]
}

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
 # Remove surrounding whitespace safely
 local val="$1"
 # Use printf to avoid interpretation of leading hyphens
 printf "%s" "$val" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
}

detect_public_ip() {
 # Attempt to detect public IPv4 using multiple services with strict timeouts.
 # Always use HTTPS to prevent HTTP response injection / MITM poisoning.
 local ip="" raw=""
 for service in \
     "https://ifconfig.me" \
     "https://api.ipify.org" \
     "https://ident.me" \
     "https://icanhazip.com"; do
     # Strip ANSI escape sequences, carriage returns, and any non-IP characters
     # before applying the regex so terminal codes can never pollute the value.
     raw=$(curl -4 -fsSL --connect-timeout 3 --max-time 5 "$service" 2>/dev/null \
           | sed 's/\x1b\[[0-9;]*[mGKHF]//g' \
           | tr -cd '0-9.\n' \
           | head -n1)
     if [[ "$raw" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
         ip="$raw"
         echo "$ip"
         return 0
     fi
 done

 # Fallback to local interface IP (non-loopback)
 ip=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K\S+' || echo "127.0.0.1")
 echo "$ip"
}

# --- Core SRE Functions ---
check_root() {
 local _euid="${EUID:-$(id -u 2>/dev/null || echo 0)}"
 if [ "$_euid" -ne 0 ]; then
 log_error "This script must be run with root (EUID: 0). Current: $_euid"
 exit 1
 fi
}

load_config() {
 local conf="/etc/wireguard/manager.conf"
 if [ -f "$conf" ]; then
 # BUG-1 FIX: Reject config file if it contains dangerous shell characters
 # to prevent code execution when sourcing as root.
 if grep -v '^\s*#' "$conf" | grep -qE '[`$;|&<>()\{\}]' 2>/dev/null; then
  log_error "Caractères dangereux dans $conf. Abandon. (Les valeurs contenant ces chars doivent être entre guillemets simples.)"
  return 1
 fi
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
 if [ ${#id} -gt 32 ]; then
 log_error "Identifier too long: '$id' (Max 32 characters)."
 exit 1
 fi
}

# Telegram notification hub
send_telegram_msg() {
 local message="$1"
 local level="${2:-INFO}"
 local conf_file="/etc/wireguard/sentinel.conf"

 if [ -f "$conf_file" ]; then
 if grep -v '^\s*#' "$conf_file" | grep -qE '[`$;|&<>()\{\}]' 2>/dev/null; then
  log_error "Caractères dangereux dans $conf_file. Abandon."
  return 1
 fi
 # shellcheck disable=SC1090
 source "$conf_file"

  if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
  local icon="⚠️"
  if [ "$level" == "ERROR" ]; then icon="🚨"; fi
  if [ "$level" == "SUCCESS" ]; then icon="✅"; fi

  # SRE SECURITY: Use a temporary file for the message body to avoid shell evaluation/injection
  local tmp_msg_file; tmp_msg_file=$(mktemp "${TMPDIR:-/tmp}/wg-telegram-XXXXXXXX")
  printf "%b ALERTE WG-FUX (%s)\n\n%s" "$icon" "$VERSION" "$message" > "$tmp_msg_file"

  (
    trap 'rm -f "$tmp_msg_file"' EXIT INT TERM
    curl -s -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
    --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" \
    --data-urlencode "text@$tmp_msg_file" \
    > /dev/null
    rm -f "$tmp_msg_file"
  )
  fi
 fi
}

#!/bin/bash
# --- VIBE-OS : Create Client v6.2 (Elite SRE) ---
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

check_root
load_config

CONTAINER="${1:-}"
NAME="${2:-}"
EXPIRY="${3:-}"
QUOTA="${4:-}"
UPLOAD_LIMIT="${5:-}"

# Validations basiques
validate_id "$CONTAINER"
validate_id "$NAME"

if [[ -n "$EXPIRY" && ! "$EXPIRY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    log_error "Invalid expiry date: $EXPIRY"
    exit 1
fi

if [[ -n "$QUOTA" && ! "$QUOTA" =~ ^[0-9]+$ ]]; then
    log_error "Invalid Quota: $QUOTA"
    exit 1
fi

if [ -d "/etc/wireguard/clients/$CONTAINER/$NAME" ]; then
    log_warn "Client '$NAME' already exists in container '$CONTAINER'. Skipping creation."
    exit 0 # Idempotence
fi

# Validation critique du serveur
if [ -z "${SERVER_IP:-}" ]; then
    log_error "SERVER_IP missing in manager.conf. Cannot generate Endpoint."
    exit 1
fi

if [ ! -f /etc/wireguard/server-public.key ]; then
    log_error "/etc/wireguard/server-public.key not found."
    exit 1
fi

# --- IP CALCULATION & LOCK ---
IP_SUFFIX=""
{
  flock -x 200 || exit 1
  
  used_ips=" "
  # Improved robust IP scanning across all containers
  for client_conf in /etc/wireguard/clients/*/*/*.conf; do
      [ -f "$client_conf" ] || continue
      # Extract first IPv4 Address from the conf using a more precise regex
      ip_val=$(grep -i "^Address" "$client_conf" | sed -n 's/^Address *= *\([^, \n]*\).*/\1/p' | cut -d'/' -f1 | tr -d '[:space:]')
      if [[ "$ip_val" =~ ^([0-9]{1,3}\.){3}([0-9]{1,3})$ ]]; then
          current_id=$(echo "$ip_val" | cut -d'.' -f4)
          used_ips="${used_ips}${current_id} "
      fi
  done
  
  # Also check server IP to be safe
  server_suffix=$(echo "${VPN_SUBNET%.*}" | cut -d'.' -f4)
  [[ -z "$server_suffix" ]] && server_suffix="1"
  used_ips="${used_ips}${server_suffix} "

  # Find first available suffix from 2 to 254
  for ((i=2; i<=254; i++)); do
      if [[ ! " ${used_ips} " == *" $i "* ]]; then
          IP_SUFFIX=$i
          break
      fi
  done
} 200>/var/lock/wg-ip.lock

if [ -z "$IP_SUFFIX" ]; then
    log_error "Subnet exhausted (max 254 clients)."
    exit 1
fi

BASE_DIR="/etc/wireguard/clients"
CLIENT_DIR="$BASE_DIR/$CONTAINER/$NAME"
mkdir -p "$CLIENT_DIR"
# SRE Fix: Immediate chown to avoid race condition with API file access
chown 1001:1001 "$CLIENT_DIR"
chmod 775 "$CLIENT_DIR"

# Key Gen
wg genkey | tee "$CLIENT_DIR/private.key" | wg pubkey > "$CLIENT_DIR/public.key"
wg genpsk > "$CLIENT_DIR/preshared.key"

PUBKEY=$(tr -d '[:space:]' < "$CLIENT_DIR/public.key")
PRIVKEY=$(tr -d '[:space:]' < "$CLIENT_DIR/private.key")
PSK=$(tr -d '[:space:]' < "$CLIENT_DIR/preshared.key")
SERVER_PUBKEY=$(cat /etc/wireguard/server-public.key)

CLIENT_IP="${VPN_SUBNET%.*}.$IP_SUFFIX"

if [ -n "${VPN_SUBNET_V6:-}" ]; then
    # Extraction robuste du préfixe avant l'ID client
    IPV6_PREFIX="${VPN_SUBNET_V6%/*}"
    # On s'assure qu'on finit par un séparateur correct pour l'ID suffixe
    if [[ "$IPV6_PREFIX" == *"::" ]]; then
        NET_PREFIX="$IPV6_PREFIX"
    elif [[ "$IPV6_PREFIX" == *: ]]; then
        NET_PREFIX="$IPV6_PREFIX"
    else
        NET_PREFIX="${IPV6_PREFIX}::"
    fi
    CLIENT_IPV6="${NET_PREFIX}${IP_SUFFIX}"
    ADDRESS_STR="$CLIENT_IP/24, $CLIENT_IPV6/64"
    ALLOWED_IPS_STR="$CLIENT_IP/32,$CLIENT_IPV6/128"
else
    ADDRESS_STR="$CLIENT_IP/24"
    ALLOWED_IPS_STR="$CLIENT_IP/32"
fi

ACTUAL_ENDPOINT="$SERVER_IP:$SERVER_PORT"
[[ "$SERVER_IP" =~ : ]] && ACTUAL_ENDPOINT="[$SERVER_IP]:$SERVER_PORT"

cat > "$CLIENT_DIR/$NAME.conf" <<EOC
[Interface]
PrivateKey = $PRIVKEY
Address = $ADDRESS_STR
DNS = $CLIENT_DNS
MTU = $SERVER_MTU

[Peer]
PublicKey = $SERVER_PUBKEY
PresharedKey = $PSK
Endpoint = $ACTUAL_ENDPOINT
AllowedIPs = 0.0.0.0/0, ::/0
PersistentKeepalive = ${PERSISTENT_KEEPALIVE:-25}
EOC

[ -n "$EXPIRY" ] && echo "$EXPIRY" > "$CLIENT_DIR/expiry"
[ -n "$QUOTA" ] && echo "$QUOTA" > "$CLIENT_DIR/quota"
[[ "$UPLOAD_LIMIT" =~ ^[0-9]+$ ]] && [ "$UPLOAD_LIMIT" -gt 0 ] && echo "$UPLOAD_LIMIT" > "$CLIENT_DIR/upload_limit"
echo "$ALLOWED_IPS_STR" > "$CLIENT_DIR/allowed_ips.txt"

# Sync with interface
if ip link show "$WG_INTERFACE" > /dev/null 2>&1; then
    ALLOWED_IPS_VAL=$(cat "$CLIENT_DIR/allowed_ips.txt")
    if ! wg set "$WG_INTERFACE" peer "$PUBKEY" preshared-key "$CLIENT_DIR/preshared.key" allowed-ips "$ALLOWED_IPS_VAL"; then
        log_warn "Failed to apply peer '$NAME' to interface '$WG_INTERFACE'. Will be applied by enforcer later."
    fi
fi

# QR Code
if command -v qrencode &> /dev/null; then
    qrencode -o "$CLIENT_DIR/$NAME.png" -t png -r "$CLIENT_DIR/$NAME.conf" || true
fi

# Permissions
# Vibe-OS v6.3 fix: Allow wg-api user to write metadata (quota, expiry) to client dir
chown -R 1001:1001 "$CLIENT_DIR"
chmod 770 "$CLIENT_DIR"
chmod 660 "$CLIENT_DIR/"*
chown root:root "$CLIENT_DIR/private.key" "$CLIENT_DIR/preshared.key" && chmod 600 "$CLIENT_DIR/private.key" "$CLIENT_DIR/preshared.key"

# Apply QoS
"$SCRIPT_DIR/wg-apply-qos.sh" || true

log_info "Client '$NAME' created successfully with IP $CLIENT_IP"

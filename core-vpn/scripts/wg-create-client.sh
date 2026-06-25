#!/bin/bash
# --- : Create Client v6.2 (SRE) ---
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
if [ -z "${SERVER_IP:-}" ] && [ -z "${SERVER_DOMAIN:-}" ]; then
 log_error "SERVER_IP/SERVER_DOMAIN missing in manager.conf. Cannot generate Endpoint."
 exit 1
fi

if [ ! -f /etc/wireguard/server-public.key ]; then
 log_error "/etc/wireguard/server-public.key not found."
 exit 1
fi

# --- IP CALCULATION & LOCK ---
IP_SUFFIX=""
BASE_DIR="/etc/wireguard/clients"
CLIENT_DIR="$BASE_DIR/$CONTAINER/$NAME"
mkdir -p /var/lock 2>/dev/null || true
{
  flock -x 200 || exit 1

  used_ips=" "
  # Scan .conf files across all containers
  for client_conf in /etc/wireguard/clients/*/*/*.conf; do
    [ -f "$client_conf" ] || continue
    ip_val=$(grep -i "^Address" "$client_conf" | sed -n 's/^Address *= *\([^, ]*\).*/\1/p' | cut -d'/' -f1 | tr -d '[:space:]')
    if [[ "$ip_val" =~ ^([0-9]{1,3}\.){3}([0-9]{1,3})$ ]]; then
      current_id=$(echo "$ip_val" | cut -d'.' -f4)
      used_ips="${used_ips}${current_id} "
    fi
  done

  # Also scan .ip_reserved files (clients being created concurrently)
  for ip_file in /etc/wireguard/clients/*/*/.ip_reserved; do
    [ -f "$ip_file" ] || continue
    ip_val=$(cat "$ip_file" | tr -d '[:space:]')
    if [[ "$ip_val" =~ ^([0-9]{1,3}\.){3}([0-9]{1,3})$ ]]; then
      current_id=$(echo "$ip_val" | cut -d'.' -f4)
      used_ips="${used_ips}${current_id} "
    fi
  done

  used_ips="${used_ips}1 "

  # Find first available suffix from 2 to 254
  for ((i=2; i<=254; i++)); do
    if [[ ! " ${used_ips} " == *" $i "* ]]; then
      IP_SUFFIX=$i
      break
    fi
  done

  if [ -z "$IP_SUFFIX" ]; then
    log_error "Subnet exhausted (max 254 clients)."
    exit 1
  fi

  # Reserve the IP immediately while holding the lock
  CLIENT_IP="${VPN_SUBNET%.*}.$IP_SUFFIX"
  mkdir -p "$CLIENT_DIR"
  echo "$CLIENT_IP" > "$CLIENT_DIR/.ip_reserved"
  # Key Gen (still inside lock)
  wg genkey | tee "$CLIENT_DIR/private.key" | wg pubkey > "$CLIENT_DIR/public.key"
  wg genpsk > "$CLIENT_DIR/preshared.key"

  PUBKEY=$(tr -d '[:space:]' < "$CLIENT_DIR/public.key")
  PRIVKEY=$(tr -d '[:space:]' < "$CLIENT_DIR/private.key")
  PSK=$(tr -d '[:space:]' < "$CLIENT_DIR/preshared.key")
  SERVER_PUBKEY=$(cat /etc/wireguard/server-public.key)

  CLIENT_IP="${VPN_SUBNET%.*}.$IP_SUFFIX"

  if [ -n "${VPN_SUBNET_V6:-}" ]; then
   NET_PREFIX="${VPN_SUBNET_V6%/*}"
   NET_PREFIX="${NET_PREFIX%:}"
   [[ "$NET_PREFIX" == *:: ]] || NET_PREFIX="${NET_PREFIX}:"

   if [[ "$NET_PREFIX" == *:: ]]; then
   CLIENT_IPV6="${NET_PREFIX}${IP_SUFFIX}"
   else
   CLIENT_IPV6="${NET_PREFIX}:${IP_SUFFIX}"
   fi

   ADDRESS_STR="$CLIENT_IP/24, $CLIENT_IPV6/64"
   ALLOWED_IPS_STR="$CLIENT_IP/32,$CLIENT_IPV6/128"
  else
   ADDRESS_STR="$CLIENT_IP/24"
   ALLOWED_IPS_STR="$CLIENT_IP/32"
  fi

  if [ -n "${SERVER_DOMAIN:-}" ]; then
   ACTUAL_ENDPOINT="$SERVER_DOMAIN:$SERVER_PORT"
  else
   ACTUAL_ENDPOINT="$SERVER_IP:$SERVER_PORT"
   [[ "$SERVER_IP" =~ : ]] && ACTUAL_ENDPOINT="[$SERVER_IP]:$SERVER_PORT"
  fi

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

  # Remove IP reservation marker (conf file exists now)
  rm -f "$CLIENT_DIR/.ip_reserved"
} 200>/var/lock/wg-ip.lock

# SRE Fix: Immediate chown to avoid race condition with API file access
_WG_API_UID=$(id -u wg-api 2>/dev/null || echo 1001)
_WG_API_GID=$(id -g wg-api 2>/dev/null || echo 1001)
chown "$_WG_API_UID:$_WG_API_GID" "$CLIENT_DIR"
chmod 775 "$CLIENT_DIR"

# Sync with interface
if ip link show "$WG_INTERFACE" > /dev/null 2>&1; then
 ALLOWED_IPS_VAL=$(cat "$CLIENT_DIR/allowed_ips.txt")
 if ! wg set "${WG_INTERFACE:-wg0}" peer "$PUBKEY" preshared-key "$CLIENT_DIR/preshared.key" allowed-ips "$ALLOWED_IPS_VAL"; then
 log_warn "Failed to apply peer '$NAME' to interface '$WG_INTERFACE'. Will be applied by enforcer later."
 fi
fi

# QR Code
if command -v qrencode &> /dev/null; then
 qrencode -o "$CLIENT_DIR/$NAME.png" -t png -r "$CLIENT_DIR/$NAME.conf" || true
fi

# Final Permissions & Ownership
chown -R "$_WG_API_UID:$_WG_API_GID" "$CLIENT_DIR"
chmod 700 "$CLIENT_DIR"
chmod 640 "$CLIENT_DIR/"* 2>/dev/null || true
chmod 600 "$CLIENT_DIR/private.key" "$CLIENT_DIR/preshared.key" "$CLIENT_DIR/$NAME.conf"

# Apply QoS
"$SCRIPT_DIR/wg-apply-qos.sh" || true

log_info "Client '$NAME' created successfully with IP $CLIENT_IP"

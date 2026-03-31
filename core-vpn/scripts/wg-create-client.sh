#!/bin/bash
# --- VIBE-OS : Create Client ---

SCRIPT_DIR="$(dirname "$0")"
source "$SCRIPT_DIR/wg-common.sh"

check_root
load_config

CONTAINER="$1"
NAME="$2"
EXPIRY="$3"
QUOTA="$4"
UPLOAD_LIMIT="$5"

# Validations basiques (déjà validées par l'API, mais sécurité shell oblige)
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
if [ -z "$SERVER_IP" ]; then
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
  
  used_ips=" 1 "
  for client_conf in "/etc/wireguard/clients"/*/*/*.conf; do
      if [ -f "$client_conf" ]; then
          ip_val=$(awk -F'=' '/^Address/ {print $2; exit}' "$client_conf" | awk -F',' '{print $1}' | awk -F'/' '{print $1}' | tr -d ' ')
          current_id=$(echo "$ip_val" | awk -F'.' '{print $4}')
          if [[ "$current_id" =~ ^[0-9]+$ ]] && [ "$current_id" -gt 0 ]; then
              used_ips="${used_ips}${current_id} "
          fi
      fi
  done

  for i in {2..254}; do
      if [[ ! "$used_ips" =~ " $i " ]]; then
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

# Key Gen
wg genkey | tee "$CLIENT_DIR/private.key" | wg pubkey > "$CLIENT_DIR/public.key"
wg genpsk > "$CLIENT_DIR/preshared.key"

PUBKEY=$(cat "$CLIENT_DIR/public.key" | tr -d '[:space:]')
PRIVKEY=$(cat "$CLIENT_DIR/private.key" | tr -d '[:space:]')
PSK=$(cat "$CLIENT_DIR/preshared.key" | tr -d '[:space:]')
SERVER_PUBKEY=$(cat /etc/wireguard/server-public.key)

CLIENT_IP="${VPN_SUBNET%.*}.$IP_SUFFIX"

if [ -n "$VPN_SUBNET_V6" ]; then
    IPV6_PREFIX="${VPN_SUBNET_V6%/*}"
    NET_PREFIX="${IPV6_PREFIX%:*}:"
    [[ ! "$NET_PREFIX" =~ ::$ ]] && NET_PREFIX="${NET_PREFIX}:"
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
    wg set "$WG_INTERFACE" peer "$PUBKEY" preshared-key "$CLIENT_DIR/preshared.key" allowed-ips "$ALLOWED_IPS_VAL" || true
fi

# QR Code
if command -v qrencode &> /dev/null; then
    qrencode -o "$CLIENT_DIR/$NAME.png" -t png -r "$CLIENT_DIR/$NAME.conf" || true
fi

# Permissions
chown root:wg-api "$CLIENT_DIR" "$CLIENT_DIR/$NAME.conf" "$CLIENT_DIR/public.key"
chmod 750 "$CLIENT_DIR"
chmod 640 "$CLIENT_DIR/$NAME.conf" "$CLIENT_DIR/public.key"
chown root:root "$CLIENT_DIR/private.key" "$CLIENT_DIR/preshared.key" && chmod 600 "$CLIENT_DIR/private.key" "$CLIENT_DIR/preshared.key"

# Apply QoS
$SCRIPT_DIR/wg-apply-qos.sh || true

log_info "Client '$NAME' created successfully with IP $CLIENT_IP"

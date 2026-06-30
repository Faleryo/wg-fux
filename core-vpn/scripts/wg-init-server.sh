#!/bin/bash
# wg-init-server.sh — Initialise WireGuard sur un VPS revendeur.
# Args: <SERVER_PUBLIC_IP> [WG_PORT] [VPN_SUBNET] [WG_INTERFACE]
# Idempotent : ne refait rien si manager.conf + server-public.key + conf existent déjà.
set -euo pipefail

SERVER_PUBLIC_IP="${1:-}"
WG_PORT="${2:-51820}"
VPN_SUBNET="${3:-10.0.0.0/24}"
WG_INTERFACE="${4:-wg0}"

[ "$(id -u)" -eq 0 ] || { echo "Must be root"; exit 1; }
[ -n "$SERVER_PUBLIC_IP" ] || { echo "SERVER_PUBLIC_IP requis"; exit 1; }

WG_DIR="/etc/wireguard"
CONF_FILE="${WG_DIR}/${WG_INTERFACE}.conf"
MANAGER_CONF="${WG_DIR}/manager.conf"
PRIVKEY_FILE="${WG_DIR}/server-private.key"
PUBKEY_FILE="${WG_DIR}/server-public.key"

# Idempotent : déjà initialisé.
if [ -f "$PUBKEY_FILE" ] && [ -f "$MANAGER_CONF" ] && [ -f "$CONF_FILE" ]; then
  echo "WireGuard déjà initialisé. (supprimer ${PUBKEY_FILE} pour forcer la réinitialisation)"
  exit 0
fi

# Interface réseau par défaut (pour PostUp/PostDown NAT).
NET_IFACE=$(ip route show default | awk '/default via/ {print $5; exit}')
[ -n "$NET_IFACE" ] || { echo "Impossible de détecter l'interface réseau par défaut"; exit 1; }

# IP serveur dans le VPN = première adresse du sous-réseau (x.x.x.1)
SUBNET_BASE="${VPN_SUBNET%/*}"
SUBNET_MASK="${VPN_SUBNET##*/}"
SERVER_VPN_IP="${SUBNET_BASE%.*}.1"

# Génération des clés WireGuard du serveur.
PRIVKEY=$(wg genkey)
PUBKEY=$(echo "$PRIVKEY" | wg pubkey)

install -m 0600 -o root -g root /dev/null "$PRIVKEY_FILE"
printf '%s\n' "$PRIVKEY" > "$PRIVKEY_FILE"
chmod 600 "$PRIVKEY_FILE"
printf '%s\n' "$PUBKEY" > "$PUBKEY_FILE"
chmod 644 "$PUBKEY_FILE"

# Configuration de l'interface WireGuard.
cat > "$CONF_FILE" <<WGEOF
[Interface]
Address = ${SERVER_VPN_IP}/${SUBNET_MASK}
ListenPort = ${WG_PORT}
PrivateKey = ${PRIVKEY}
PostUp   = iptables -A FORWARD -i ${WG_INTERFACE} -j ACCEPT; iptables -A FORWARD -o ${WG_INTERFACE} -j ACCEPT; iptables -t nat -A POSTROUTING -o ${NET_IFACE} -j MASQUERADE
PostDown = iptables -D FORWARD -i ${WG_INTERFACE} -j ACCEPT; iptables -D FORWARD -o ${WG_INTERFACE} -j ACCEPT; iptables -t nat -D POSTROUTING -o ${NET_IFACE} -j MASQUERADE
WGEOF
chmod 600 "$CONF_FILE"

# Fichier de config lu par wg-common.sh dans tous les scripts wg-*.sh.
cat > "$MANAGER_CONF" <<MCEOF
# Généré par wg-init-server.sh — modifiable après initialisation.
SERVER_IP=${SERVER_PUBLIC_IP}
SERVER_PORT=${WG_PORT}
VPN_SUBNET=${VPN_SUBNET}
WG_INTERFACE=${WG_INTERFACE}
CLIENT_DNS=1.1.1.1,8.8.8.8
SERVER_MTU=1420
MCEOF
chmod 640 "$MANAGER_CONF"

# Répertoire clients (attendu par wg-create-client.sh / wg-file-proxy.sh).
mkdir -p "${WG_DIR}/clients"
chmod 755 "${WG_DIR}/clients"

# Activation du routage IPv4.
sysctl -w net.ipv4.ip_forward=1 > /dev/null
echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/99-wg-fux.conf
sysctl -p /etc/sysctl.d/99-wg-fux.conf > /dev/null 2>&1 || true

# Démarrage et activation au boot.
systemctl enable "wg-quick@${WG_INTERFACE}" > /dev/null 2>&1
systemctl restart "wg-quick@${WG_INTERFACE}"

echo "WireGuard initialisé : ${WG_INTERFACE} @ ${SERVER_VPN_IP}/${SUBNET_MASK} port ${WG_PORT}"
echo "Clé publique serveur : ${PUBKEY}"

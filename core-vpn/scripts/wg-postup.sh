#!/bin/bash
# GHOST-SCAN FIX v6.2: Quoted all $INTERFACE usages (word-splitting protection).
INTERFACE=$1
IPTABLES_BIN=$(command -v iptables || echo "/usr/sbin/iptables")
IP6TABLES_BIN=$(command -v ip6tables || echo "/usr/sbin/ip6tables")
SERVER_INTERFACE=$(ip route | grep default | awk '{print $5}' | head -n1)

# IPv4 Rules
$IPTABLES_BIN -I FORWARD -i "$INTERFACE" -j ACCEPT || true
$IPTABLES_BIN -I FORWARD -o "$INTERFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT || true
if [ -n "$SERVER_INTERFACE" ]; then
    $IPTABLES_BIN -t nat -A POSTROUTING -o $SERVER_INTERFACE -j MASQUERADE || true
fi
$IPTABLES_BIN -t mangle -I FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu || true

# 💠 Vibe-OS DNS Redirection: Force clients to use AdGuard (DNAT)
# Note: AdGuard is on the vpn-internal network. We target the adguard service IP (172.20.0.100).
$IPTABLES_BIN -t nat -I PREROUTING -i "$INTERFACE" -p udp --dport 53 -j DNAT --to-destination 172.20.0.100 || true
$IPTABLES_BIN -t nat -I PREROUTING -i "$INTERFACE" -p tcp --dport 53 -j DNAT --to-destination 172.20.0.100 || true

# IPv6 Rules
$IP6TABLES_BIN -I FORWARD -i "$INTERFACE" -j ACCEPT || true
$IP6TABLES_BIN -I FORWARD -o "$INTERFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT || true
if [ -n "$SERVER_INTERFACE" ]; then
    $IP6TABLES_BIN -t nat -A POSTROUTING -o $SERVER_INTERFACE -j MASQUERADE || true
fi
$IP6TABLES_BIN -t mangle -I FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu || true

# Re-apply peers and PSKs from client configs
CLIENTS_DIR="/etc/wireguard/clients"
if [ -d "$CLIENTS_DIR" ]; then
    find "$CLIENTS_DIR" -maxdepth 3 -name "public.key" | while read pubkey_file; do
        CLIENT_DIR=$(dirname "$pubkey_file")
        if [ -f "$CLIENT_DIR/disabled" ]; then continue; fi
        PUBKEY=$(cat "$pubkey_file" | tr -d '[:space:]')
        if [ -f "$CLIENT_DIR/preshared.key" ] && [ -f "$CLIENT_DIR/allowed_ips.txt" ]; then
            ALLOWED_IPS=$(cat "$CLIENT_DIR/allowed_ips.txt" | tr -d '\r\n[:space:]')
            if [ -n "$PUBKEY" ] && [ -n "$ALLOWED_IPS" ]; then
                wg set "$INTERFACE" peer "$PUBKEY" preshared-key "$CLIENT_DIR/preshared.key" allowed-ips "$ALLOWED_IPS"
            fi
        fi
    done
fi

[ -x /usr/local/bin/wg-apply-qos.sh ] && /usr/local/bin/wg-apply-qos.sh
[ -x /usr/local/bin/wg-optimize.sh ] && /usr/local/bin/wg-optimize.sh restore

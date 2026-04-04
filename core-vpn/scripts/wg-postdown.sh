#!/bin/bash
# GHOST-SCAN FIX v6.2: Quoted all $INTERFACE usages (word-splitting protection).
INTERFACE=$1
IPTABLES_BIN=$(command -v iptables || echo "/usr/sbin/iptables")
IP6TABLES_BIN=$(command -v ip6tables || echo "/usr/sbin/ip6tables")
SERVER_INTERFACE=$(ip route | grep default | awk '{print $5}' | head -n1)

$IPTABLES_BIN -D FORWARD -i "$INTERFACE" -j ACCEPT || true
$IPTABLES_BIN -D FORWARD -o "$INTERFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT || true
if [ -n "$SERVER_INTERFACE" ]; then
    $IPTABLES_BIN -t nat -D POSTROUTING -o $SERVER_INTERFACE -j MASQUERADE || true
fi
$IPTABLES_BIN -t mangle -D FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu || true

# 💠 Vibe-OS DNS Redirection Cleanup
$IPTABLES_BIN -t nat -D PREROUTING -i "$INTERFACE" -p udp --dport 53 -j DNAT --to-destination 172.20.0.100 || true
$IPTABLES_BIN -t nat -D PREROUTING -i "$INTERFACE" -p tcp --dport 53 -j DNAT --to-destination 172.20.0.100 || true

$IP6TABLES_BIN -D FORWARD -i "$INTERFACE" -j ACCEPT || true
$IP6TABLES_BIN -D FORWARD -o "$INTERFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT || true
if [ -n "$SERVER_INTERFACE" ]; then
    $IP6TABLES_BIN -t nat -D POSTROUTING -o $SERVER_INTERFACE -j MASQUERADE || true
fi
$IP6TABLES_BIN -t mangle -D FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu || true

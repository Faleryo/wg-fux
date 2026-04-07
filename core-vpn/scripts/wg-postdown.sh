#!/bin/bash
# --- VIBE-OS v6.5 : WireGuard Post-Down Hook ---
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

INTERFACE="${1:-wg0}"
IPTABLES_BIN=$(command -v iptables || echo "/usr/sbin/iptables")
IP6TABLES_BIN=$(command -v ip6tables || echo "/usr/sbin/ip6tables")
SERVER_INTERFACE=$(ip route | grep default | awk '{print $5}' | head -n1)

_del_rule() {
    local cmd="$1"
    shift
    while "$cmd" -C "$@" &>/dev/null; do
        "$cmd" -D "$@"
    done
}

log_info "Nettoyage du pare-feu pour $INTERFACE..."

# 1. Forwarding Rules
_del_rule "$IPTABLES_BIN" FORWARD -i "$INTERFACE" -j ACCEPT
_del_rule "$IPTABLES_BIN" FORWARD -o "$INTERFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

# 2. NAT (IPv4)
if [ -n "$SERVER_INTERFACE" ]; then
    _del_rule "$IPTABLES_BIN" -t nat POSTROUTING -o "$SERVER_INTERFACE" -j MASQUERADE
fi

# 3. MSS Clamping
_del_rule "$IPTABLES_BIN" -t mangle FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

# 4. DNS Redirection Cleanup
_del_rule "$IPTABLES_BIN" -t nat PREROUTING -i "$INTERFACE" -p udp --dport 53 -j DNAT --to-destination 172.20.0.100
_del_rule "$IPTABLES_BIN" -t nat PREROUTING -i "$INTERFACE" -p tcp --dport 53 -j DNAT --to-destination 172.20.0.100

# 5. IPv6 Handling
if [ -n "$IP6TABLES_BIN" ]; then
    _del_rule "$IP6TABLES_BIN" FORWARD -i "$INTERFACE" -j ACCEPT
    _del_rule "$IP6TABLES_BIN" FORWARD -o "$INTERFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
    if [ -n "$SERVER_INTERFACE" ]; then
        _del_rule "$IP6TABLES_BIN" -t nat POSTROUTING -o "$SERVER_INTERFACE" -j MASQUERADE
    fi
    _del_rule "$IP6TABLES_BIN" -t mangle FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
fi

log_info "Pare-feu nettoyé avec succès (v6.5 SRE)."

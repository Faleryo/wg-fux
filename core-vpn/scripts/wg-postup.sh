#!/bin/bash
# --- : WireGuard Post-Up Hook ---
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

INTERFACE="${1:-wg0}"
IPTABLES_BIN=$(command -v iptables || echo "/usr/sbin/iptables")
IP6TABLES_BIN=$(command -v ip6tables 2>/dev/null || true)
SERVER_INTERFACE=$(ip route | grep default | awk '{print $5}' | head -n1)

_add_rule() {
 local cmd="$1"
 shift
 # SRE: Ensure -t <table> is placed BEFORE the action (-C, -I) for nf_tables compatibility
 if [ "${1:-}" == "-t" ]; then
 local table_opt="$1 $2"
 shift 2
 # shellcheck disable=SC2086
 if ! "$cmd" $table_opt -C "$@" &>/dev/null; then
 # shellcheck disable=SC2086
 "$cmd" $table_opt -I "$@"
 fi
 else
 if ! "$cmd" -C "$@" &>/dev/null; then
 "$cmd" -I "$@"
 fi
 fi
}

# Load manager.conf safely via load_config() (validates for shell metacharacters)
load_config
# Load QoS profile safely (validate for dangerous chars before sourcing)
if [ -f /etc/wireguard/qos.profile ]; then
  if grep -v '^\s*#' /etc/wireguard/qos.profile | grep -qE '[`$;|&<>()\{\}]' 2>/dev/null; then
    log_error "Dangerous characters in qos.profile — aborting"
    exit 1
  fi
  # shellcheck disable=SC1091
  source /etc/wireguard/qos.profile
fi

log_info "Configuration du pare-feu pour $INTERFACE ($SERVER_INTERFACE)..."

# 1. Forwarding Rules
# Peer-to-peer isolation: drop traffic that enters AND exits the WG tunnel
# (peer ↔ peer). Set PEER_ISOLATION=true in /etc/wireguard/manager.conf.
if [ "${PEER_ISOLATION:-false}" = "true" ]; then
 _add_rule "$IPTABLES_BIN" FORWARD -i "$INTERFACE" -o "$INTERFACE" -j DROP
 log_info "🛡 Peer isolation enabled (intra-tunnel forwarding dropped)"
fi
_add_rule "$IPTABLES_BIN" FORWARD -i "$INTERFACE" -j ACCEPT
_add_rule "$IPTABLES_BIN" FORWARD -o "$INTERFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

# 2. NAT (IPv4)
if [ -n "$SERVER_INTERFACE" ]; then
 _add_rule "$IPTABLES_BIN" -t nat POSTROUTING -o "$SERVER_INTERFACE" -j MASQUERADE
fi

# 3. MSS Clamping (Performance)
_add_rule "$IPTABLES_BIN" -t mangle FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

# 4. DNS Redirection (AdGuard Home: 172.20.0.100)
_add_rule "$IPTABLES_BIN" -t nat PREROUTING -i "$INTERFACE" -p udp --dport 53 -j DNAT --to-destination 172.20.0.100
_add_rule "$IPTABLES_BIN" -t nat PREROUTING -i "$INTERFACE" -p tcp --dport 53 -j DNAT --to-destination 172.20.0.100

# 5. IPv6 Handling
if [ -n "$IP6TABLES_BIN" ]; then
 _add_rule "$IP6TABLES_BIN" FORWARD -i "$INTERFACE" -j ACCEPT
 _add_rule "$IP6TABLES_BIN" FORWARD -o "$INTERFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
 if [ -n "$SERVER_INTERFACE" ]; then
 _add_rule "$IP6TABLES_BIN" -t nat POSTROUTING -o "$SERVER_INTERFACE" -j MASQUERADE
 fi
 _add_rule "$IP6TABLES_BIN" -t mangle FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
fi

# 6. DSCP EF marking for WireGuard UDP egress (gaming profile only).
# CAKE diffserv4 prioritises EF (DSCP 46) → better latency at the bottleneck.
if [ "${PROFILE:-default}" = "gaming" ] && [ -n "$SERVER_INTERFACE" ]; then
 SERVER_PORT_MARK="${SERVER_PORT:-51820}"
 _add_rule "$IPTABLES_BIN" -t mangle POSTROUTING -o "$SERVER_INTERFACE" \
 -p udp --sport "$SERVER_PORT_MARK" -j DSCP --set-dscp-class EF
 log_info "🎮 DSCP EF marking enabled for WG UDP egress (port $SERVER_PORT_MARK)"
fi

log_info "Pare-feu configuré avec succès (v6.6 SRE)."

# 7. QoS Tree — rebuild on interface up so profile (gaming/streaming/default)
# survives reboots. wg-apply-qos.sh reads /etc/wireguard/qos.profile.
if [ -x "$SCRIPT_DIR/wg-apply-qos.sh" ]; then
 "$SCRIPT_DIR/wg-apply-qos.sh" || log_warn "wg-apply-qos.sh failed at PostUp (continuing)"
fi

# 8. Peer re-sync — réapplique tous les clients actifs sur l'interface.
# wg0.conf ne contient aucun bloc [Peer] (SaveConfig=false) : sans ça, les peers
# disparaissent à chaque montée d'interface (reboot / restart / auto-healing),
# déconnectant silencieusement tous les clients.
if [ -x "$SCRIPT_DIR/wg-sync-peers.sh" ]; then
 "$SCRIPT_DIR/wg-sync-peers.sh" || log_warn "wg-sync-peers.sh failed at PostUp (continuing)"
fi

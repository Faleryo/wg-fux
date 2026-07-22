#!/bin/bash
# --- : WireGuard Post-Down Hook ---
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

INTERFACE="${1:-wg0}"
IPTABLES_BIN=$(command -v iptables || echo "/usr/sbin/iptables")
IP6TABLES_BIN=$(command -v ip6tables 2>/dev/null || true)
# Même correctif que wg-postup.sh (qui l'avait déjà reçu, pas celui-ci) : awk
# avec `exit` au 1er match évite l'abort `set -euo pipefail` que provoquaient
# `grep default` (retour 1 si absent) et `head -n1` (SIGPIPE). Sans ça, un hôte
# sans route par défaut avortait ICI — donc AVANT les gardes `[ -n "$SERVER_
# INTERFACE" ]` ci-dessous, écrites précisément pour ce cas — et le nettoyage
# NAT/DNAT/FORWARD n'avait jamais lieu : les règles restaient en place.
SERVER_INTERFACE=$(ip route show default 2>/dev/null | awk '/default/ {print $5; exit}')

_del_rule() {
 local cmd="$1"
 shift
 # BUG-3 FIX: Added safety counter to prevent infinite loop if -D fails
 # silently while -C keeps matching the rule (max 20 iterations).
 local max_iter=20
 local iter=0
 # SRE: Gère le cas -t <table> avant l'action (comme _add_rule dans wg-postup.sh)
 if [ "${1:-}" == "-t" ]; then
 local table_opt="$1 $2"
 shift 2
 # shellcheck disable=SC2086
 while "$cmd" $table_opt -C "$@" &>/dev/null; do
  # shellcheck disable=SC2086
  "$cmd" $table_opt -D "$@" || break
  iter=$((iter + 1))
  [ $iter -ge $max_iter ] && break
 done
 else
 while "$cmd" -C "$@" &>/dev/null; do
  "$cmd" -D "$@" || break
  iter=$((iter + 1))
  [ $iter -ge $max_iter ] && break
 done
 fi
}

load_config
if [ -f /etc/wireguard/qos.profile ]; then
  if grep -v '^\s*#' /etc/wireguard/qos.profile | grep -qE '[`$;|&<>()\{\}]' 2>/dev/null; then
    log_error "Dangerous characters in qos.profile — aborting"
    exit 1
  fi
  # shellcheck disable=SC1091
  source /etc/wireguard/qos.profile
fi

log_info "Nettoyage du pare-feu pour $INTERFACE..."

# 1. Forwarding Rules
# Peer isolation cleanup (idempotent — _del_rule loops while rule exists)
_del_rule "$IPTABLES_BIN" FORWARD -i "$INTERFACE" -o "$INTERFACE" -j DROP
_del_rule "$IPTABLES_BIN" FORWARD -i "$INTERFACE" -j ACCEPT
_del_rule "$IPTABLES_BIN" FORWARD -o "$INTERFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

# DSCP marking cleanup (gaming profile)
if [ -n "$SERVER_INTERFACE" ]; then
 _del_rule "$IPTABLES_BIN" -t mangle POSTROUTING -o "$SERVER_INTERFACE" \
 -p udp --sport "${SERVER_PORT:-51820}" -j DSCP --set-dscp-class EF
fi

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

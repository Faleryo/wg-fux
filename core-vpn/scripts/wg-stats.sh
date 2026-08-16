#!/bin/bash
set -euo pipefail
# --- : WireGuard Stats Bridge ---
# BUG-FIX: La 1ère ligne de "wg show dump" contient les infos INTERFACE (pas un peer).
# Elle était incluse dans le JSON → objet malformé avec des champs vides.
# Fix: skip the first line (interface line) before processing peers.

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

check_root

IFACE=""
USE_JSON=0

for arg in "$@"; do
 if [ "$arg" == "--json" ]; then
 USE_JSON=1
 else
 # The first non-flag argument is the interface
 if [ -z "$IFACE" ]; then
 IFACE="$arg"
 fi
 fi
done

# Default to wg0 if no interface specified (Grade Migration)
IFACE="${IFACE:-wg0}"

if [ "$USE_JSON" -eq 1 ]; then
 if ! ip link show "$IFACE" > /dev/null 2>&1; then
 # BUG-FIX: Dashbaord Critical Error immunity. Return [] instead of crashing.
 echo "[]"
 exit 0
 fi

 # BUG-FIX: Skip the first line (interface info: private-key public-key listen-port fwmark)
 # wg show <iface> dump outputs:
 # Line 1: <private-key> <public-key> <listen-port> <fwmark> (interface)
 # Line 2+: <public-key> <psk> <endpoint> <allowed-ips> <handshake> <rx> <tx> <keepalive> (peers)
 DUMP=$(wg show "$IFACE" dump | tail -n +2)
 NOW=$(date +%s)

 # Handle empty (no peers)
 if [ -z "$DUMP" ]; then
 echo "[]"
 exit 0
 fi

 # PERF: la boucle bash historique spawnait 4 `sed` PAR PEER (json_escape ×4)
 # → 100 peers = 400 processus par appel, appelé toutes les ~5 s par dashboard.
 # awk fait tout le JSON en UN seul processus.
 printf '%s\n' "$DUMP" | awk -F'\t' -v now="$NOW" '
 function esc(s) {
  gsub(/[[:cntrl:]]/, "", s)
  gsub(/\\/, "\\\\", s)
  gsub(/"/, "\\\"", s)
  return s
 }
 BEGIN { print "["; first = 1 }
 $1 != "" {
  hs = $5 + 0; rx = $6 + 0; tx = $7 + 0
  ka = ($8 == "") ? "0" : $8
  online = (hs > 0 && now - hs < 180) ? "true" : "false"
  printf "%s {\"publicKey\": \"%s\", \"endpoint\": \"%s\", \"allowedIps\": \"%s\", \"lastHandshake\": %d, \"rx\": %d, \"tx\": %d, \"isOnline\": %s, \"keepalive\": \"%s\"}", \
    (first ? "" : ",\n"), esc($1), esc($3), esc($4), hs, rx, tx, online, esc(ka)
  first = 0
 }
 END { print "\n]" }'
else
 # Standard output
 /usr/bin/wg show "$IFACE"
fi

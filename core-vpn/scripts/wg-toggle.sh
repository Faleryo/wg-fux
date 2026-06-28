#!/bin/bash
# --- : Peer Toggle v6.2 (SRE) ---
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

if [ $# -lt 4 ]; then
  log_error "Usage: $0 <interface> <command> <peer> <action> [value]"
  exit 1
fi

INTERFACE=$1
COMMAND=$2
PEER=$3
ACTION=$4
VALUE=${5:-""}

# Validation
if [[ ! "$INTERFACE" =~ ^[a-zA-Z0-9_\-]+$ ]]; then log_error "Toggle: Invalid interface $INTERFACE"; exit 1; fi
if [[ "$COMMAND" != "peer" ]]; then log_error "Toggle: Only 'peer' command allowed"; exit 1; fi
if [[ ! "$PEER" =~ ^[a-zA-Z0-9+/=]+$ ]]; then log_error "Toggle: Invalid peer public key"; exit 1; fi

if [[ "$ACTION" == "remove" ]]; then
 # Idempotence: ignore failure if peer is NOT in the interface (already removed)
 /usr/bin/wg set "$INTERFACE" peer "$PEER" remove 2>/dev/null || true
elif [[ "$ACTION" == "allowed-ips" ]]; then
 if [[ ! "$VALUE" =~ ^[a-fA-F0-9:.,/\ ]+$ ]]; then log_error "Toggle: Invalid AllowedIPs"; exit 1; fi
 # Ré-activer un peer désactivé = le ré-AJOUTER (il a été retiré via 'remove').
 # Il faut restaurer son preshared-key, sinon le peer est ré-ajouté SANS PSK et
 # le client ne peut plus se connecter (PSK mismatch). On retrouve le PSK en
 # matchant la clé publique dans /etc/wireguard/clients (source de vérité).
 PSK_PATH=""
 while IFS= read -r -d '' _pkf; do
  if [ "$(tr -d '[:space:]' < "$_pkf" 2>/dev/null)" = "$PEER" ]; then
   _cand="$(dirname "$_pkf")/preshared.key"
   [ -f "$_cand" ] && PSK_PATH="$_cand"
   break
  fi
 done < <(find /etc/wireguard/clients -name "public.key" -print0 2>/dev/null)
 if [ -n "$PSK_PATH" ]; then
  /usr/bin/wg set "$INTERFACE" peer "$PEER" preshared-key "$PSK_PATH" allowed-ips "$VALUE" || { log_warn "Toggle: allowed-ips set failed (check if peer exists)"; }
 else
  /usr/bin/wg set "$INTERFACE" peer "$PEER" allowed-ips "$VALUE" || { log_warn "Toggle: allowed-ips set failed (check if peer exists)"; }
 fi
else
 log_error "Toggle: Unsupported action '$ACTION'"; exit 1; fi

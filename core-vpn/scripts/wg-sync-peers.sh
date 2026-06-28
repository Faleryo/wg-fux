#!/bin/bash
# --- : WireGuard Peer Re-Sync v1.0 (SRE) ---
# wg0.conf ne contient VOLONTAIREMENT aucun bloc [Peer] (SaveConfig=false) :
# les peers sont ajoutés au runtime via `wg set`. Ils sont donc PERDUS à chaque
# (re)création de l'interface — reboot, restart du conteneur, ou auto-healing du
# watchdog SRE — et rien ne les remettait, déconnectant silencieusement tous les
# clients.
#
# Ce script ré-applique CHAQUE client actif (non désactivé, non expiré) sur
# l'interface à partir de /etc/wireguard/clients (la source de vérité durable),
# en incluant son preshared-key. Idempotent : peut être relancé à tout moment.
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

load_config
WG_INTERFACE="${WG_INTERFACE:-wg0}"
CLIENTS_DIR="/etc/wireguard/clients"

if ! ip link show "$WG_INTERFACE" >/dev/null 2>&1; then
 log_warn "Peer re-sync: interface $WG_INTERFACE absente — skip."
 exit 0
fi

NOW_TS=$(date +%s)
applied=0
skipped=0

while IFS= read -r -d '' pubkey_file; do
 cdir=$(dirname "$pubkey_file")

 # Skip clients désactivés
 if [ -f "$cdir/disabled" ]; then
  skipped=$((skipped + 1)); continue
 fi

 # Skip clients expirés
 if [ -f "$cdir/expiry" ]; then
  exp=$(tr -d '[:space:]' < "$cdir/expiry" 2>/dev/null || echo "")
  if [[ "$exp" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
   exp_ts=$(date -d "$exp" +%s 2>/dev/null || echo "")
   if [ -n "$exp_ts" ] && [ "$NOW_TS" -ge "$exp_ts" ]; then
    skipped=$((skipped + 1)); continue
   fi
  fi
 fi

 pub=$(tr -d '[:space:]' < "$pubkey_file" 2>/dev/null || echo "")
 if ! is_valid_wg_key "$pub"; then
  log_warn "Peer re-sync: clé publique invalide dans $cdir — skip."
  skipped=$((skipped + 1)); continue
 fi

 allowed=$(tr -d '[:space:]' < "$cdir/allowed_ips.txt" 2>/dev/null || echo "")
 if [ -z "$allowed" ]; then
  log_warn "Peer re-sync: allowed_ips.txt manquant pour $(basename "$cdir") — skip."
  skipped=$((skipped + 1)); continue
 fi

 psk="$cdir/preshared.key"
 if [ -f "$psk" ]; then
  if wg set "$WG_INTERFACE" peer "$pub" preshared-key "$psk" allowed-ips "$allowed" 2>/dev/null; then
   applied=$((applied + 1))
  else
   log_warn "Peer re-sync: échec d'application de $(basename "$cdir")"
  fi
 else
  if wg set "$WG_INTERFACE" peer "$pub" allowed-ips "$allowed" 2>/dev/null; then
   applied=$((applied + 1))
  else
   log_warn "Peer re-sync: échec d'application de $(basename "$cdir")"
  fi
 fi
done < <(find "$CLIENTS_DIR" -name "public.key" -print0 2>/dev/null)

log_info "Peer re-sync terminé : $applied appliqué(s), $skipped ignoré(s) (désactivé/expiré/invalide)."

#!/bin/bash
# wg-uninstall.sh — Désinstallation complète et NON-INTERACTIVE de wg-fux sur ce VPS.
#
# Invoqué à distance par la plateforme (bouton "Désinstaller" côté revendeur,
# route POST /api/servers/:id/uninstall → SshExecutor → wg-fux-dispatch.sh).
# Aucune invite possible sur ce chemin (pas de TTY) : purge intégrale directe,
# la confirmation a déjà eu lieu côté UI avant l'appel.
#
# Contrairement à scripts/setup/uninstall.sh (module interactif de l'installeur
# local, avec confirmations pas-à-pas), ce script est autonome et sans prompt.

set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

check_root

INSTALL_DIR="/opt/wg-fux"
WG_DIR="/etc/wireguard"

log_warn "Désinstallation de wg-fux (déclenchée à distance)…"

# Coupe les interfaces WireGuard actives.
if [ -d "$WG_DIR" ]; then
  for conf in "$WG_DIR"/*.conf; do
    [ -e "$conf" ] || continue
    iface="$(basename "$conf" .conf)"
    if ip link show "$iface" &>/dev/null; then
      log_info "Arrêt de l'interface $iface…"
      wg-quick down "$iface" 2>/dev/null || true
    fi
  done
fi

# Arrête et retire les conteneurs + volumes (données de l'instance incluses).
if [ -f "$INSTALL_DIR/docker-compose.yml" ]; then
  log_info "Arrêt des conteneurs et suppression des volumes…"
  (cd "$INSTALL_DIR" && docker compose down -v) || true
fi

# Sysctl / pare-feu / watchdog systemd posés par l'installeur.
if [ -f /etc/sysctl.d/99-wg-fux.conf ]; then
  log_info "Retrait des réglages sysctl…"
  rm -f /etc/sysctl.d/99-wg-fux.conf
  sysctl --system >/dev/null 2>&1 || true
fi

log_info "Retrait des règles de pare-feu…"
port="51820"
[ -f "$WG_DIR/manager.conf" ] && port=$(grep SERVER_PORT "$WG_DIR/manager.conf" 2>/dev/null | cut -d'"' -f2)
port="${port:-51820}"
ufw delete allow "$port"/udp 2>/dev/null || true
iptables -D INPUT -p udp --dport "$port" -j ACCEPT 2>/dev/null || true

if [ -f /etc/systemd/system/sentinel.service ]; then
  log_info "Désactivation du watchdog sentinel…"
  systemctl stop sentinel.service 2>/dev/null || true
  systemctl disable sentinel.service 2>/dev/null || true
  rm -f /etc/systemd/system/sentinel.service
  systemctl daemon-reload
fi

# Fichiers de configuration, données et binaires déployés par le bootstrap.
log_info "Suppression des fichiers de configuration et des données…"
rm -rf "$WG_DIR" 2>/dev/null || true
rm -rf "$INSTALL_DIR" 2>/dev/null || true
rm -f /usr/local/bin/wg-*.sh 2>/dev/null || true

log_success "wg-fux désinstallé de cette machine."

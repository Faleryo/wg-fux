#!/bin/bash
# Advanced Network Hardening with Persistence
set -euo pipefail

SYSCTL_CONF="/etc/sysctl.d/99-wg-fux.conf"
echo "[INFO] Appliquage des règles de durcissement réseau (Persistant)..."

# Ensure the config file exist
mkdir -p /etc/sysctl.d
touch "$SYSCTL_CONF"

# Helper for memory application + persistence
apply_sysctl_harden() {
    local key=$1 val=$2
    # Apply to memory
    sysctl -w "$key=$val" > /dev/null 2>&1 || true
    # Apply to file (idempotent)
    if grep -q "^$key=" "$SYSCTL_CONF"; then
        sed -i "s|^$key=.*|$key=$val|" "$SYSCTL_CONF"
    else
        echo "$key=$val" >> "$SYSCTL_CONF"
    fi
}

# Protection contre le spoofing (Reverse Path Filtering)
apply_sysctl_harden net.ipv4.conf.all.rp_filter 1
apply_sysctl_harden net.ipv4.conf.default.rp_filter 1

# Protection contre les attaques SYN Flood
apply_sysctl_harden net.ipv4.tcp_syncookies 1
apply_sysctl_harden net.ipv4.tcp_max_syn_backlog 2048
apply_sysctl_harden net.ipv4.tcp_synack_retries 2
apply_sysctl_harden net.ipv4.tcp_syn_retries 5

# Désactivation des redirections ICMP (anti-Man-in-the-Middle)
apply_sysctl_harden net.ipv4.conf.all.accept_redirects 0
apply_sysctl_harden net.ipv6.conf.all.accept_redirects 0
apply_sysctl_harden net.ipv4.conf.all.send_redirects 0

# Ignorer les messages ICMP broadcast (anti-Smurf attacks)
apply_sysctl_harden net.ipv4.icmp_echo_ignore_broadcasts 1

# Protection contre les paquets malformés (Logging)
apply_sysctl_harden net.ipv4.conf.all.log_martians 1

# Augmentation des limites de connexions persistantes
apply_sysctl_harden net.core.somaxconn 1024

echo "[OK] Système durci avec succès (Config persistante: $SYSCTL_CONF)."

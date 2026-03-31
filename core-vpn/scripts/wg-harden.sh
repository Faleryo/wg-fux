#!/bin/bash
# Advanced Network Hardening
echo "[INFO] Appliquage des règles de durcissement réseau via sysctl..."

# Protection contre le spoofing (Reverse Path Filtering)
sysctl -w net.ipv4.conf.all.rp_filter=1
sysctl -w net.ipv4.conf.default.rp_filter=1

# Protection contre les attaques SYN Flood
sysctl -w net.ipv4.tcp_syncookies=1
sysctl -w net.ipv4.tcp_max_syn_backlog=2048
sysctl -w net.ipv4.tcp_synack_retries=2
sysctl -w net.ipv4.tcp_syn_retries=5

# Désactivation des redirections ICMP (anti-Man-in-the-Middle)
sysctl -w net.ipv4.conf.all.accept_redirects=0
sysctl -w net.ipv6.conf.all.accept_redirects=0
sysctl -w net.ipv4.conf.all.send_redirects=0

# Ignorer les messages ICMP broadcast (anti-Smurf attacks)
sysctl -w net.ipv4.icmp_echo_ignore_broadcasts=1

# Protection contre les paquets malformés (Logging)
sysctl -w net.ipv4.conf.all.log_martians=1

# Augmentation des limites de connexions persistantes
sysctl -w net.core.somaxconn=1024

echo "[OK] Système durci avec succès."

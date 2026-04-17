#!/bin/bash
# 💠 Security & Configuration Module
# Part of WG-FUX v6.5.0-Obsidian+

generate_admin_hash() {
    local pass="$1"
    local salt="$2"
    local hash=""

    log_info "Génération du hash sécurisé (PBKDF2-SHA512)..."
    local buf_script; buf_script=$(mktemp /tmp/wg-hash-XXXXXX.js)
    cat > "$buf_script" << 'NODESCRIPT'
const crypto = require('crypto');
const pass = process.env.WGFUX_PASS;
const salt = process.env.WGFUX_SALT;
if (!pass || !salt) { process.exit(1); }
process.stdout.write(crypto.pbkdf2Sync(pass, salt, 600000, 64, 'sha512').toString('hex'));
NODESCRIPT

    # Attempt 1: Node.js
    if command -v node &>/dev/null; then
        hash=$(WGFUX_PASS="$pass" WGFUX_SALT="$salt" node "$buf_script" 2>/dev/null || echo "")
    fi

    # Attempt 2: Python3
    if [ -z "$hash" ] && command -v python3 &>/dev/null; then
        hash=$(WGFUX_PASS="$pass" WGFUX_SALT="$salt" python3 -c 'import hashlib, os, binascii; dk = hashlib.pbkdf2_hmac("sha512", os.environ["WGFUX_PASS"].encode(), os.environ["WGFUX_SALT"].encode(), 600000); print(binascii.hexlify(dk).decode())' 2>/dev/null || echo "")
    fi

    rm -f "$buf_script"
    echo "$hash"
}

setup_firewall() {
    local port="${SERVER_PORT:-51820}"
    log_info "Configuration du pare-feu (Ports: 80, 443, $port/udp)..."

    if command -v ufw &> /dev/null; then
        sudo ufw allow 80/tcp 2>/dev/null || true
        sudo ufw allow 443/tcp 2>/dev/null || true
        sudo ufw allow "$port"/udp 2>/dev/null || true
        sudo ufw allow 22/tcp 2>/dev/null || true
        echo "y" | sudo ufw enable 2>/dev/null || true
        log_success "UFW configuré."
    elif command -v iptables &> /dev/null; then
        sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
        sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
        sudo iptables -I INPUT -p udp --dport "$port" -j ACCEPT 2>/dev/null || true
        log_success "iptables configuré."
    fi
}

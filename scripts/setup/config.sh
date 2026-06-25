#!/bin/bash
# Secrets, hashing, firewall helpers.

# Generates a PBKDF2-SHA512 hash with 600k iterations. Uses Node.js or Python3.
# Returns the hash on stdout (empty string + non-zero on failure).
generate_admin_hash() {
    local pass="$1" salt="$2" hash=""
    if [ -z "$pass" ] || [ -z "$salt" ]; then
        log_error "generate_admin_hash: missing pass or salt"
        return 1
    fi

    if command -v node &>/dev/null; then
        hash=$(WGFUX_PASS="$pass" WGFUX_SALT="$salt" node -e '
            const c = require("crypto");
            console.log(
                c.pbkdf2Sync(process.env.WGFUX_PASS, process.env.WGFUX_SALT,
                             600000, 64, "sha512").toString("hex")
            );
        ' 2>/dev/null || echo "")
    fi

    if [ -z "$hash" ] && command -v python3 &>/dev/null; then
        hash=$(WGFUX_PASS="$pass" WGFUX_SALT="$salt" python3 -c '
import hashlib, os, binascii
dk = hashlib.pbkdf2_hmac("sha512",
                         os.environ["WGFUX_PASS"].encode(),
                         os.environ["WGFUX_SALT"].encode(),
                         600000)
print(binascii.hexlify(dk).decode())
' 2>/dev/null || echo "")
    fi

    unset WGFUX_PASS WGFUX_SALT
    if [ -z "$hash" ]; then
        log_error "Neither node nor python3 produced a hash."
        return 1
    fi
    echo "$hash"
}

setup_firewall() {
    local port="${SERVER_PORT:-51820}"
    log_info "Configuring firewall (80/tcp, 443/tcp, ${port}/udp)…"

    if command -v ufw &>/dev/null; then
        sudo ufw allow 22/tcp     2>/dev/null || true
        sudo ufw allow 80/tcp     2>/dev/null || true
        sudo ufw allow 443/tcp    2>/dev/null || true
        sudo ufw allow "$port"/udp 2>/dev/null || true
        sudo ufw --force enable    2>/dev/null || true
        log_success "ufw configured."
    elif command -v iptables &>/dev/null; then
        sudo iptables -C INPUT -p tcp --dport 80  -j ACCEPT 2>/dev/null || \
            sudo iptables -I INPUT -p tcp --dport 80  -j ACCEPT
        sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || \
            sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
        sudo iptables -C INPUT -p udp --dport "$port" -j ACCEPT 2>/dev/null || \
            sudo iptables -I INPUT -p udp --dport "$port" -j ACCEPT
        log_success "iptables rules added (not persisted — use iptables-persistent)."
    else
        log_warn "Neither ufw nor iptables found, skipping firewall config."
    fi
}

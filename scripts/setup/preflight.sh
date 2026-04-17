#!/bin/bash
# 💠 Preflight Scan Module
# Part of WG-FUX v6.5.0-Obsidian+

preflight_scan() {
    log_info "Lancement du Scan de Pré-vol (v6.5 Multilingual Guardian)..."
    
    # 1. Architecture CPU
    local arch; arch=$(uname -m)
    log_info "Architecture : $arch"
    
    # 2. Mémoire Vive
    local ram_kb; ram_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local ram_mb=$((ram_kb / 1024))
    if [ "$ram_mb" -lt 1024 ]; then
        log_warn "Mémoire vive faible (${ram_mb}MB). Le build Docker pourrait échouer sans swap."
    else
        log_success "Mémoire vive OK (${ram_mb}MB)."
    fi
    
    # 3. Espace Disque (/)
    local free_kb; free_kb=$(df -k / | awk 'NR==2 {print $4}')
    local free_gb=$((free_kb / 1024 / 1024))
    if [ "$free_gb" -lt 5 ]; then
        log_warn "Espace disque restreint (${free_gb}GB libres). 5GB minimum recommandés."
    else
        log_success "Espace disque OK (${free_gb}GB)."
    fi
    
    # 4. Connectivité
    if ping -c 1 8.8.8.8 &>/dev/null; then
        log_success "Connectivité Internet OK."
    else
        log_error "Pas de connectivité Internet. Impossible de télécharger les dépendances."
        exit 1
    fi

    # 5. WARN-2 : Vérification des permissions /etc/wireguard (critique en production)
    if [ -d "$WG_DIR" ]; then
        local wg_perms; wg_perms=$(stat -c "%a %U:%G" "$WG_DIR")
        local wg_perm_octal; wg_perm_octal=$(echo "$wg_perms" | awk '{print $1}')
        if [ "$wg_perm_octal" != "755" ]; then
            log_warn "/etc/wireguard permissions = $wg_perms (requis : 755 pour accès API)"
            log_warn "Correction automatique des permissions..."
            sudo chmod 755 "$WG_DIR"
            sudo chown root:root "$WG_DIR"
            log_success "/etc/wireguard configuré à 755 root:root"
        else
            log_success "/etc/wireguard permissions OK ($wg_perms)"
        fi
    fi
}

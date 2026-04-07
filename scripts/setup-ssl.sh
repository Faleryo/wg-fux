#!/bin/bash
# 💠 Vibe-OS SSL Setup Manager v4.0 (Recovery Edition)
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../core-vpn/scripts/wg-common.sh"

# Configuration
DOMAIN="${DOMAIN:-vpn.faleryo.site}"
EMAIL="${EMAIL:-faleryo@example.com}" # SRE: Replace with real email if needed
EXTRA_DOMAINS="fux.faleryo.site" # SRE: Bypass alias

log_info "[DIAGNOSTIC] Lancement de la gestion SSL (v4.0 Bypass)..."

# 1. Détection de certificats existants
EXISTING_CERT=$(docker compose run --rm --entrypoint ls certbot /etc/letsencrypt/live/ 2>/dev/null | grep "^$DOMAIN" | sort -r | head -n1 || true)

USE_EXISTING=false
if [ -z "${FORCE_RENEW:-}" ] && [ -n "$EXISTING_CERT" ]; then
    log_warn "Certificat existant détecté : $EXISTING_CERT"
    # En mode interactif, on pourrait demander. En mode script Antigravity, on privilégie la récup si possible.
    USE_EXISTING=true
fi

if [ "$USE_EXISTING" = true ]; then
    log_success "Utilisation du certificat existant : $EXISTING_CERT"
    DOMAIN_DIR="$EXISTING_CERT"
else
    log_info "Demande de nouveau certificat (Bypass Mode ACTIVE)..."
    log_info "Domaines : $DOMAIN, $EXTRA_DOMAINS"
    
    # 💠 SRE: Commande de Bypass multi-domaine
    if ! docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
        --email "$EMAIL" --agree-tos --no-eff-email \
        -d "$DOMAIN" -d "$EXTRA_DOMAINS"; then
        
        log_error "La demande Certbot a échoué. Tentative de secours sur certificat existant..."
        EXISTING_CERT=$(docker compose run --rm --entrypoint ls certbot /etc/letsencrypt/live/ 2>/dev/null | grep "^$DOMAIN" | sort -r | head -n1 || true)
        if [ -z "$EXISTING_CERT" ]; then
            log_error "Échec critique : Aucun certificat (réel ou ancien) n'est disponible."
            exit 1
        fi
        DOMAIN_DIR="$EXISTING_CERT"
    else
        log_success "Certbot a réussi. Détection de l'emplacement final..."
        DOMAIN_DIR=$(docker compose run --rm --entrypoint ls certbot /etc/letsencrypt/live/ 2>/dev/null | grep "^$DOMAIN" | sort -r | head -n1 || true)
        [ -z "$DOMAIN_DIR" ] && DOMAIN_DIR="$DOMAIN" # Fallback if ls fails but cmd succeeded
    fi
fi

# 2. Mise à jour de Nginx
log_info "Configuration Nginx pour $DOMAIN_DIR..."
NGINX_CONF="infra/nginx/default.conf"

sed -i "s|server_name __DOMAIN__;|server_name $DOMAIN;|g" "$NGINX_CONF"
sed -i "s|/etc/letsencrypt/live/__DOMAIN__/|/etc/letsencrypt/live/$DOMAIN_DIR/|g" "$NGINX_CONF"

log_info "Validation de la config Nginx..."
docker compose exec -T nginx nginx -t

log_info "Redémarrage de Nginx..."
docker compose restart nginx

log_success "SSL est maintenant actif sur https://$DOMAIN"

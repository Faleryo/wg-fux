#!/bin/bash
# 💠 Vibe-OS SSL Setup Manager v4.1 (Recovery Edition)

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../core-vpn/scripts/wg-common.sh"

# Configuration (From Environment or .env)
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
EXTRA_DOMAINS="${EXTRA_DOMAINS:-}"

# 💠 SRE: Si EMAIL vide, demander interactivement ou utiliser le mode non-interactif
if [ -z "$EMAIL" ]; then
    if [ -t 0 ]; then
        # stdin est un terminal : on peut demander
        printf "\033[1;33m[?] Entrez votre email Let's Encrypt (ou appuyez sur Entrée pour s'inscrire sans email): \033[0m"
        read -r EMAIL
    fi
fi

if [ -z "$DOMAIN" ]; then
    log_warn "Aucun nom de domaine configuré (DOMAIN). Utilisation du mode IP-only (Auto-signé)."
    # On bypass Certbot si pas de domaine
    exit 0
fi

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
    
    # 💠 SRE: Construction dynamique de la commande Certbot
    if [ -n "$EMAIL" ]; then
        CERTBOT_CMD="certbot certonly --webroot -w /var/www/certbot --email $EMAIL --agree-tos --no-eff-email"
    else
        log_warn "Aucun email fourni → utilisation du mode '--register-unsafely-without-email'"
        CERTBOT_CMD="certbot certonly --webroot -w /var/www/certbot --register-unsafely-without-email --agree-tos --no-eff-email"
    fi
    CERTBOT_CMD="$CERTBOT_CMD -d $DOMAIN"
    
    if [ -n "$EXTRA_DOMAINS" ]; then
        CERTBOT_CMD="$CERTBOT_CMD -d $EXTRA_DOMAINS"
        log_info "Domaines : $DOMAIN, $EXTRA_DOMAINS"
    else
        log_info "Domaine : $DOMAIN"
    fi

    if ! docker compose run --rm --entrypoint sh certbot -c "$CERTBOT_CMD"; then
        log_error "La demande Certbot a échoué. Tentative de secours..."
        EXISTING_CERT=$(docker compose run --rm --entrypoint ls certbot /etc/letsencrypt/live/ 2>/dev/null | grep "^$DOMAIN" | sort -r | head -n1 || true)
        if [ -z "$EXISTING_CERT" ]; then
            log_warn "Échec Certbot : aucun certificat Let's Encrypt disponible."
            log_warn "Basculement sur le certificat auto-signé (infra/ssl/). HTTPS sera actif avec avertissement navigateur."
            # Mettre à jour nginx pour utiliser les certs auto-signés
            NGINX_CONF="infra/nginx/default.conf"
            sed -i "s|ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;|ssl_certificate /etc/nginx/ssl/server.crt;|g" "$NGINX_CONF" 2>/dev/null || true
            sed -i "s|ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;|ssl_certificate_key /etc/nginx/ssl/server.key;|g" "$NGINX_CONF" 2>/dev/null || true
            log_success "Nginx configuré pour le certificat auto-signé."
            return 0
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

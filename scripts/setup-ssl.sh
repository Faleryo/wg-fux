#!/bin/bash
# 💠 Vibe-OS SSL Setup Manager v5.0 (Two-Phase Edition)
# Résout le problème chicken-and-egg Let's Encrypt :
#   Phase 1 : Nginx démarre avec cert auto-signé (toujours dispo)
#   Phase 2 : Certbot valide via Nginx déjà actif sur port 80
#             → patch nginx → reload

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/../core-vpn/scripts/wg-common.sh"

# Configuration (From Environment or .env)
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
EXTRA_DOMAINS="${EXTRA_DOMAINS:-}"
NGINX_CONF="infra/nginx/default.conf"

# ─────────────────────────────────────────────────
# PHASE 0 : Validation préalable
# ─────────────────────────────────────────────────

# Si EMAIL vide, demander ou utiliser le mode sans email
if [ -z "$EMAIL" ]; then
    if [ -t 0 ]; then
        printf "\033[1;33m[?] Email Let's Encrypt (Entrée = sans email): \033[0m"
        read -r EMAIL
    fi
fi

if [ -z "$DOMAIN" ]; then
    log_warn "Aucun domaine configuré (DOMAIN). Mode IP-only → certificat auto-signé actif."
    log_info "Nginx est configuré avec le cert auto-signé de infra/ssl/. Aucune action SSL requise."
    exit 0
fi

log_info "[SSL v5.0] Lancement de la gestion SSL à deux phases..."
log_info "Domaine cible : $DOMAIN"

# ─────────────────────────────────────────────────
# PHASE 1 : S'assurer que Nginx peut démarrer
# Nginx est configuré par défaut avec le cert auto-signé dans default.conf
# (ssl_certificate /etc/nginx/ssl/server.crt)
# → Nginx démarre toujours, même sans cert LE
# ─────────────────────────────────────────────────

# Vérifier que le cert auto-signé source existe
if [ ! -f "infra/ssl/server.crt" ] || [ ! -f "infra/ssl/server.key" ]; then
    log_warn "Cert auto-signé absent dans infra/ssl/. Génération en urgence..."
    mkdir -p infra/ssl
    openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
        -keyout infra/ssl/server.key \
        -out infra/ssl/server.crt \
        -subj "/C=FR/ST=VPS/L=Cloud/O=WG-FUX/CN=$DOMAIN" 2>/dev/null
    log_success "Cert auto-signé généré pour $DOMAIN."
fi

# ─────────────────────────────────────────────────
# PHASE 2 : Obtention cert Let's Encrypt
# Prérequis : Nginx DOIT être up et servir le port 80
# (appelé depuis update_process() APRÈS docker compose up -d)
# ─────────────────────────────────────────────────

# Attendre que Nginx soit opérationnel (port 80 accessible)
log_info "Vérification que Nginx est UP sur le port 80..."
NGINX_READY=false
for i in $(seq 1 30); do
    if docker compose exec -T nginx nginx -t &>/dev/null 2>&1; then
        NGINX_READY=true
        break
    fi
    log_info "Attente Nginx... ($i/30)"
    sleep 3
done

if [ "$NGINX_READY" = false ]; then
    log_warn "Nginx ne répond pas après 90s. Tentative de redémarrage..."
    docker compose restart nginx 2>/dev/null || true
    sleep 10
fi

# Vérifier port 80 accessible depuis l'extérieur
log_info "Test de connectivité port 80..."
if ! curl -s --max-time 5 "http://$DOMAIN/.well-known/acme-challenge/probe" &>/dev/null; then
    log_warn "Port 80 inaccessible depuis l'extérieur pour $DOMAIN."
    log_warn "Vérifiez : DNS vpn.faleryo.site → $DOMAIN pointé vers cette IP ?"
    log_warn "Vérifiez : port 80 ouvert dans le firewall ?"
fi

# Vérifier s'il existe déjà un cert LE valide
EXISTING_CERT=$(docker compose run --rm --entrypoint ls certbot /etc/letsencrypt/live/ 2>/dev/null | grep "^$DOMAIN" | sort -r | head -n1 || true)

if [ -z "${FORCE_RENEW:-}" ] && [ -n "$EXISTING_CERT" ]; then
    log_success "Certificat Let's Encrypt existant détecté : $EXISTING_CERT"
    DOMAIN_DIR="$EXISTING_CERT"
    _apply_le_cert
    exit 0
fi

# Construction commande Certbot
if [ -n "$EMAIL" ]; then
    CERTBOT_ARGS="--email $EMAIL --agree-tos --no-eff-email"
else
    log_warn "Aucun email → mode '--register-unsafely-without-email'"
    CERTBOT_ARGS="--register-unsafely-without-email --agree-tos --no-eff-email"
fi

CERTBOT_DOMAINS="-d $DOMAIN"
if [ -n "$EXTRA_DOMAINS" ]; then
    CERTBOT_DOMAINS="$CERTBOT_DOMAINS -d $EXTRA_DOMAINS"
    log_info "Domaines SAN : $DOMAIN, $EXTRA_DOMAINS"
fi

CERTBOT_CMD="certbot certonly --webroot -w /var/www/certbot $CERTBOT_ARGS $CERTBOT_DOMAINS"

log_info "Lancement Certbot (webroot via Nginx sur port 80)..."
if docker compose run --rm --entrypoint sh certbot -c "$CERTBOT_CMD"; then
    log_success "Certbot : certificat obtenu avec succès !"
    DOMAIN_DIR=$(docker compose run --rm --entrypoint ls certbot /etc/letsencrypt/live/ 2>/dev/null | grep "^$DOMAIN" | sort -r | head -n1 || echo "$DOMAIN")
    _apply_le_cert
else
    log_error "Certbot a échoué (voir erreur ci-dessus)."
    log_warn "Causes fréquentes :"
    log_warn "  1. DNS vpn.faleryo.site ne pointe pas encore vers $(curl -4 -s --max-time 3 ifconfig.me 2>/dev/null || echo 'cette IP')"
    log_warn "  2. Port 80 bloqué par le firewall ou le provider VPS"
    log_warn "  3. Rate limit Let's Encrypt (5 tentatives/heure/domaine)"
    log_warn "Nginx reste actif avec le certificat auto-signé. HTTPS fonctionne avec avertissement navigateur."
    log_info "Pour relancer le SSL plus tard : sudo bash setup.sh → option 7"
    exit 0  # Ne pas faire échouer l'installation complète
fi

# ─────────────────────────────────────────────────
# Fonction interne : patcher nginx avec les certs LE
# ─────────────────────────────────────────────────
_apply_le_cert() {
    log_info "Application du certificat Let's Encrypt dans Nginx..."

    # Remplacer les chemins cert auto-signé par les chemins LE
    sed -i "s|ssl_certificate /etc/nginx/ssl/server.crt;|ssl_certificate /etc/letsencrypt/live/$DOMAIN_DIR/fullchain.pem;|g" "$NGINX_CONF" 2>/dev/null || true
    sed -i "s|ssl_certificate_key /etc/nginx/ssl/server.key;|ssl_certificate_key /etc/letsencrypt/live/$DOMAIN_DIR/privkey.pem;|g" "$NGINX_CONF" 2>/dev/null || true

    # Mettre à jour server_name si encore le placeholder
    sed -i "s|server_name __DOMAIN__;|server_name $DOMAIN;|g" "$NGINX_CONF" 2>/dev/null || true

    log_info "Validation de la nouvelle config Nginx..."
    if docker compose exec -T nginx nginx -t 2>/dev/null; then
        log_info "Rechargement de Nginx avec le certificat Let's Encrypt..."
        docker compose exec -T nginx nginx -s reload 2>/dev/null || docker compose restart nginx 2>/dev/null || true
        log_success "✅ SSL Let's Encrypt actif sur https://$DOMAIN"
    else
        log_error "Config Nginx invalide après patch LE. Rollback vers cert auto-signé..."
        sed -i "s|ssl_certificate /etc/letsencrypt/live/$DOMAIN_DIR/fullchain.pem;|ssl_certificate /etc/nginx/ssl/server.crt;|g" "$NGINX_CONF" 2>/dev/null || true
        sed -i "s|ssl_certificate_key /etc/letsencrypt/live/$DOMAIN_DIR/privkey.pem;|ssl_certificate_key /etc/nginx/ssl/server.key;|g" "$NGINX_CONF" 2>/dev/null || true
        docker compose restart nginx 2>/dev/null || true
        log_warn "Rollback effectué. HTTPS actif avec cert auto-signé."
    fi
}

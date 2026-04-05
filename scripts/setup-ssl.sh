#!/bin/bash
# ============================================================
# WG-FUX SSL Setup Script (v6.4)
# Automates Let's Encrypt certificate issuance via Certbot
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[SSL]${NC} $1"
}

if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}[ERROR] Script must be run from the WG-FUX root directory.${NC}"
    exit 1
fi

printf "${YELLOW}[?] Entrez votre nom de domaine (ex: vpn.example.com): ${NC}"
read -r DOMAIN

if [ -z "$DOMAIN" ]; then
    echo -e "${RED}[ERROR] Le nom de domaine est obligatoire.${NC}"
    exit 1
fi

printf "${YELLOW}[?] Entrez votre adresse email (pour les notifications Let's Encrypt): ${NC}"
read -r EMAIL

if [ -z "$EMAIL" ]; then
    echo -e "${RED}[ERROR] L'adresse email est obligatoire.${NC}"
    exit 1
fi

log "Démarrage des services temporaires pour le challenge ACME..."
# On s'assure que Nginx tourne pour servir le dossier /var/www/certbot
docker compose up -d nginx

log "Demande de certificat pour $DOMAIN..."
docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
    --email "$EMAIL" --agree-tos --no-eff-email \
    -d "$DOMAIN"

log "Mise à jour de la configuration Nginx pour utiliser les nouveaux certificats..."
NGINX_CONF="infra/nginx/default.conf"

# Remplacement des chemins par défaut par les chemins Let's Encrypt
sed -i "s|ssl_certificate /etc/nginx/ssl/server.crt;|ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;|g" "$NGINX_CONF"
sed -i "s|ssl_certificate_key /etc/nginx/ssl/server.key;|ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;|g" "$NGINX_CONF"

log "Redémarrage de Nginx avec SSL actif..."
docker compose restart nginx

log "SUCCESS! Votre dashboard est maintenant accessible sur https://$DOMAIN !"

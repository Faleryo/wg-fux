#!/bin/bash
# ============================================================
# WG-FUX SSL Setup Script (v6.5 - The Multilingual Guardian)
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

printf "%b[?] Entrez votre nom de domaine (ex: vpn.example.com): %b" "${YELLOW}" "${NC}"
read -r DOMAIN

if [ -z "$DOMAIN" ]; then
    echo -e "${RED}[ERROR] Le nom de domaine est obligatoire.${NC}"
    exit 1
fi

printf "%b[?] Entrez votre adresse email (pour les notifications Let's Encrypt): %b" "${YELLOW}" "${NC}"
read -r EMAIL

if [ -z "$EMAIL" ]; then
    echo -e "${RED}[ERROR] L'adresse email est obligatoire.${NC}"
    exit 1
fi

log "Vérification/Génération du certificat de secours (Bootstrap)..."
# 💠 SRE: Si les certs Let's Encrypt n'existent pas, on crée un auto-signé pour que Nginx démarre.
# On utilise un container temporaire pour manipuler le volume certbot_certs.
docker run --rm -v "$(pwd)_certbot_certs:/etc/letsencrypt" alpine sh -c \
    "apk add --no-cache openssl && mkdir -p /etc/letsencrypt/live/$DOMAIN && \
    [ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ] || \
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
    -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
    -subj '/CN=$DOMAIN'" > /dev/null 2>&1

log "Démarrage de Nginx (Port 80 pour le challenge)..."
docker compose up -d nginx

# 💠 Vibe-OS v6.5 Pre-flight Diagnostic
chmod +x .vibe/tools/check-port80.sh
# Note: On essaie de détecter l'IP si elle n'est pas passée en env
DETECTED_IP=$(curl -4 -s ifconfig.me 2>/dev/null || echo "127.0.0.1")
if ! ./.vibe/tools/check-port80.sh "$DOMAIN" "$DETECTED_IP"; then
    printf "%b%b[WARNING] Des problèmes de connectivité ont été détectés.%b\n" "${YELLOW}" "${BOLD}" "${NC}"
    printf "%b[?] Voulez-vous TOUT DE MÊME tenter la demande Let's Encrypt ? (y/N): %b" "${YELLOW}" "${NC}"
    read -r proceed_anyway
    if [[ ! "$proceed_anyway" =~ ^[yY]$ ]]; then
        echo -e "${RED}[ERROR] Annulation du processus.${NC}"
        exit 1
    fi
fi

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

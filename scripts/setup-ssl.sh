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

if [ ! -f "api-service/.env" ]; then
    echo -e "${RED}[ERROR] Le projet n'a pas encore été configuré.${NC}"
    echo -e "${YELLOW}Veuillez exécuter le script principal et choisir l'Option 1 (Installer / Reconfigurer) avan de configurer le SSL.${NC}"
    exit 1
fi

# 💠 SRE: Chargement de la config existante si disponible
if [ -f .env ]; then
    source .env
fi

if [ -z "$DOMAIN" ] && [ -z "$EMAIL" ]; then
    printf "%b[?] Voulez-vous configurer un nom de domaine et un certificat SSL valide ? (y/N): %b" "${YELLOW}" "${NC}"
    read -r wants_ssl

    if [[ ! "$wants_ssl" =~ ^[yY]$ ]]; then
        log "Configuration SSL ignorée."
        exit 0
    fi

    printf "%b[?] Entrez votre nom de domaine (ex: vpn.site.com): %b" "${YELLOW}" "${NC}"
    read -r DOMAIN

    if [ -z "$DOMAIN" ]; then
        echo -e "${RED}[ERROR] Le nom de domaine est obligatoire si vous souhaitez utiliser SSL.${NC}"
        exit 1
    fi

    printf "%b[?] Entrez votre adresse e-mail pour Let's Encrypt: %b" "${YELLOW}" "${NC}"
    read -r EMAIL

    if [ -z "$EMAIL" ]; then
        echo -e "${RED}[ERROR] L'adresse email est obligatoire pour le certificat SSL.${NC}"
        exit 1
    fi
fi

log "Vérification et ouverture des ports du pare-feu (UFW)..."
sudo ufw allow 80/tcp > /dev/null 2>&1 || true
sudo ufw allow 443/tcp > /dev/null 2>&1 || true
sudo ufw allow 443/udp > /dev/null 2>&1 || true # Pour QUIC/HTTP3
log "Pare-feu configuré pour Nginx et Let's Encrypt."

log "Démarrage complet de l'infrastructure pour le challenge ACME..."
# 💠 SRE: On lance tout pour garantir que Nginx peut résoudre les upstreams (API, AdGuard)
docker compose up -d

log "Attente de la stabilisation des services (10s)..."
sleep 10

# 💠 Vibe-OS v6.5 Pre-flight Diagnostic
chmod +x .vibe/tools/check-port80.sh
# Note: On essaie de détecter l'IP si elle n'est pas passée en env
DETECTED_IP=$(curl -4 -s ifconfig.me 2>/dev/null || echo "127.0.0.1")
if ! ./.vibe/tools/check-port80.sh "$DOMAIN" "$DETECTED_IP"; then
    printf "%b%b[WARNING] Le domaine n'est pas encore accessible sur le port 80.%b\n" "${YELLOW}" "${BOLD}" "${NC}"
    printf "%b[?] Voulez-vous générer un certificat AUTO-SIGNÉ de secours pour démarrer Nginx ? (y/N): %b" "${YELLOW}" "${NC}"
    read -r generate_fallback
    if [[ "$generate_fallback" =~ ^[yY]$ ]]; then
        log "Génération du certificat de secours (Self-Signed)..."
        docker run --rm -v "wg-fux_certbot_certs:/etc/letsencrypt" alpine sh -c \
            "apk add --no-cache openssl && mkdir -p /etc/letsencrypt/live/$DOMAIN && \
            openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout /etc/letsencrypt/live/$DOMAIN/privkey.pem \
            -out /etc/letsencrypt/live/$DOMAIN/fullchain.pem \
            -subj '/CN=$DOMAIN'" > /dev/null 2>&1
        log "Certificat de secours généré. Nginx peut démarrer, mais l'accès sera 'Non Sécurisé'."
    else
        log "Pas de certificat de secours. Let's Encrypt sera tenté, mais risque d'échouer."
    fi
fi

log "Demande de certificat pour $DOMAIN..."
docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
    --email "$EMAIL" --agree-tos --no-eff-email \
    -d "$DOMAIN"

log "Mise à jour de la configuration Nginx pour utiliser les nouveaux certificats..."
NGINX_CONF="infra/nginx/default.conf"

# Remplacement des chemins par défaut par les chemins Let's Encrypt
sed -i "s|ssl_certificate .*|ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;|g" "$NGINX_CONF"
sed -i "s|ssl_certificate_key .*|ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;|g" "$NGINX_CONF"

log "Redémarrage de Nginx avec SSL actif..."
docker compose restart nginx

log "SUCCESS! Votre dashboard est maintenant accessible sur https://$DOMAIN !"

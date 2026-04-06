#!/bin/bash
# SRE: Unification des utilitaires (Chemin dynamique)
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
COMMON_SH="$SCRIPT_DIR/../core-vpn/scripts/wg-common.sh"

if [ -f "$COMMON_SH" ]; then
    source "$COMMON_SH"
else
    # Fallback minimal si common est introuvable
    log_error() { echo -e "\033[0;31m[ERROR]\033[0m $1"; }
    log_info() { echo -e "\033[0;32m[INFO]\033[0m $1"; }
fi

if [ ! -f "docker-compose.yml" ]; then
    log_error "Script must be run from the WG-FUX root directory."
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

if [ -z "${DOMAIN:-}" ] && [ -z "${EMAIL:-}" ]; then
    printf "%b[?] Voulez-vous configurer un nom de domaine et un certificat SSL valide ? (y/N): %b" "${YELLOW}" "${NC}"
    read -r wants_ssl

    if [[ ! "$wants_ssl" =~ ^[yY]$ ]]; then
        log_info "Configuration SSL ignorée."
        exit 0
    fi

    printf "%b[?] Entrez votre nom de domaine (ex: vpn.site.com): %b" "${YELLOW}" "${NC}"
    read -r DOMAIN

    if [ -z "${DOMAIN:-}" ]; then
        echo -e "${RED}[ERROR] Le nom de domaine est obligatoire si vous souhaitez utiliser SSL.${NC}"
        exit 1
    fi

    printf "%b[?] Entrez votre adresse e-mail pour Let's Encrypt: %b" "${YELLOW}" "${NC}"
    read -r EMAIL

    if [ -z "${EMAIL:-}" ]; then
        echo -e "${RED}[ERROR] L'adresse email est obligatoire pour le certificat SSL.${NC}"
        exit 1
    fi
fi

log_info "Démarrage automatique d'une instance Nginx HTTP stable pour le challenge..."
# SRE: Création d'un certificat 'Bootstrap' si absent pour éviter le crash Nginx
if [ ! -f "infra/ssl/server.crt" ]; then
    log_info "Génération d'un certificat d'amorce (Bootstrap)..."
    mkdir -p infra/ssl
    openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
        -keyout infra/ssl/server.key \
        -out infra/ssl/server.crt \
        -subj "/CN=localhost" > /dev/null 2>&1
fi

docker compose up -d nginx

# 💠 Vibe-OS v6.5 Pre-flight Diagnostic
chmod +x .vibe/tools/check-port80.sh
# Note: On essaie de détecter l'IP si elle n'est pas passée en env
DETECTED_IP=$(curl -4 -s ifconfig.me 2>/dev/null || echo "127.0.0.1")
if ! ./.vibe/tools/check-port80.sh "${DOMAIN:-}" "$DETECTED_IP"; then
    log_error "Le diagnostic réseau a échoué. Port 80 inaccessible."
    log_warn "Assurez-vous que votre Pare-feu Cloud (DigitalOcean/Hetzner) autorise le port 80."
    exit 1
fi

log_info "Demande de certificat pour $DOMAIN..."
docker compose run --rm --entrypoint certbot certbot certonly --webroot -w /var/www/certbot \
    --email "${EMAIL:-}" --agree-tos --no-eff-email \
    -d "${DOMAIN:-}"

log_info "Mise à jour de la configuration Nginx pour utiliser les nouveaux certificats..."
NGINX_CONF="infra/nginx/default.conf"

# Remplacement des chemins par défaut par les chemins Let's Encrypt
sed -i "s|ssl_certificate .*|ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;|g" "$NGINX_CONF"
sed -i "s|ssl_certificate_key .*|ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;|g" "$NGINX_CONF"

log_info "Redémarrage de Nginx avec SSL actif..."
docker compose restart nginx

log_success "Votre dashboard est maintenant accessible sur https://${DOMAIN:-} !"

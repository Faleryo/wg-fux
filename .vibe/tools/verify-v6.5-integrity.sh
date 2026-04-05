#!/bin/bash
# 💠 Vibe-OS v6.5 : REVERSED VERIFICATION PROTOCOL (Obsidian Grade)
# Ce script valide l'intégrité de l'infrastructure WG-FUX.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}================================================================${NC}"
echo -e "  💠 VALIDATION D'INTÉGRITÉ VIBE-OS v6.5 (The Guardian) 💠    "
echo -e "${BLUE}================================================================${NC}"

# 1. BLAST RADIUS (Docker Limits)
echo -ne "[1/5] Vérification du Blast Radius (Resource Limits)... "
API_MEM=$(sudo docker inspect wg-fux-api --format '{{.HostConfig.Memory}}')
UI_MEM=$(sudo docker inspect wg-fux-dashboard --format '{{.HostConfig.Memory}}')

if [ "$API_MEM" -eq 536870912 ] && [ "$UI_MEM" -eq 1073741824 ]; then
    echo -e "${GREEN}PASS (API=512M, UI=1GB)${NC}"
else
    echo -e "${RED}FAIL (API=$((API_MEM/1024/1024))M, UI=$((UI_MEM/1024/1024))M)${NC}"
fi

# 2. SECURITY HEADERS (Nginx)
echo -ne "[2/5] Vérification des Headers de Sécurité (Nginx)... "
if grep -q "X-Frame-Options \"SAMEORIGIN\"" infra/nginx/default.conf && \
   grep -q "Content-Security-Policy" infra/nginx/default.conf; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL (Headers manquants)${NC}"
fi

# 3. SHADOW CODE DETECTION (Drift)
echo -ne "[3/5] Détection de Shadow Code (Hôte vs Conteneur)... "
TEMP_HOST_MD5=$(mktemp)
TEMP_CONT_MD5=$(mktemp)

# Calcul MD5 sur l'hôte (scripts core matching Dockerfile)
cd core-vpn/scripts/ && md5sum wg-*.sh 2>/dev/null | sort > "$TEMP_HOST_MD5" && cd ../..

# Calcul MD5 dans le conteneur API
sudo docker exec wg-fux-api bash -c "cd /usr/local/bin/ && md5sum wg-*.sh 2>/dev/null | sort" > "$TEMP_CONT_MD5"

DIFF_COUNT=$(diff -w "$TEMP_HOST_MD5" "$TEMP_CONT_MD5" | wc -l)
if [ "$DIFF_COUNT" -eq 0 ]; then
    echo -e "${GREEN}PASS (Sync OK)${NC}"
else
    echo -e "${YELLOW}WARNING (Drift détecté)${NC}"
    echo -e "    > [!] Les scripts dans le conteneur API sont désynchronisés avec l'hôte."
    echo -e "    > [!] Action requise : sudo docker compose up -d --build api"
fi
rm -f "$TEMP_HOST_MD5" "$TEMP_CONT_MD5"

# 4. SSL & DNS WHITELIST
echo -ne "[4/5] Vérification de la Whitelist DNS (AdGuard)... "
if grep -q "allow 10.0.0.0/24;" infra/nginx/default.conf; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL (Whitelist manquante)${NC}"
fi

# 5. SSL CERTIFICATE PRESENCE
echo -ne "[5/5] Présence des Certificats SSL... "
if [ -d "infra/ssl" ] || sudo docker volume inspect certbot_certs &>/dev/null; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL (Certs introuvables)${NC}"
fi

echo -e "${BLUE}================================================================${NC}"
echo -e "  MATHÉMATIQUE : INTÉGRITÉ VALIDÉE À 100% SI PAS DE FAIL/WARNING   "
echo -e "${BLUE}================================================================${NC}"

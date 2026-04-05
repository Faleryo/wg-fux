#!/bin/bash
# ============================================================
# WG-FUX Port 80 & DNS Diagnostic Tool (v6.5)
# Used to verify environment before Let's Encrypt challenge.
# ============================================================

DOMAIN=$1
PUBLIC_IP=$2

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}[DIAGNOSTIC] Lancement des vérifications pré-vol Let's Encrypt (v6.5)...${NC}"

# 1. Vérification locale (Nginx écoute ?)
if ss -tuln | grep -q ":80 "; then
    echo -e "${GREEN}[OK] Un service écoute sur le port 80 localement.${NC}"
else
    echo -e "${RED}[ERROR] Aucun service n'écoute sur le port 80.${NC}"
    echo -e "${YELLOW}[TIP] Assurez-vous que le conteneur Nginx est démarré.${NC}"
    exit 1
fi

# 2. Vérification DNS (Si domaine fourni)
if [ -n "$DOMAIN" ]; then
    # Try to get IP using dig or host
    if command -v dig &>/dev/null; then
        RESOLVED_IP=$(dig +short "$DOMAIN" --time=2 --tries=1 | tail -n1)
    fi
    if [ -z "$RESOLVED_IP" ]; then
        RESOLVED_IP=$(host "$DOMAIN" 2>/dev/null | awk '/has address/ { print $4 }' | head -n1)
    fi

    if [ -z "$RESOLVED_IP" ]; then
        echo -e "${RED}[ERROR] Impossible de résoudre le domaine $DOMAIN.${NC}"
        exit 1
    fi
    
    if [ "$RESOLVED_IP" != "$PUBLIC_IP" ]; then
        echo -e "${YELLOW}[WARNING] Le domaine $DOMAIN pointe vers $RESOLVED_IP (Attendu: $PUBLIC_IP).${NC}"
        echo -e "${YELLOW}[TIP] Vérifiez vos enregistrements DNS A et la propagation.${NC}"
    else
        echo -e "${GREEN}[OK] Le DNS pointe correctement vers $PUBLIC_IP.${NC}"
    fi
    
    # Check AAAA record
    if command -v dig &>/dev/null; then
        AAAA_RECORD=$(dig +short AAAA "$DOMAIN" --time=2 --tries=1)
    fi
    if [ -n "$AAAA_RECORD" ]; then
        echo -e "${YELLOW}[WARNING] Enregistrement IPv6 (AAAA) détecté pour $DOMAIN.${NC}"
        echo -e "${YELLOW}[TIP] Let's Encrypt privilégie l'IPv6. S'il n'est pas configuré sur le VPS, le challenge échouera.${NC}"
    fi
fi

# 3. Vérification Connectivité Externe (Self-ping via IP publique)
echo -e "${CYAN}[INFO] Test de connectivité HTTP sur $PUBLIC_IP...${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://$PUBLIC_IP/" || echo "000")

if [ "$HTTP_CODE" == "200" ] || [ "$HTTP_CODE" == "301" ] || [ "$HTTP_CODE" == "302" ] || [ "$HTTP_CODE" == "404" ]; then
    echo -e "${GREEN}[OK] Le serveur est accessible sur le port 80 via IP publique ($HTTP_CODE).${NC}"
else
     echo -e "${RED}[ERROR] Impossible de joindre le serveur sur le port 80 via son IP publique ($PUBLIC_IP).${NC}"
     echo -e "${YELLOW}[REASON] Cela peut être dû à un pare-feu Cloud (AWS/GCP/Hetzner) ou à l'absence de NAT Loopback.${NC}"
     echo -e "${YELLOW}[ACTION] Assurez-vous que le port 80 est ouvert dans la console de votre fournisseur.${NC}"
     exit 1
fi

exit 0

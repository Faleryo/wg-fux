#!/bin/bash
# 💠 Vibe-OS v6.5 : THE GUARDIAN (Unified SRE Oracle)
# Description: Validation totale (Statique + Runtime + Sec) de l'infrastructure WG-FUX.
# Devise: "L'intuition ne vaut rien sans la preuve mathématique du terminal."

set -euo pipefail

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

LOG_FILE=".vibe/logs/guardian.log"
mkdir -p "$(dirname "$LOG_FILE")"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; echo "[$(date -Is)] [INFO] $1" >> "$LOG_FILE"; }
log_ok() { echo -e "${GREEN}[PASS]${NC} $1"; echo "[$(date -Is)] [PASS] $1" >> "$LOG_FILE"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; echo "[$(date -Is)] [WARN] $1" >> "$LOG_FILE"; }
log_err() { echo -e "${RED}[FAIL]${NC} $1"; echo "[$(date -Is)] [FAIL] $1" >> "$LOG_FILE"; }

echo -e "${CYAN}================================================================${NC}"
echo -e "${CYAN}  💠 VIBE-OS v6.5 : THE GUARDIAN - TOTAL SYSTEM PROOF 💠        ${NC}"
echo -e "${CYAN}================================================================${NC}"

EXIT_CODE=0

# --- 1. SYSTEM CONTEXT ---
echo -e "\n${BLUE}[1/5] CONTEXTE & IDENTITÉ${NC}"
if [ -f "VIBE-OS.md" ]; then
    VERSION=$(grep -m 1 "v6.5" VIBE-OS.md | cut -d ' ' -f 2)
    log_ok "Protocole : ${VERSION:-v6.5} [OBSIDIAN]"
else
    log_err "VIBE-OS.md introuvable."
    EXIT_CODE=1
fi

# --- 2. BLAST RADIUS (RUNTIME VS CONFIG) ---
echo -e "\n${BLUE}[2/5] SRE BLAST RADIUS (LIMITES DE RESSOURCES)${NC}"

check_limit() {
    local container=$1
    local expected_mem=$2
    local actual_mem
    actual_mem=$(sudo docker inspect "$container" --format '{{.HostConfig.Memory}}' 2>/dev/null || echo "0")
    
    if [ "$actual_mem" -eq "$expected_mem" ]; then
        log_ok "Container $container : Mémoire OK ($((expected_mem/1024/1024))M)"
    else
        log_err "Container $container : Mémoire DRIFT ! Requis: $((expected_mem/1024/1024))M, Actuel: $((actual_mem/1024/1024))M"
        EXIT_CODE=1
    fi
}

if sudo docker ps --format '{{.Names}}' | grep -q "wg-fux-api"; then
    check_limit "wg-fux-api" 536870912
    check_limit "wg-fux-dashboard" 1073741824
else
    log_err "Containers non détectés. Le système est-il lancé ?"
    EXIT_CODE=1
fi

# --- 3. SHADOW CODE DETECTION (SYNC) ---
echo -e "\n${BLUE}[3/5] INTÉGRITÉ DU CODE (SYNC HÔTE/CONTENEUR)${NC}"
if [ -d "core-vpn/scripts" ]; then
    TEMP_HOST=$(mktemp)
    TEMP_CONT=$(mktemp)
    
    (cd core-vpn/scripts/ && md5sum wg-*.sh 2>/dev/null | sort > "$TEMP_HOST")
    docker exec wg-fux-api bash -c "cd /usr/local/bin/ && md5sum wg-*.sh 2>/dev/null | sort" > "$TEMP_CONT" 2>/dev/null || true
    
    if diff -w "$TEMP_HOST" "$TEMP_CONT" > /dev/null; then
        log_ok "Synchronisation des scripts : OK"
    else
        log_warn "Shadow Code détecté ! Les scripts en prod diffèrent de l'hôte."
        log_info "Action : sudo docker compose up -d --build api"
        # On ne met pas EXIT_CODE=1 car c'est un warning, mais on signale.
    fi
    rm -f "$TEMP_HOST" "$TEMP_CONT"
else
    log_err "Répertoire core-vpn/scripts introuvable."
    EXIT_CODE=1
fi

# --- 4. SÉCURITÉ RÉSEAU & NGINX ---
echo -e "\n${BLUE}[4/5] SÉCURITÉ PÉRIMÉTRIQUE (NGINX/DNS)${NC}"
NGINX_CONF="infra/nginx/default.conf"
if [ -f "$NGINX_CONF" ]; then
    if grep -q "X-Frame-Options \"SAMEORIGIN\"" "$NGINX_CONF" && \
       grep -q "Content-Security-Policy" "$NGINX_CONF"; then
        log_ok "Headers de sécurité : OK"
    else
        log_err "Headers de sécurité manquants dans Nginx."
        EXIT_CODE=1
    fi
    
    if grep -q "allow 10.0.0.0/24;" "$NGINX_CONF"; then
        log_ok "Whitelist VPN : OK"
    else
        log_warn "Whitelist VPN non détectée ou non conforme."
    fi
else
    log_err "Configuration Nginx introuvable."
    EXIT_CODE=1
fi

# --- 5. DISPONIBILITÉ DES SERVICES ---
echo -e "\n${BLUE}[5/5] ÉTAT DE SANTÉ RUNTIME${NC}"
docker compose ps --format "table {{.Name}}\t{{.Status}}" | grep -E "api|ui|nginx|dns" | while read -r line; do
    if [[ $line == *"healthy"* ]] || [[ $line == *"Up"* ]]; then
        log_ok "$line"
    else
        log_err "$line"
        EXIT_CODE=1
    fi
done

echo -e "\n${CYAN}================================================================${NC}"
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}  PREUVE ÉTABLIE : LE SYSTÈME EST MATHÉMATIQUEMENT SAIN (0).    ${NC}"
else
    echo -e "${RED}  ÉCHEC DE LA PREUVE : DES RÉGRESSIONS ONT ÉTÉ DÉTECTÉES ($EXIT_CODE).${NC}"
fi
echo -e "${CYAN}================================================================${NC}"

exit $EXIT_CODE

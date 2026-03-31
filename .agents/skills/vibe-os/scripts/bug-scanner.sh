#!/bin/bash

# ==============================================================================
# 🌌 Vibe-OS : SENTINEL (Evolution of Bug-Scanner)
# "L'intuition ne vaut rien sans la preuve du terminal."
# ==============================================================================

# --- [ Configuration & Couleurs ] ---
BLUE='\033[0;34m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

# --- [ Secrets / Alerting ] ---
# Ces variables devraient être définies dans l'env Docker ou le shell hôte
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

send_notification() {
    local message="$1"
    echo -e "${YELLOW}[SENTINEL] Sending notification...${NC}"
    if [[ -n "$TELEGRAM_BOT_TOKEN" && -n "$TELEGRAM_CHAT_ID" ]]; then
        curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d "chat_id=${TELEGRAM_CHAT_ID}" \
            -d "text=🛡️ SENTINEL ALERT: $message" > /dev/null
    else
        echo -e "${RED}[WARN] Telegram alerting not configured.${NC}"
    fi
}

# --- [ Fonction d'Audit Principal ] ---
run_audit() {
    local daemon_mode="$1"
    
    echo -e "\n${BLUE}${BOLD}🌀 OVPN-NEXUS | SENTINEL AUDIT PROTOCOL v3.0${NC}"
    echo -e "${CYAN}Digital Signature: Liquid Glass Infrastructure${NC}"
    echo -e "--------------------------------------------------"

    # --- [ Module 1: Docker Containers ] ---
    echo -e "${YELLOW}🔍 [1/6] AUDIT DOCKER ECOSYSTEM...${NC}"
    SERVICES=("wg-fux-api" "wg-fux-dashboard")
    for svc in "${SERVICES[@]}"; do
        if docker ps --format '{{.Names}}' | grep -q "$svc"; then
            echo -e "  [${GREEN}OK${NC}] Service $svc is active."
        else
            echo -e "  [${RED}!!${NC}] Service $svc is DOWN !"
            [[ "$daemon_mode" == "true" ]] && send_notification "Service $svc est tombé !"
        fi
    done

    # --- [ Module 2: API Connectivity ] ---
    echo -e "\n${YELLOW}🔍 [2/6] ANALYSE CONNECTIVITÉ API (Port 3000)...${NC}"
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 2 http://localhost:3000/api/install/status)
    if [ "$HTTP_CODE" == "200" ]; then
        echo -e "  [${GREEN}OK${NC}] API Express répond (HTTP 200)."
    else
        echo -e "  [${RED}KO${NC}] API non joignable (HTTP $HTTP_CODE)."
        [[ "$daemon_mode" == "true" ]] && send_notification "L'API de gestion VPN ne répond plus (HTTP $HTTP_CODE)."
    fi

    # --- [ Module 3: Data Integrity (SQLite) ] ---
    echo -e "\n${YELLOW}🔍 [3/6] AUDIT INTÉGRITÉ BDD (Drizzle/SQLite)...${NC}"
    DB_FILE="./api-service/data/wg-fux.db"
    if [ -f "$DB_FILE" ]; then
        if command -v sqlite3 &> /dev/null; then
            PRAGMA=$(sqlite3 "$DB_FILE" "PRAGMA integrity_check;")
            if [ "$PRAGMA" == "ok" ]; then
                echo -e "  [${GREEN}OK${NC}] SQLite Integrity Check : OK."
            else
                echo -e "  [${RED}ERR${NC}] SQLite Corrompu : $PRAGMA"
                [[ "$daemon_mode" == "true" ]] && send_notification "Corruption détectée sur la BDD SQLite !"
            fi
        fi
    else
        echo -e "  [${RED}!!${NC}] Base de données introuvable !"
    fi

    # --- [ Module 4: Core Scripts ] ---
    echo -e "\n${YELLOW}🔍 [4/6] AUDIT BASH CORE (Permissions & Syntax)...${NC}"
    SCRIPT_DIR="./core-vpn/scripts"
    for script in "$SCRIPT_DIR"/*.sh; do
        if [ ! -f "$script" ]; then continue; fi
        if [ -x "$script" ]; then
            bash -n "$script" 2>/dev/null || echo -e "  [${RED}ERR${NC}] $(basename "$script") : Erreur de syntaxe Shell !"
        else
            echo -e "  [${YELLOW}!!${NC}] $(basename "$script") : Permission d'exécution manquante."
        fi
    done

    # --- [ Module 5: System Metrics ] ---
    echo -e "\n${YELLOW}🔍 [5/6] MONITORING CHARGE SYSTÈME...${NC}"
    LOAD=$(cat /proc/loadavg | awk '{print $1}')
    MEM_FREE=$(free -m | grep "Mem:" | awk '{print $4}')
    echo -e "  [INFO] Load Avg: $LOAD | Mem Free: ${MEM_FREE}MB"
    
    if (( $(echo "$LOAD > 5.0" | bc -l) )); then
        echo -e "  [${RED}CRIT${NC}] CPU Overload !"
        [[ "$daemon_mode" == "true" ]] && send_notification "Surcharge CPU détectée (Charge: $LOAD)."
    fi

    # --- [ Module 6: WireGuard Status ] ---
    echo -e "\n${YELLOW}🔍 [6/6] STATUT INTERFACE WIREGUARD...${NC}"
    WG_INTERFACE="${WG_INTERFACE:-wg0}"
    if ip link show "$WG_INTERFACE" &> /dev/null; then
        echo -e "  [${GREEN}OK${NC}] Interface $WG_INTERFACE est Active."
    else
        echo -e "  [${RED}!!${NC}] Interface $WG_INTERFACE est Down !"
        [[ "$daemon_mode" == "true" ]] && send_notification "L'interface WireGuard $WG_INTERFACE est inaccessible !"
    fi

    echo -e "\n--------------------------------------------------"
    echo -e "${BLUE}${BOLD}✨ AUDIT TERMINÉ.${NC}\n"
}

# --- [ Execution Mode ] ---
if [[ "$1" == "--daemon" ]]; then
    echo -e "${GREEN}🚀 Mode SENTINEL DAEMON Activé (Check toutes les 60s)${NC}"
    while true; do
        run_audit "true" > /dev/null # Silencieux en daemon, logs via notification
        sleep 60
    done
else
    run_audit "false"
fi

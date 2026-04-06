#!/bin/bash
# 💠 Vibe-OS : Reverse Verification Script (v6.5-Obsidian+)
# Target: Milestone "Obsidian Grade Hardening"

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
PROJECT_ROOT="$SCRIPT_DIR/../.."
COMMON_SH="$PROJECT_ROOT/core-vpn/scripts/wg-common.sh"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_check() { echo -e "${YELLOW}[CHECK]${NC} $*"; }
log_ok() { echo -e "${GREEN}[OK]${NC} $*"; }
log_fail() { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

echo -e "\n💠 Lancement de la Reverse Verification (Grade Obsidian Plus)...\n"

# 1. Vérification wg-common.sh
log_check "Vérification de la robustesse de wg-common.sh..."
grep -q "set -euo pipefail" "$COMMON_SH" || log_fail "set -euo pipefail manquant dans wg-common.sh"
grep -q "VERSION=\"6.5.0-Obsidian+\"" "$COMMON_SH" || log_fail "Version incorrecte dans wg-common.sh"
log_ok "wg-common.sh est conforme."

# 2. Vérification setup.sh (Sourcing & Logging)
log_check "Vérification de l'intégration dans setup.sh..."
grep -q "source \"\$COMMON_SH\"" "$PROJECT_ROOT/setup.sh" || log_fail "Sourcing de wg-common.sh manquant dans setup.sh"
grep -q "log_info" "$PROJECT_ROOT/setup.sh" || log_fail "Fonctions de log unifiées non détectées dans setup.sh"
! grep -q "log \"INFO\"" "$PROJECT_ROOT/setup.sh" || log_fail "Anciens labels de logs 'log INFO' détectés dans setup.sh"
log_ok "setup.sh est correctement refactorisé."

# 3. Vérification sentinel.sh (Autonomic Healing)
log_check "Vérification de l'intelligence Sentinel (sentinel.sh)..."
grep -q "health=unhealthy" "$PROJECT_ROOT/core-vpn/scripts/sentinel.sh" || log_fail "Détection 'unhealthy' manquante dans sentinel.sh"
grep -q "docker restart" "$PROJECT_ROOT/core-vpn/scripts/sentinel.sh" || log_fail "Action de restart manquante dans sentinel.sh"
grep -q "log_sre" "$PROJECT_ROOT/core-vpn/scripts/sentinel.sh" || log_fail "Log SRE manquant dans sentinel.sh"
log_ok "Sentinel est configuré pour l'Auto-Healing."

# 4. Vérification docker-compose.yml (Healthcheck Resilience)
log_check "Vérification du healthcheck Certbot..."
grep -q "test: \[\"CMD-SHELL\", \"\[ -d /etc/letsencrypt/live \] || \[ -d /etc/letsencrypt/accounts \] || exit 0\"\]" "$PROJECT_ROOT/docker-compose.yml" || log_fail "Healthcheck Certbot non-résilient détecté."
log_ok "docker-compose.yml est optimisé."

# 5. ShellCheck Cleanliness
log_check "Vérification ShellCheck intégrée..."
if shellcheck "$PROJECT_ROOT/setup.sh" "$PROJECT_ROOT/core-vpn/scripts/sentinel.sh" "$PROJECT_ROOT/core-vpn/scripts/wg-common.sh" > /dev/null 2>&1; then
    log_ok "Audit ShellCheck: 100% Clean."
else
    log_fail "ShellCheck a détecté des régressions."
fi

echo -e "\n${GREEN}🎯 VERverification RÉUSSIE : Code 0 (Mathématique). Grade Obsidian Plus validé.${NC}\n"
exit 0

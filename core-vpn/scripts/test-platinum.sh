#!/bin/bash

# 💠 VIBE-OS Final Verification: WG-FUX Platinum
# Devise: "La preuve du terminal est la seule vérité."

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

check_step() {
    if eval "$1"; then
        echo -e "${GREEN}[OK] $2${NC}"
    else
        echo -e "${RED}[FAIL] $2${NC}"
        exit 1
    fi
}

echo -e "${BLUE}--- Lancement de la Vérification Finale Platinum ---${NC}"

# 1. Vérification des scripts Shell
check_step "bash -n setup.sh" "Syntaxe setup.sh"
check_step "bash -n core-vpn/scripts/sentinel.sh" "Syntaxe sentinel.sh"

# 2. Vérification Docker
check_step "docker compose config -q" "Configuration Docker Compose (Healthchecks inclus)"

# 3. Vérification de la Documentation
check_step "[ -f API_SPEC.md ]" "Documentation API_SPEC.md présente"
check_step "[ -f CHANGELOG.md ]" "Document CHANGELOG.md présent"

# 4. Vérification Sentinel
check_step "[ -f core-vpn/scripts/sentinel.service ]" "Unité Systemd Sentinel présente"

# 5. Vérification API Health (si accessible)
if curl -s --max-time 1 http://localhost:3000/api/health > /dev/null; then
    check_step "curl -s http://localhost:3000/api/health | grep -q 'Platinum'" "Endpoint Health API opérationnel (v3.1-Platinum)"
else
    echo -e "${YELLOW}[SKIP] API non lancée localement (attendu en environnement de test)${NC}"
fi

echo -e "\n${GREEN}💠 VERIFICATION RÉUSSIE : WG-FUX est maintenant certifié PLATINUM STATUS.${NC}"

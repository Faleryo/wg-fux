#!/bin/bash

# Vibe-OS v6.3 "The Watcher's Eye"
# Tool: Reversed Verification (Zero-Regression Watcher)

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}--- [WATCHER'S EYE] : Verification Task Loop ---${NC}"

# 1. API - Check Lint
if [ -d "api-service" ]; then
    echo -e "[CHECK] : API Service Integrity"
    cd api-service
    npm run lint || (echo -e "${RED}[FAIL] : Linting errors found in api-service${NC}" && exit 1)
    node --check server.js
    cd ..
fi

# 2. VPN - Check Scripts Syntax
if [ -d "core-vpn" ]; then
    echo -e "[CHECK] : VPN Bash Scripts Syntax"
    for f in core-vpn/scripts/*.sh; do
        bash -n "$f" || (echo -e "${RED}[FAIL] : Syntax error in $f${NC}" && exit 1)
    done
fi

# 3. Environment - Check Configuration
if [ ! -f "api-service/.env.example" ]; then
    echo -e "${RED}[FAIL] : Missing .env.example in api-service${NC}"
    exit 1
fi

echo -e "${GREEN}--- [VERIFICATION SUCCESS] : Platinum Status Maintained ---${NC}"
exit 0

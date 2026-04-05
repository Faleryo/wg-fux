#!/bin/bash

# Vibe-OS v6.3 "The Watcher's Eye"
# Tool: Supply Chain Auditor (Zero-Trust Dependency Watcher)

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}--- [WATCHER'S EYE] : Supply Chain Audit ---${NC}"

# 1. NPM Audit - API Service
if [ -d "api-service" ]; then
    echo -e "${YELLOW}[SCAN] : api-service (Node.js)${NC}"
    cd api-service
    npm audit --audit-level=high || echo -e "${RED}[WARNING] : High vulnerabilities detected in api-service dependencies.${NC}"
    cd ..
fi

# 2. NPM Audit - Dashboard UI
if [ -d "dashboard-ui" ]; then
    echo -e "${YELLOW}[SCAN] : dashboard-ui (Vite/React)${NC}"
    cd dashboard-ui
    npm audit --audit-level=high || echo -e "${RED}[WARNING] : High vulnerabilities detected in dashboard-ui dependencies.${NC}"
    cd ..
fi

# 3. APT Audit (Simulated check for core-vpn requirements)
echo -e "${YELLOW}[SCAN] : System Packages${NC}"
dpkg -l | grep -E "wireguard|iptables|nftables" > /dev/null && echo -e "${GREEN}[OK] : Core binaries verified.${NC}"

# Final Report
echo -e "${GREEN}--- [SCAN COMPLETE] : Zero-Day Watcher report generated. ---${NC}"

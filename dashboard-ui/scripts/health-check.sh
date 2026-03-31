#!/bin/sh
# Sentinel health check for Nginx/Vite build
URL="http://localhost:80"
EXPECTED_STATUS="200"

echo "[SENTINEL] Vérification de la santé du Dashboard UI..."

# Check if responding with 200
STATUS=$(curl -o /dev/null -s -w "%{http_code}" $URL)

if [ "$STATUS" = "$EXPECTED_STATUS" ]; then
    echo "[OK] Dashboard UI opérationnel (Status 200)."
    exit 0
else
    echo "[CRITICAL] Dashboard UI injoignable ou erreur (Status $STATUS)."
    exit 1
fi

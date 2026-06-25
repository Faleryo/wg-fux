#!/bin/bash

# (Autonomous Debugging)
# Tool: Auth Verifier (verify-auth.sh)

API_URL="${API_URL:-http://localhost:3000/api/auth/login}"
USERNAME="${TEST_USERNAME:-admin}"
PASSWORD="${TEST_PASSWORD:-admin123}"
JSON_DATA="{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}"

echo "Testing login for user 'admin'..."
RESPONSE=$(curl -s -X POST "$API_URL" \
 -H "Content-Type: application/json" \
 -d "$JSON_DATA")

echo "Response: $RESPONSE"

if echo "$RESPONSE" | grep -q '"valid":true'; then
 echo "✅ SUCCESS: Authentication is operational."
 TOKEN=$(echo "$RESPONSE" | sed -E 's/.*"token":"([^"]+)".*/\1/')

 echo "Testing Protected Route (/api/health)..."
 HEALTH=$(curl -s -H "x-api-token: $TOKEN" http://localhost:3000/api/health)
 echo "Health: $HEALTH"

 if echo "$HEALTH" | grep -q '"status":"healthy"'; then
 echo "✅ SUCCESS: Authorization works."
 exit 0
 fi
fi

echo "❌ FAIL: Authentication/Authorization check failed."
exit 1

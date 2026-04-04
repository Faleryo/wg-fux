#!/bin/bash

# Vibe-OS v6.3 "Watcher's Eye"
# SRE Verification: Client Patching Stability

# Login to get token
echo "Logging in to get auth token..."
TOKEN_RESP=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}')

echo "Raw Response: $TOKEN_RESP"
TOKEN=$(echo "$TOKEN_RESP" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
echo "Extracted Token: $TOKEN"

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed."
  exit 1
fi

echo "✅ Auth successful."

# Test PATCH on hh/hh-01
echo "Testing PATCH /api/clients/hh/hh-01 (quota=999)..."
PATCH_RESP=$(curl -s -X PATCH http://localhost:3000/api/clients/hh/hh-01 \
  -H "x-api-token: $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"quota": 999}')

echo "Response: $PATCH_RESP"

if echo "$PATCH_RESP" | grep -q '"success":true'; then
  echo "✅ SUCCESS: Client patching is stable (No 500 error)."
  
  # Final verification of file existence on host
  if [ -f "/etc/wireguard/clients/hh/hh-01/quota" ]; then
    echo "✅ SUCCESS: Quota file written to disk."
    cat /etc/wireguard/clients/hh/hh-01/quota
    exit 0
  fi
fi

echo "❌ FAIL: Client patching failed."
exit 1

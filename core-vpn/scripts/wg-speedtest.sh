#!/bin/bash
# --- VIBE-OS : Speedtest Script ---
# Ce script est requis par /api/system/speedtest
# BUG-FIX: Script manquant → toutes les requêtes speedtest retournaient 500

SCRIPT_DIR="$(dirname "$0")"

# Détection des outils disponibles
SPEEDTEST_BIN=""
if command -v speedtest-cli &>/dev/null; then
    SPEEDTEST_BIN="speedtest-cli"
elif command -v speedtest &>/dev/null; then
    SPEEDTEST_BIN="speedtest"
fi

if [ -z "$SPEEDTEST_BIN" ]; then
    # Fallback: test de latence basique vers 1.1.1.1
    LATENCY=$(ping -c 4 1.1.1.1 2>/dev/null | tail -1 | awk -F'/' '{print $5}' || echo "0")
    printf '{"available": false, "error": "speedtest-cli not installed", "latency_ms": %s, "note": "Install speedtest-cli for full results"}' "${LATENCY:-0}"
    exit 0
fi

# Exécution du test avec sortie JSON
if [ "$SPEEDTEST_BIN" = "speedtest-cli" ]; then
    RESULT=$($SPEEDTEST_BIN --json 2>/dev/null)
    if [ $? -eq 0 ] && [ -n "$RESULT" ]; then
        # Reformater pour correspondre au format attendu par le dashboard
        echo "$RESULT" | awk '
        BEGIN { FS=","; }
        {
            # Pass through the JSON as-is from speedtest-cli --json
            print $0
        }'
        exit 0
    fi
else
    # speedtest CLI (Ookla)
    RESULT=$($SPEEDTEST_BIN --format=json 2>/dev/null)
    if [ $? -eq 0 ] && [ -n "$RESULT" ]; then
        echo "$RESULT"
        exit 0
    fi
fi

# Fallback avec curl vers un endpoint de mesure
START=$(date +%s%3N)
BYTES=$(curl -s --max-time 15 -o /dev/null -w "%{size_download}" "https://speed.cloudflare.com/__down?bytes=10000000" 2>/dev/null || echo "0")
END=$(date +%s%3N)
DIFF=$(( END - START ))

if [ "$DIFF" -gt 0 ] && [ "$BYTES" -gt 0 ]; then
    # Calcul en Mbps
    MBPS=$(echo "scale=2; $BYTES * 8 / $DIFF / 1000" | bc 2>/dev/null || echo "0")
    LATENCY=$(ping -c 3 1.1.1.1 2>/dev/null | tail -1 | awk -F'/' '{print $5}' || echo "0")
    printf '{"available": true, "source": "cloudflare-fallback", "download": {"bandwidth": %s}, "ping": {"latency": %s}, "bytes_transferred": %s}' \
        "${MBPS:-0}" "${LATENCY:-0}" "$BYTES"
else
    printf '{"available": false, "error": "All speedtest methods failed"}'
    exit 1
fi

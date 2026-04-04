#!/bin/bash
#!/bin/bash
# --- VIBE-OS v6.2 : Speedtest Script (Resilient Version) ---
# GHOST-SCAN FIX v6.2: Removed duplicate log() function (now uses log_info from wg-common.sh).
SCRIPT_DIR="$(dirname "$(readlink -f "$0")")" 

source "$SCRIPT_DIR/wg-common.sh"

INTERFACE="${WG_INTERFACE:-wg0}"
LOG_FILE="/var/log/wg-speedtest.log"

# 1. Mesure de latence (toujours effectuée comme base)
log_info "Starting basic latency test..."
LATENCY=$(ping -c 4 -W 2 1.1.1.1 2>/dev/null | tail -1 | awk -F'/' '{print $5}' || echo "0")
if [ -z "$LATENCY" ]; then LATENCY="0"; fi

# 2. Test de débit (speedtest-cli)
log_info "Detecting speedtest-cli..."
SPEEDTEST_BIN=$(command -v speedtest-cli || command -v speedtest || echo "")

if [ -n "$SPEEDTEST_BIN" ]; then
    log_info "Running full speedtest via $SPEEDTEST_BIN (timeout 25s)..."
    # On limite le temps d'exécution pour ne pas bloquer l'API
    RESULT=$(timeout 25s "$SPEEDTEST_BIN" --json 2>/dev/null || echo "")
    
    if [ -n "$RESULT" ]; then
        log_info "Full speedtest successful."
        echo "$RESULT"
        exit 0
    fi
    log_warn "Full speedtest failed or timed out."
fi

# 3. Fallback : Mesure via curl (Cloudflare) si speedtest-cli échoue
log_info "Running fallback bandwidth test via curl (timeout 10s)..."
START=$(date +%s%3N)
# Téléchargement d'un petit fichier (1MB) pour une estimation rapide
BYTES=$(timeout 10s curl -s -o /dev/null -w "%{size_download}" "https://speed.cloudflare.com/__down?bytes=1000000" 2>/dev/null || echo "0")
END=$(date +%s%3N)
DIFF=$(( END - START ))

if [ "$DIFF" -gt 0 ] && [ "$BYTES" -gt 0 ]; then
    # Mbps = (bytes * 8) / (ms * 1000)
    MBPS=$(echo "scale=2; ($BYTES * 8) / ($DIFF * 1000)" | bc 2>/dev/null || echo "0")
    # Normalize to Bits for UI consistency
    BITS=$(safe_math "$MBPS * 1000000")
    log_info "Fallback estimate: ${MBPS} Mbps (${BITS} bits/s)"
    printf '{"available": true, "source": "fallback", "download": %s, "upload": 0.0, "ping": %s, "bytes": %s}\n' "$BITS" "$LATENCY" "$BYTES"
else
    log_warn "All bandwidth tests failed. Returning latency only."
    printf '{"available": false, "source": "none", "download": 0.0, "upload": 0.0, "ping": %s, "error": "test_failed"}\n' "$LATENCY"
fi

exit 0

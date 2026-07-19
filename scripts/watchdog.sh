#!/bin/bash

# WG-FUX v6.3 "The Watcher's Eye"
# SRE Brick: Self-Healing Watchdog (Blast-Radius Protected)

CHECK_INTERVAL=60
API_URL="http://localhost:3000/api/health"
ADGUARD_URL="http://localhost:3002"
SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_FILE="${WATCHDOG_LOG_FILE:-$PROJECT_ROOT/logs/watchdog.log}"
# PID dans un répertoire NON-world-writable pour empêcher une attaque par lien
# symbolique (/tmp était prévisible ET écrivable par tout utilisateur : un local
# non privilégié pouvait y planter un symlink vers un fichier root arbitraire
# qu'un `echo $$ >` root aurait alors écrasé). /run/wg-fux est root-only (0700) ;
# repli sous logs/ (dans l'arbre d'install root) si /run est indisponible.
if mkdir -p /run/wg-fux 2>/dev/null && chmod 700 /run/wg-fux 2>/dev/null; then
 PID_DIR="/run/wg-fux"
else
 PID_DIR="$PROJECT_ROOT/logs"
fi
PID_FILE="$PID_DIR/watchdog.pid"
DOCKER_COMPOSE_CMD="docker compose -f $PROJECT_ROOT/docker-compose.yml"

mkdir -p "$(dirname "$LOG_FILE")"

log_event() {
 echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [WATCHDOG] $1" | tee -a "$LOG_FILE"
}

# PID Protection: Ensure only one instance runs
if [ -f "$PID_FILE" ]; then
 PID=$(cat "$PID_FILE")
 if ps -p "$PID" > /dev/null; then
 log_event "⚠️ Watchdog already running with PID $PID. Exiting."
 exit 1
 fi
fi
echo $$ > "$PID_FILE"

log_event "🚀 Watcher Started (PID: $$)"

check_api() {
 # Verify both connectivity AND SRE health check (scripts availability)
 if ! HEALTH_RESP=$(curl -sf --max-time 10 "$API_URL"); then
 log_event "⚠️ WARNING: API connection failed. Restarting..."
 cd "$PROJECT_ROOT" && docker compose restart api
 else
 STATUS=$(echo "$HEALTH_RESP" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
 if [ "$STATUS" != "healthy" ]; then
  log_event "🚨 CRITICAL: API is $STATUS (Script integrity failure). Investigating..."
  # For now, just restart to attempt recovery
  cd "$PROJECT_ROOT" && docker compose restart api
 fi
 fi
}

check_adguard() {
 if ! curl -sf --max-time 10 "$ADGUARD_URL" > /dev/null; then
  log_event "⚠️ WARNING: AdGuard UI is unresponsive. Restarting..."
  cd "$PROJECT_ROOT" && docker compose restart adguard
 fi
}

trap 'rm -f "$PID_FILE"; log_event "🛑 Watchdog stopped."; exit' SIGINT SIGTERM

while true; do
 check_api
 check_adguard
 sleep "$CHECK_INTERVAL"
done

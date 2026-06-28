#!/bin/bash
# --- : Sentinel Watchdog v6.2 (SRE) ---
# NOTE: Pas de set -euo pipefail — ce watchdog doit survivre aux erreurs transitoires.

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
# shellcheck disable=SC1091
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

# Sentinel Token - Shared secret between this watchdog and the API
# SRE: Load from local env file if present (managed by setup.sh)
if [ -f "$SCRIPT_DIR/sentinel.env" ]; then
 # shellcheck disable=SC1091
 source "$SCRIPT_DIR/sentinel.env"
fi
TOKEN="${SENTINEL_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  log_error "[Sentinel] SENTINEL_TOKEN is not set. Cannot authenticate with API. Exiting."
  exit 1
fi
API_BASE="${SENTINEL_API_BASE:-http://127.0.0.1:3000}"
HEARTBEAT_URL="$API_BASE/api/sentinel/heartbeat"
HEALTH_URL="$API_BASE/api/health"

# Restart back-off: cap restarts per container to MAX_RESTARTS_WINDOW per
# RESTART_WINDOW_SECONDS to prevent restart storms.
MAX_RESTARTS_WINDOW="${MAX_RESTARTS_WINDOW:-5}"
RESTART_WINDOW_SECONDS="${RESTART_WINDOW_SECONDS:-600}"
declare -A RESTART_HISTORY=()

_should_restart() {
 local key="$1"
 local now history filtered
 now=$(date +%s)
 history="${RESTART_HISTORY[$key]:-}"
 filtered=""
 local count=0
 for ts in $history; do
 if [ $((now - ts)) -lt "$RESTART_WINDOW_SECONDS" ]; then
 filtered="$filtered $ts"
 count=$((count + 1))
 fi
 done
 if [ "$count" -ge "$MAX_RESTARTS_WINDOW" ]; then
 log_warn "[Sentinel] Restart back-off active for $key ($count in window)"
 return 1
 fi
 RESTART_HISTORY[$key]="$filtered $now"
 return 0
}

# SRE Utilities
check_dependency "curl" || exit 1
check_dependency "docker" || exit 1

send_heartbeat() {
 local status="$1"
 # Improved stats collection with LC_ALL=C for stable parsing
 local cpu mem disk
 cpu=$(LC_ALL=C top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print 100 - $1}')
 mem=$(LC_ALL=C free -m | awk '/Mem:/ {print int($3/$2 * 100)}')
 disk=$(LC_ALL=C df / | awk 'NR==2 {print $5}' | sed 's/%//')

 cpu=${cpu:-0}; [[ "$cpu" =~ ^[0-9.]+$ ]] || cpu=0
 mem=${mem:-0}; [[ "$mem" =~ ^[0-9]+$ ]] || mem=0
 disk=${disk:-0}; [[ "$disk" =~ ^[0-9]+$ ]] || disk=0

 local payload
 payload=$(printf '{"status":"%s","stats":{"cpu":"%s","mem":"%s","disk":"%s"},"timestamp":"%s"}' \
 "$status" "$cpu" "$mem" "$disk" "$(date -Is)")

 curl -s --max-time 10 -X POST -H "Content-Type: application/json" \
 -H "x-api-token: $TOKEN" \
 -d "$payload" "$HEARTBEAT_URL" > /dev/null
}

check_system() {
 # 1. API Health Check (Internal Port 3000)
 if ! response=$(curl -s --max-time 5 "$HEALTH_URL"); then
 log_error "[Sentinel] API unreachable. Verifying container state..."

 if _should_restart "api"; then
  if ! docker ps --format '{{.Names}}' | grep -q "wg-fux-api"; then
  log_error "[Sentinel] API Container is DOWN. Attempting RESTART..."
  send_telegram_msg "CRITICAL: API Container is DOWN. Attempting automatic recovery..." "ERROR"
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" restart api 2>/dev/null || log_error "Failed to restart API container."
  else
  log_warn "[Sentinel] API is unreachable but container is running (Overload/Ghost). Force Restarting..."
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" restart api 2>/dev/null
  fi
 fi
 send_heartbeat "recovering"
 return 1
 fi

 # 2. Database & Application Integrity Check
 if [[ "$response" == *"unhealthy"* ]]; then
 log_warn "[Sentinel] API reports internal unhealthiness. Analyzing..."
 send_telegram_msg "WARNING: API internal health check failed." "WARN"
 fi

 # 3. Full Infrastructure Scan (Docker Health)
 local unhealthy_containers
 unhealthy_containers=$(docker ps --filter "health=unhealthy" --filter "name=wg-" --format "{{.Names}}")

  if [ -n "$unhealthy_containers" ]; then
  while IFS= read -r container; do
    [ -z "$container" ] && continue
    if _should_restart "$container"; then
      log_sre "Unhealthy service detected: $container. Triggering auto-healing..."
      send_telegram_msg "AUTONOMIC HEALING: Service $container is unhealthy. Restarting..." "WARN"
      docker restart "$container" 2>/dev/null
    fi
  done <<< "$unhealthy_containers"
  fi

 # 4. Critical Service Presence Cloud-Check (Nginx/DNS/UI)
  for service in "wg-sentinel-proxy" "wg-fux-dashboard" "wg-fux-dns"; do
  if ! docker ps --format '{{.Names}}' | grep -q "^$service$"; then
  if ! _should_restart "$service"; then continue; fi
  log_error "[Sentinel] $service is MISSING. Recovery initiated..."
  send_telegram_msg "CRITICAL: Service $service is DOWN. Reviving..." "ERROR"
  case "$service" in
  "wg-sentinel-proxy") COMPOSE_SVC="nginx" ;;
  "wg-fux-dashboard") COMPOSE_SVC="ui" ;;
  "wg-fux-dns") COMPOSE_SVC="adguard" ;;
  *) COMPOSE_SVC="" ;;
  esac
  if [ -n "$COMPOSE_SVC" ]; then
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" up -d "$COMPOSE_SVC" 2>/dev/null || \
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" up -d 2>/dev/null || true
  else
  docker compose -f "$PROJECT_ROOT/docker-compose.yml" up -d 2>/dev/null || true
  fi
  fi
  done

 # 5. SSL Certificate & Nginx Reload Check
 # On hashe le cert réellement servi par nginx — auto-signé ET tout cert
 # Let's Encrypt présent dans le volume certbot — DEPUIS le conteneur.
 # Surveiller uniquement le fichier hôte infra/ssl/server.crt ratait les
 # renouvellements LE (qui vivent dans /etc/letsencrypt, jamais sur l'hôte).
 local current_sig
 current_sig=$(docker exec wg-sentinel-proxy sh -c \
   'cat /etc/nginx/ssl/server.crt /etc/letsencrypt/live/*/fullchain.pem 2>/dev/null | sha256sum | cut -d" " -f1' \
   2>/dev/null || echo "")
 if [ -n "$current_sig" ]; then
   if [ -n "${PREV_SSL_SIG:-}" ] && [ "${PREV_SSL_SIG:-}" != "$current_sig" ]; then
     log_sre "SSL Certificate change detected. Reloading Nginx..."
     docker exec wg-sentinel-proxy nginx -s reload 2>/dev/null || true
   fi
   PREV_SSL_SIG="$current_sig"
 fi

 send_heartbeat "healthy"
 return 0
}

# --- Main Loop ---
log_sre "Sentinel Watchdog ($VERSION) started with auto-healing Mode."
send_heartbeat "starting"

while true; do
 check_system
 sleep 30
done

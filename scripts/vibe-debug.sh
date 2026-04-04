#!/bin/bash

# Vibe-OS v6.1 (Autonomous Debugging)
# Tool: Observation Agent (vibe-debug.sh)

LOG_FILE="/home/faleryo/wg-fux/logs/debug.log"
mkdir -p "$(dirname "$LOG_FILE")"

log_info() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [INFO] $1" | tee -a "$LOG_FILE"
}

log_warn() {
    echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] [WARN] $1" | tee -a "$LOG_FILE"
}

log_info "--- [VIBE-DEBUG] : Structural Diagnostics ---"

# 1. Inspect DB Fragmentation internally
log_info "Inspecting /app/data for DB fragmentation..."
docker exec wg-fux-api ls -R /app/data | tee -a "$LOG_FILE"
docker exec wg-fux-api sqlite3 /app/data/wg-fux.db ".tables" | tee -a "$LOG_FILE"

# 2. Check Static Files existence in API container
log_info "Checking static files (React) presence in API container..."
docker exec wg-fux-api ls -d /app/../dashboard-ui/dist 2>&1 | tee -a "$LOG_FILE"

# 3. Check for failed SHELL commands in API logs
log_info "Scanning API logs for Shell command failures..."
docker compose logs api --tail=500 | grep -E "error|failed|ENOENT" | head -n 20 | tee -a "$LOG_FILE"

# 4. Check AdGuard Host status (Port 3002)
log_info "Checking AdGuard UI endpoint..."
curl -sI http://localhost:3002 | head -n 1 | tee -a "$LOG_FILE"

log_info "--- [DIAGNOSTIC COMPLETE] ---"

#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  WG-FUX DIAGNOSTIC TOOL v2.0 — Vibe-OS SRE Protocol
#  Usage: bash wg-diagnose.sh [--json] [--full] [--fix]
#  --json : Sortie JSON pour integration CI/monitoring
#  --full : Tests approfondis (latence, sync DB/FS, scripts shells)
#  --fix  : Auto-corriger les problèmes simples détectés
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
COMPOSE_FILE="$(dirname "$(realpath "$0")")/../../docker-compose.yml"
API_INTERNAL="http://localhost:3000"
API_EXTERNAL="http://localhost/api"
DB_FILE="/app/data/wg-fux.db"
WG_INTERFACE="${WG_INTERFACE:-wg0}"
CLIENTS_DIR="/etc/wireguard/clients"
LOG_MAX_LINES=50

# ── Flags ──────────────────────────────────────────────────────────────────────
MODE_JSON=0; MODE_FULL=0; MODE_FIX=0
for arg in "$@"; do
  case "$arg" in --json) MODE_JSON=1 ;; --full) MODE_FULL=1 ;; --fix) MODE_FIX=1 ;; esac
done

# ── Couleurs (désactivées en mode JSON) ────────────────────────────────────────
if [ "$MODE_JSON" -eq 0 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
  BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
  TICK="✅"; CROSS="❌"; WARN="⚠️ "; INFO="ℹ️ "
else
  RED=''; GREEN=''; YELLOW=''; BLUE=''; CYAN=''; BOLD=''; NC=''
  TICK="OK"; CROSS="FAIL"; WARN="WARN"; INFO="INFO"
fi

# ── Global report ──────────────────────────────────────────────────────────────
REPORT=()
ISSUES=()
FIXES_APPLIED=()
TOTAL_CHECKS=0; PASSED=0; FAILED=0; WARNINGS=0

pass()  { PASSED=$((PASSED+1));   TOTAL_CHECKS=$((TOTAL_CHECKS+1)); REPORT+=("$TICK $1"); [ "$MODE_JSON" -eq 0 ] && echo -e "  ${GREEN}$TICK${NC} $1"; }
fail()  { FAILED=$((FAILED+1));   TOTAL_CHECKS=$((TOTAL_CHECKS+1)); ISSUES+=("$1"); REPORT+=("$CROSS $1"); [ "$MODE_JSON" -eq 0 ] && echo -e "  ${RED}$CROSS${NC} $1"; }
warn()  { WARNINGS=$((WARNINGS+1)); TOTAL_CHECKS=$((TOTAL_CHECKS+1)); REPORT+=("$WARN $1"); [ "$MODE_JSON" -eq 0 ] && echo -e "  ${YELLOW}$WARN${NC} $1"; }
info()  { [ "$MODE_JSON" -eq 0 ] && echo -e "  ${CYAN}$INFO${NC} $1"; }
section(){ [ "$MODE_JSON" -eq 0 ] && echo -e "\n${BOLD}${BLUE}▶ $1${NC}"; }
fixed() { FIXES_APPLIED+=("$1"); [ "$MODE_JSON" -eq 0 ] && echo -e "  ${GREEN}🔧 AUTO-FIX:${NC} $1"; }

# ── START ──────────────────────────────────────────────────────────────────────
[ "$MODE_JSON" -eq 0 ] && cat << 'EOF'

 ██╗    ██╗ ██████╗       ███████╗██╗   ██╗██╗  ██╗
 ██║    ██║██╔════╝       ██╔════╝██║   ██║╚██╗██╔╝
 ██║ █╗ ██║██║  ███╗█████╗█████╗  ██║   ██║ ╚███╔╝
 ██║███╗██║██║   ██║╚════╝██╔══╝  ██║   ██║ ██╔██╗
 ╚███╔███╔╝╚██████╔╝      ██║     ╚██████╔╝██╔╝ ██╗
  ╚══╝╚══╝  ╚═════╝       ╚═╝      ╚═════╝ ╚═╝  ╚═╝
  DIAGNOSTIC TOOL v2.0 — Vibe-OS SRE Protocol

EOF
START_TS=$(date -Is)

# ═══════════════════════════════════════════════════════════════════════════════
# 1. DOCKER CONTAINERS
# ═══════════════════════════════════════════════════════════════════════════════
section "1. Docker Containers"

if ! command -v docker &>/dev/null; then
  fail "Docker n'est pas installé"; else
  pass "Docker installé ($(docker --version | awk '{print $3}' | tr -d ','))"
fi

if ! docker compose -f "$COMPOSE_FILE" version &>/dev/null 2>&1; then
  warn "docker compose plugin non disponible"
fi

for svc in wg-fux-api wg-fux-dashboard wg-sentinel-proxy; do
  STATUS=$(docker inspect --format='{{.State.Status}}' "$svc" 2>/dev/null || echo "missing")
  HEALTH=$(docker inspect --format='{{.State.Health.Status}}' "$svc" 2>/dev/null || echo "no-healthcheck")
  case "$STATUS" in
    running)
      if [ "$HEALTH" = "healthy" ] || [ "$HEALTH" = "no-healthcheck" ]; then
        pass "Container $svc → $STATUS ($HEALTH)"
      else
        warn "Container $svc → $STATUS mais health=$HEALTH"
        if [ "$MODE_FIX" -eq 1 ]; then
          docker restart "$svc" 2>/dev/null && fixed "Redémarrage de $svc"
        fi
      fi ;;
    missing) fail "Container $svc introuvable (non démarré ?)" ;;
    *) fail "Container $svc → état anormal: $STATUS" ;;
  esac
done

# Ressources containers
API_MEM=$(docker stats wg-fux-api --no-stream --format "{{.MemPerc}}" 2>/dev/null | tr -d '%' || echo "0")
API_CPU=$(docker stats wg-fux-api --no-stream --format "{{.CPUPerc}}" 2>/dev/null | tr -d '%' || echo "0")
info "API Resources: CPU=${API_CPU}% MEM=${API_MEM}%"
if (( $(echo "$API_MEM > 85" | bc -l 2>/dev/null || echo 0) )); then
  warn "Mémoire API critique: ${API_MEM}%"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 2. API ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════
section "2. API Endpoints"

# Health interne (sans auth)
HEALTH_RESP=$(curl -sf --max-time 5 "$API_EXTERNAL/health" 2>/dev/null || echo "FAILED")
if [ "$HEALTH_RESP" = "FAILED" ]; then
  fail "GET /api/health → inaccessible"
else
  HEALTH_STATUS=$(echo "$HEALTH_RESP" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
  WG_IFACE_STATUS=$(echo "$HEALTH_RESP" | grep -o '"interface":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
  if [ "$HEALTH_STATUS" = "healthy" ]; then
    pass "GET /api/health → healthy (WireGuard: $WG_IFACE_STATUS)"
  else
    warn "GET /api/health → $HEALTH_STATUS (WireGuard: $WG_IFACE_STATUS)"
  fi
fi

# Login
LOGIN_RESP=$(curl -sf --max-time 5 -X POST "$API_EXTERNAL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"__diag_probe__","password":"x"}' 2>/dev/null || echo "FAILED")

if echo "$LOGIN_RESP" | grep -q "Invalid\|incorrect\|failure\|error"; then
  pass "POST /api/auth/login → rejette les credentials invalides (correct)"
elif [ "$LOGIN_RESP" = "FAILED" ]; then
  fail "POST /api/auth/login → timeout/inaccessible"
else
  warn "POST /api/auth/login → réponse inattendue: ${LOGIN_RESP:0:80}"
fi

# Rate limit
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$API_EXTERNAL/clients" 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "401" ]; then
  pass "GET /api/clients sans auth → 401 Unauthorized (correct)"
elif [ "$HTTP_CODE" = "200" ]; then
  fail "GET /api/clients sans auth → 200 (auth bypass !)"
else
  warn "GET /api/clients sans auth → HTTP $HTTP_CODE"
fi

# Install status
INSTALL_RESP=$(curl -sf --max-time 3 "$API_EXTERNAL/install/status" 2>/dev/null || echo "FAILED")
if echo "$INSTALL_RESP" | grep -q "installed"; then
  pass "GET /api/install/status → OK"
else
  fail "GET /api/install/status → inaccessible"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 3. NGINX & SSL
# ═══════════════════════════════════════════════════════════════════════════════
section "3. Nginx & SSL"

NGINX_CFG=$(docker exec wg-sentinel-proxy nginx -t 2>&1 || echo "FAILED")
if echo "$NGINX_CFG" | grep -q "ok\|successful"; then
  pass "Config nginx → valide"
else
  fail "Config nginx → invalide: ${NGINX_CFG:0:100}"
fi

# Test SSL
SSL_RESP=$(curl -sk --max-time 5 -o /dev/null -w "%{http_code}" "https://localhost/api/health" 2>/dev/null || echo "000")
case "$SSL_RESP" in
  200) pass "HTTPS localhost → HTTP $SSL_RESP" ;;
  301|302) warn "HTTPS localhost → redirect ($SSL_RESP)" ;;
  000) warn "HTTPS localhost → inaccessible (SSL disabled ?)" ;;
  *) warn "HTTPS localhost → HTTP $SSL_RESP" ;;
esac

# Vérif expiration SSL
CERT_EXPIRY=$(docker exec wg-sentinel-proxy sh -c \
  'openssl x509 -in /etc/nginx/ssl/server.crt -noout -enddate 2>/dev/null | cut -d= -f2' || echo "")
if [ -n "$CERT_EXPIRY" ]; then
  EXPIRY_TS=$(date -d "$CERT_EXPIRY" +%s 2>/dev/null || echo "0")
  NOW_TS=$(date +%s)
  DAYS_LEFT=$(( (EXPIRY_TS - NOW_TS) / 86400 ))
  if [ "$DAYS_LEFT" -lt 0 ]; then
    fail "Certificat SSL EXPIRÉ ! ($CERT_EXPIRY)"
  elif [ "$DAYS_LEFT" -lt 30 ]; then
    warn "Certificat SSL expire dans $DAYS_LEFT jours ($CERT_EXPIRY)"
  else
    pass "Certificat SSL valide → expire dans $DAYS_LEFT jours"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 4. WIREGUARD
# ═══════════════════════════════════════════════════════════════════════════════
section "4. WireGuard Interface"

# Interface via sysfs (fiable)
if docker exec wg-fux-api test -d "/sys/class/net/$WG_INTERFACE" 2>/dev/null; then
  pass "Interface $WG_INTERFACE → présente dans sysfs"
else
  fail "Interface $WG_INTERFACE → absente (WireGuard down ?)"
  if [ "$MODE_FIX" -eq 1 ]; then
    warn "Fix manuel requis: sudo wg-quick up $WG_INTERFACE"
  fi
fi

# wg show
WG_SHOW=$(docker exec wg-fux-api wg show "$WG_INTERFACE" 2>&1 || echo "FAILED")
if [ "$WG_SHOW" = "FAILED" ] || echo "$WG_SHOW" | grep -q "Unable\|error"; then
  fail "wg show $WG_INTERFACE → échec: ${WG_SHOW:0:100}"
else
  PEER_COUNT=$(echo "$WG_SHOW" | grep -c "^peer:" || echo "0")
  pass "wg show $WG_INTERFACE → OK ($PEER_COUNT peers actifs)"
fi

# wg-stats test
WG_STATS=$(docker exec wg-fux-api bash /usr/local/bin/wg-stats.sh --json 2>&1 || echo "FAILED")
if echo "$WG_STATS" | python3 -c "import sys,json; data=json.load(sys.stdin); exit(0 if isinstance(data,list) else 1)" 2>/dev/null; then
  STATS_COUNT=$(echo "$WG_STATS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")
  pass "wg-stats.sh --json → JSON valide ($STATS_COUNT peers)"
else
  fail "wg-stats.sh --json → JSON invalide: ${WG_STATS:0:100}"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 5. BASE DE DONNÉES
# ═══════════════════════════════════════════════════════════════════════════════
section "5. Base de données SQLite"

DB_CHECK=$(docker exec wg-fux-api sqlite3 "$DB_FILE" ".tables" 2>&1 || echo "FAILED")
if [ "$DB_CHECK" = "FAILED" ] || echo "$DB_CHECK" | grep -q "error\|Error"; then
  fail "SQLite → inaccessible: ${DB_CHECK:0:100}"
else
  TABLES=$(echo "$DB_CHECK" | tr ' ' '\n' | grep -c '\S' || echo "0")
  pass "SQLite → accessible ($TABLES tables: $DB_CHECK)"
fi

# Counts
for table in clients users logs usage; do
  COUNT=$(docker exec wg-fux-api sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM $table;" 2>/dev/null || echo "ERR")
  if [ "$COUNT" = "ERR" ]; then
    warn "Table $table → inaccessible"
  else
    info "Table $table → $COUNT lignes"
  fi
done

# Intégrité DB
INTEGRITY=$(docker exec wg-fux-api sqlite3 "$DB_FILE" "PRAGMA integrity_check;" 2>/dev/null || echo "FAILED")
if [ "$INTEGRITY" = "ok" ]; then
  pass "Intégrité SQLite → OK"
else
  fail "Intégrité SQLite → problème détecté: $INTEGRITY"
  if [ "$MODE_FIX" -eq 1 ]; then
    docker exec wg-fux-api sqlite3 "$DB_FILE" "PRAGMA wal_checkpoint(FULL);" 2>/dev/null && fixed "WAL checkpoint forcé"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 6. SYNCHRONISATION DB ↔ FILESYSTEM (mode --full)
# ═══════════════════════════════════════════════════════════════════════════════
if [ "$MODE_FULL" -eq 1 ]; then
  section "6. Synchronisation DB ↔ Filesystem"

  DB_CLIENTS=$(docker exec wg-fux-api sqlite3 "$DB_FILE" \
    "SELECT container||'/'||name FROM clients ORDER BY container,name;" 2>/dev/null | sort)
  FS_CLIENTS=$(docker exec wg-fux-api \
    find "$CLIENTS_DIR" -name "public.key" 2>/dev/null | \
    sed "s|$CLIENTS_DIR/||;s|/public.key||" | sort)

  IN_DB_NOT_FS=$(comm -23 <(echo "$DB_CLIENTS") <(echo "$FS_CLIENTS") | head -10)
  IN_FS_NOT_DB=$(comm -13 <(echo "$DB_CLIENTS") <(echo "$FS_CLIENTS") | head -10)

  if [ -z "$IN_DB_NOT_FS" ] && [ -z "$IN_FS_NOT_DB" ]; then
    pass "DB ↔ FS → synchronisés"
  else
    if [ -n "$IN_DB_NOT_FS" ]; then
      fail "En DB mais pas sur FS: $(echo "$IN_DB_NOT_FS" | tr '\n' ' ')"
    fi
    if [ -n "$IN_FS_NOT_DB" ]; then
      warn "Sur FS mais pas en DB: $(echo "$IN_FS_NOT_DB" | tr '\n' ' ')"
    fi
  fi

  # Vérifier les fichiers manquants pour chaque client DB
  ORPHAN_COUNT=0
  while IFS='/' read -r container name; do
    CLIENT_DIR="$CLIENTS_DIR/$container/$name"
    for required in "public.key" "preshared.key" "allowed_ips.txt" "${name}.conf"; do
      if ! docker exec wg-fux-api test -f "$CLIENT_DIR/$required" 2>/dev/null; then
        warn "Fichier manquant: $CLIENT_DIR/$required"
        ORPHAN_COUNT=$((ORPHAN_COUNT+1))
      fi
    done
  done <<< "$DB_CLIENTS"

  if [ "$ORPHAN_COUNT" -eq 0 ]; then
    pass "Fichiers clients → tous intègres"
  else
    fail "$ORPHAN_COUNT fichiers clients manquants"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 7. SCRIPTS SHELL
# ═══════════════════════════════════════════════════════════════════════════════
if [ "$MODE_FULL" -eq 1 ]; then
  section "7. Scripts Shell"

  for script in wg-stats.sh wg-enforcer.sh wg-create-client.sh wg-postup.sh wg-postdown.sh wg-speedtest.sh; do
    SCRIPT_PATH="/usr/local/bin/$script"
    EXISTS=$(docker exec wg-fux-api test -f "$SCRIPT_PATH" && echo "yes" || echo "no")
    EXECUTABLE=$(docker exec wg-fux-api test -x "$SCRIPT_PATH" && echo "yes" || echo "no")
    SYNTAX=$(docker exec wg-fux-api bash -n "$SCRIPT_PATH" 2>&1 && echo "ok" || echo "SYNTAX_ERROR")

    if [ "$EXISTS" = "no" ]; then
      fail "Script manquant: $script"
    elif [ "$EXECUTABLE" = "no" ]; then
      warn "Script non exécutable: $script"
      if [ "$MODE_FIX" -eq 1 ]; then
        docker exec wg-fux-api chmod +x "$SCRIPT_PATH" 2>/dev/null && fixed "chmod +x $script"
      fi
    elif [ "$SYNTAX" != "ok" ]; then
      fail "Erreur syntaxe $script: ${SYNTAX:0:80}"
    else
      pass "Script $script → OK"
    fi
  done

  # Vérifier le lock de création IP
  LOCK_EXISTS=$(docker exec wg-fux-api test -f /var/lock/wg-ip.lock && echo "yes" || echo "no")
  if [ "$LOCK_EXISTS" = "yes" ]; then
    LOCK_AGE=$(docker exec wg-fux-api find /var/lock/wg-ip.lock -mmin +5 2>/dev/null | wc -l)
    if [ "$LOCK_AGE" -gt 0 ]; then
      warn "Lock /var/lock/wg-ip.lock existe depuis >5min (création bloquée ?)"
      if [ "$MODE_FIX" -eq 1 ]; then
        docker exec wg-fux-api rm -f /var/lock/wg-ip.lock && fixed "Lock wg-ip.lock supprimé"
      fi
    fi
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 8. LOGS API (erreurs récentes)
# ═══════════════════════════════════════════════════════════════════════════════
section "8. Logs Récents"

ERROR_COUNT=$(docker logs wg-fux-api --since=1h 2>&1 | grep -c "ERROR\|FATAL\|Error" || echo 0)
WARN_COUNT=$(docker logs wg-fux-api --since=1h 2>&1 | grep -c "WARN\|Warning" || echo 0)

if [ "$ERROR_COUNT" -gt 20 ]; then
  fail "$ERROR_COUNT erreurs dans les logs API (dernière heure)"
  docker logs wg-fux-api --since=1h 2>&1 | grep "ERROR\|FATAL" | tail -5 | while read -r line; do
    info "  → $line"
  done
elif [ "$ERROR_COUNT" -gt 0 ]; then
  warn "$ERROR_COUNT erreurs dans les logs API (dernière heure)"
else
  pass "Logs API → 0 erreurs (dernière heure)"
fi

info "Warnings API dernière heure: $WARN_COUNT"

# Auth failures
AUTH_FAILURES=$(docker exec wg-fux-api sqlite3 "$DB_FILE" \
  "SELECT COUNT(*) FROM logs WHERE status='failure' AND timestamp > datetime('now','-1 hour');" 2>/dev/null || echo 0)
if [ "$AUTH_FAILURES" -gt 20 ]; then
  warn "$AUTH_FAILURES échecs d'authentification (1h) — potentiel brute force"
elif [ "$AUTH_FAILURES" -gt 0 ]; then
  info "$AUTH_FAILURES échecs d'authentification (dernière heure)"
else
  pass "Authentification → 0 échec (dernière heure)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 9. RESSOURCES SYSTÈME
# ═══════════════════════════════════════════════════════════════════════════════
section "9. Ressources Système"

DISK_USE=$(df / | awk 'NR==2 {gsub(/%/,"",$5); print $5}')
MEM_USE=$(free | awk '/Mem:/ {printf "%.0f", $3/$2*100}')
SWAP_USE=$(free | awk '/Swap:/ {if($2>0) printf "%.0f", $3/$2*100; else print "0"}')
LOAD_1=$(uptime | awk -F'load average:' '{print $2}' | awk -F',' '{print $1}' | tr -d ' ')
CPU_CORES=$(nproc)

[ "$DISK_USE" -lt 80 ]  && pass "Disque / → ${DISK_USE}% utilisé" \
                         || { [ "$DISK_USE" -lt 95 ] && warn "Disque / → ${DISK_USE}% (seuil 80%)" \
                                                      || fail "Disque / → ${DISK_USE}% CRITIQUE"; }

[ "$MEM_USE" -lt 80 ]   && pass "Mémoire → ${MEM_USE}% utilisée" \
                         || { [ "$MEM_USE" -lt 95 ] && warn "Mémoire → ${MEM_USE}% (seuil 80%)" \
                                                     || fail "Mémoire → ${MEM_USE}% CRITIQUE"; }

info "CPU Load 1min: $LOAD_1 (cores: $CPU_CORES)"
info "Swap: ${SWAP_USE}% utilisé"

# ═══════════════════════════════════════════════════════════════════════════════
# 10. SENTINEL
# ═══════════════════════════════════════════════════════════════════════════════
section "10. Sentinel Watchdog"

if systemctl is-active sentinel.service &>/dev/null; then
  SENTINEL_UPTIME=$(systemctl show sentinel.service --property=ActiveEnterTimestamp --value 2>/dev/null || echo "")
  pass "Service sentinel.service → actif (depuis: $SENTINEL_UPTIME)"
else
  warn "Service sentinel.service → inactif"
  if [ "$MODE_FIX" -eq 1 ]; then
    sudo systemctl restart sentinel.service 2>/dev/null && fixed "Redémarrage sentinel.service"
  fi
fi

SENTINEL_LOG="/var/log/wg-sentinel.log"
if [ -f "$SENTINEL_LOG" ]; then
  SENTINEL_ERRORS=$(grep -c "ERROR\|CRITICAL" "$SENTINEL_LOG" 2>/dev/null || echo 0)
  LAST_HB=$(tail -1 "$SENTINEL_LOG" 2>/dev/null | awk '{print $1, $2}')
  if [ "$SENTINEL_ERRORS" -gt 0 ]; then
    warn "Sentinel: $SENTINEL_ERRORS erreurs dans /var/log/wg-sentinel.log"
  else
    pass "Sentinel logs → OK (dernier: $LAST_HB)"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
# RAPPORT FINAL
# ═══════════════════════════════════════════════════════════════════════════════

END_TS=$(date -Is)
SCORE=$(( PASSED * 100 / (TOTAL_CHECKS > 0 ? TOTAL_CHECKS : 1) ))

if [ "$MODE_JSON" -eq 1 ]; then
  # Sortie JSON structurée pour CI/monitoring/alerting
  ISSUES_JSON=$(printf '"%s",' "${ISSUES[@]:-}" | sed 's/,$//')
  FIXES_JSON=$(printf '"%s",' "${FIXES_APPLIED[@]:-}" | sed 's/,$//')
  python3 - <<EOF
import json, sys
data = {
    "timestamp": "$END_TS",
    "score": $SCORE,
    "total": $TOTAL_CHECKS,
    "passed": $PASSED,
    "failed": $FAILED,
    "warnings": $WARNINGS,
    "status": "healthy" if $FAILED == 0 else "degraded" if $FAILED < 3 else "critical",
    "issues": [$(echo "${ISSUES[@]:-}" | python3 -c "import sys; items=sys.stdin.read().split(); print(','.join(json.dumps(i) for i in items))" 2>/dev/null || echo "")],
    "fixes_applied": [$(echo "${FIXES_APPLIED[@]:-}" | python3 -c "import sys; items=sys.stdin.read().split(); print(','.join(json.dumps(i) for i in items))" 2>/dev/null || echo "")],
}
print(json.dumps(data, indent=2))
EOF
else
  # Rapport lisible
  echo ""
  echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}  RAPPORT DE DIAGNOSTIC WG-FUX${NC}"
  echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
  printf "  Score de santé    : "
  if [ "$SCORE" -ge 90 ]; then echo -e "${GREEN}${BOLD}${SCORE}% ✅ EXCELLENT${NC}";
  elif [ "$SCORE" -ge 70 ]; then echo -e "${YELLOW}${SCORE}% ⚠️  DÉGRADÉ${NC}";
  else echo -e "${RED}${SCORE}% ❌ CRITIQUE${NC}"; fi
  echo -e "  Checks passés     : ${GREEN}$PASSED${NC}/$TOTAL_CHECKS"
  [ "$FAILED" -gt 0 ]   && echo -e "  Échecs            : ${RED}$FAILED${NC}"
  [ "$WARNINGS" -gt 0 ] && echo -e "  Avertissements    : ${YELLOW}$WARNINGS${NC}"
  echo ""

  if [ ${#ISSUES[@]} -gt 0 ]; then
    echo -e "${BOLD}${RED}  ❌ Problèmes détectés :${NC}"
    for issue in "${ISSUES[@]}"; do echo -e "     • $issue"; done
    echo ""
  fi

  if [ ${#FIXES_APPLIED[@]} -gt 0 ]; then
    echo -e "${BOLD}${GREEN}  🔧 Corrections appliquées :${NC}"
    for fix in "${FIXES_APPLIED[@]}"; do echo -e "     • $fix"; done
    echo ""
  fi

  echo -e "  Durée             : $START_TS → $END_TS"
  echo -e "${BOLD}══════════════════════════════════════════════════${NC}"
  echo ""

  # Commandes de debug suggérées
  if [ "$FAILED" -gt 0 ]; then
    echo -e "${BOLD}💡 Commandes de debug suggérées :${NC}"
    echo "   sudo docker compose logs api -f --tail=100"
    echo "   sudo docker exec -it wg-fux-api bash"
    echo "   sudo docker exec wg-fux-api sqlite3 /app/data/wg-fux.db '.tables'"
    echo "   sudo docker exec wg-fux-api wg show wg0"
    echo "   bash $(realpath "$0") --full --fix"
    echo ""
  fi
fi

# Exit code basé sur les résultats
[ "$FAILED" -eq 0 ] && exit 0 || exit 1

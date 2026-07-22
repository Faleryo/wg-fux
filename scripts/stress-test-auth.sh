#!/bin/bash
set -euo pipefail

# WG-FUX v6.3 "Watcher's Eye"
# SRE Brick: Auth Stress Test (Concurrency & Rate-Limit Audit)

TARGET_URL="${TARGET_URL:-http://localhost:3000/api/auth/login}"
CONCURRENCY="${CONCURRENCY:-10}"
TOTAL_REQUESTS="${TOTAL_REQUESTS:-100}"
LOG_FILE="${LOG_FILE:-./logs/stress-test.log}"
USERNAME="${TEST_USERNAME:-admin}"
PASSWORD="${TEST_PASSWORD:-admin123}"

mkdir -p "$(dirname "$LOG_FILE")"

echo "🚀 Starting Auth Stress Test: $TOTAL_REQUESTS requests ($CONCURRENCY concurrent)" | tee "$LOG_FILE"

start_time=$(date +%s%N)

# Function to perform a single login request (exported for xargs usage)
do_request() {
 local start resp end diff
 start=$(date +%s%N)
 resp=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$TARGET_URL" \
 -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}")
 end=$(date +%s%N)
 # Une expansion arithmétique n'accepte NI redirection NI `||` : l'ancien
 # `$(( ... 2>/dev/null || echo 0 ))` était une erreur de syntaxe à l'exécution,
 # donc la latence n'était jamais mesurée. On teste plutôt que `%N` a bien été
 # développé en chiffres (BSD/macOS le rendent littéralement).
 if [[ "$start$end" =~ ^[0-9]+$ ]]; then
  diff=$(( (end - start) / 1000000 ))
 else
  diff=0
 fi
 echo "$resp $diff"
}
export -f do_request
export TARGET_URL USERNAME PASSWORD

# Run requests using xargs for concurrency (since parallel might not be installed)
results=$(seq "$TOTAL_REQUESTS" | xargs -I{} -P "$CONCURRENCY" bash -c "do_request" 2>/dev/null || echo "")

# On ne garde que les lignes bien formées « <code> <ms> ». Sans ce filtrage,
# `echo "$results"` sur un résultat VIDE émet quand même une ligne vide, que
# `grep -cv` comptabilisait comme une erreur : un run à zéro requête aboutie
# rapportait « Errors: 1 ».
results=$(printf '%s\n' "$results" | grep -E '^[0-9]{3} [0-9]+$' || true)

end_time=$(date +%s%N)
total_diff=$(( (end_time - start_time) / 1000000 ))

if [ -z "$results" ]; then
 echo "❌ Aucune réponse exploitable (cible injoignable ? $TARGET_URL)" | tee -a "$LOG_FILE"
 exit 1
fi

# Analyze results
# `grep` sort en 1 quand il ne trouve RIEN, ce qui sous `set -euo pipefail`
# faisait avorter le script avant le moindre affichage. Le cas le plus courant
# était le cas NOMINAL : si toutes les réponses sont 200/429, le `grep -v` des
# erreurs ne matche rien → exit 1 → aucun résultat n'était jamais imprimé.
# `|| true` neutralise ce statut sans masquer le comptage (grep imprime déjà 0).
success_count=$(echo "$results" | grep -c "^200" || true)
ratelimit_count=$(echo "$results" | grep -c "^429" || true)
error_count=$(echo "$results" | grep -cvE "^(200|429)" || true)
avg_lat=$(echo "$results" | awk '{sum+=$2; count++} END {if (count > 0) printf "%.1f", sum/count; else print "0"}')

echo "--------------------------------------" | tee -a "$LOG_FILE"
echo "📊 Results:" | tee -a "$LOG_FILE"
echo " - Success (200): $success_count" | tee -a "$LOG_FILE"
echo " - Rate Limited (429): $ratelimit_count" | tee -a "$LOG_FILE"
echo " - Errors: $error_count" | tee -a "$LOG_FILE"
echo " - Avg Latency: ${avg_lat}ms" | tee -a "$LOG_FILE"
echo " - Total Time: ${total_diff}ms" | tee -a "$LOG_FILE"
echo "--------------------------------------" | tee -a "$LOG_FILE"

if [ "$ratelimit_count" -gt 0 ]; then
 echo "✅ PASS: Rate limiting is active (Shadowing detection works)." | tee -a "$LOG_FILE"
else
 echo "⚠️ WARNING: No rate limiting detected. Check express-rate-limit config." | tee -a "$LOG_FILE"
fi

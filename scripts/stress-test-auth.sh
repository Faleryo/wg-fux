#!/bin/bash

# WG-FUX v6.3 "Watcher's Eye"
# SRE Brick: Auth Stress Test (Concurrency & Rate-Limit Audit)

TARGET_URL="http://localhost:3000/api/auth/login"
CONCURRENCY=10
TOTAL_REQUESTS=100
LOG_FILE="/home/faleryo/wg-fux/logs/stress-test.log"

mkdir -p "$(dirname "$LOG_FILE")"

echo "🚀 Starting Auth Stress Test: $TOTAL_REQUESTS requests ($CONCURRENCY concurrent)" | tee "$LOG_FILE"

start_time=$(date +%s%N)

# Function to perform a single login request
do_request() {
    local start=$(date +%s%N)
    local resp=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$TARGET_URL" \
        -H "Content-Type: application/json" \
        -d '{"username":"admin","password":"admin123"}')
    local end=$(date +%s%N)
    local diff=$(( (end - start) / 1000000 ))
    echo "$resp $diff"
}

export -f do_request
export TARGET_URL

# Run requests using xargs for concurrency (since parallel might not be installed)
results=$(seq "$TOTAL_REQUESTS" | xargs -I{} -P "$CONCURRENCY" bash -c "do_request")

end_time=$(date +%s%N)
total_diff=$(( (end_time - start_time) / 1000000 ))

# Analyze results
success_count=$(echo "$results" | grep -c "^200")
ratelimit_count=$(echo "$results" | grep -c "^429")
error_count=$(echo "$results" | grep -vE "^(200|429)" | wc -l)
avg_lat=$(echo "$results" | awk '{sum+=$2} END {print sum/NR}')

echo "--------------------------------------" | tee -a "$LOG_FILE"
echo "📊 Results:" | tee -a "$LOG_FILE"
echo "  - Success (200): $success_count" | tee -a "$LOG_FILE"
echo "  - Rate Limited (429): $ratelimit_count" | tee -a "$LOG_FILE"
echo "  - Errors: $error_count" | tee -a "$LOG_FILE"
echo "  - Avg Latency: ${avg_lat}ms" | tee -a "$LOG_FILE"
echo "  - Total Time: ${total_diff}ms" | tee -a "$LOG_FILE"
echo "--------------------------------------" | tee -a "$LOG_FILE"

if [ "$ratelimit_count" -gt 0 ]; then
    echo "✅ PASS: Rate limiting is active (Shadowing detection works)." | tee -a "$LOG_FILE"
else
    echo "⚠️ WARNING: No rate limiting detected. Check express-rate-limit config." | tee -a "$LOG_FILE"
fi

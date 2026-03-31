#!/bin/bash
PROFILE=$1
INTERFACE="${WG_INTERFACE:-wg0}"
PHYS_INTERFACE=$(ip route get 8.8.8.8 2>/dev/null | grep -Po '(?<=dev )[^ ]+' | head -1 || ip -4 route ls | grep default | grep -Po '(?<=dev )[^ ]+' | head -1)
LOG_FILE="/var/log/wg-optimize.log"

apply_sysctl() {
    local key=$1
    local value=$2
    if sysctl -w "$key=$value" >> "$LOG_FILE" 2>&1; then
        return 0
    else
        # Log but don't fail, common in containers
        echo "$(date): Failed to set $key. (Container limitation or invalid key)" >> "$LOG_FILE"
        return 1
    fi
}

# Log function local to the script
log() {
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] $1" | tee -a "$LOG_FILE"
}


if [ "$PROFILE" = "restore" ]; then
    if [ -f /etc/wireguard/optimization_profile ]; then
        PROFILE=$(cat /etc/wireguard/optimization_profile)
        log "Restoring profile: $PROFILE"
    else
        log "No profile to restore."
        PROFILE="default"
    fi
fi

if [ "$PROFILE" = "gaming" ]; then
    # Low Latency Optimization
    log "Applying Gaming Profile (Low Latency)..."
    apply_sysctl net.ipv4.tcp_fastopen 3
    apply_sysctl net.ipv4.tcp_low_latency 1
    apply_sysctl net.core.netdev_max_backlog 5000
    apply_sysctl net.ipv4.tcp_slow_start_after_idle 0
    apply_sysctl net.ipv4.tcp_notsent_lowat 16384
    apply_sysctl net.core.netdev_budget 600
    
    # Busy Polling (Réduit la latence au prix du CPU)
    apply_sysctl net.core.busy_read 50
    apply_sysctl net.core.busy_poll 50
    
    # Scheduler Tuning pour la réactivité
    apply_sysctl kernel.sched_migration_cost_ns 500000
    apply_sysctl kernel.sched_autogroup_enabled 0
    
    # Optimisation Ring Buffer (Hardware) sur l'interface physique
    if command -v ethtool >/dev/null && [ -n "$PHYS_INTERFACE" ]; then
        # Detect Max supported
        MAX_RX=$(ethtool -g "$PHYS_INTERFACE" 2>/dev/null | grep "RX:" | head -1 | awk '{print $2}')
        MAX_TX=$(ethtool -g "$PHYS_INTERFACE" 2>/dev/null | grep "TX:" | head -1 | awk '{print $2}')
        if [ -n "$MAX_RX" ] && [ "$MAX_RX" != "n/a" ] && [ "$MAX_RX" -gt 0 ]; then
            ethtool -G "$PHYS_INTERFACE" rx "$MAX_RX" 2>/dev/null && log "Increased RX Ring on $PHYS_INTERFACE to $MAX_RX" || true
        fi
        if [ -n "$MAX_TX" ] && [ "$MAX_TX" != "n/a" ] && [ "$MAX_TX" -gt 0 ]; then
            ethtool -G "$PHYS_INTERFACE" tx "$MAX_TX" 2>/dev/null && log "Increased TX Ring on $PHYS_INTERFACE to $MAX_TX" || true
        fi
        
        # Disable Coalesce for Low Latency (Interrupt moderation)
        ethtool -C "$PHYS_INTERFACE" adaptive-rx off adaptive-tx off rx-usecs 0 tx-usecs 0 2>/dev/null && log "Disabled interrupt coalescence on $PHYS_INTERFACE" || true
    fi

    # Optimisation Multi-Queue (RSS vs RPS)
    RSS_ENABLED=0
    if command -v ethtool >/dev/null && [ -n "$PHYS_INTERFACE" ]; then
        # Vérifier si RSS (Hardware) est supporté
        MAX_COMBINED=$(ethtool -l "$PHYS_INTERFACE" 2>/dev/null | grep -A 5 "Pre-set maximums" | grep "Combined:" | awk '{print $2}')
        if [ -n "$MAX_COMBINED" ] && [ "$MAX_COMBINED" -gt 1 ]; then
            log "RSS Hardware support detected (Max: $MAX_COMBINED). Enabling..."
            ethtool -L "$PHYS_INTERFACE" combined "$MAX_COMBINED" 2>/dev/null && RSS_ENABLED=1
        fi
    fi

    # Si RSS n'est pas dispo, on active RPS (Software)
    if [ "$RSS_ENABLED" -eq 0 ] && [ -n "$PHYS_INTERFACE" ] && [ -d "/sys/class/net/$PHYS_INTERFACE/queues" ]; then
        log "RSS not supported. Enabling RPS (Software Steering) on $PHYS_INTERFACE..."
        rfc=$(grep -c processor /proc/cpuinfo)
        cc=$(printf %x $((2**rfc - 1)))
        for file in /sys/class/net/"$PHYS_INTERFACE"/queues/rx-*/rps_cpus; do
            echo "$cc" > "$file" 2>/dev/null || true
        done
    elif [ "$RSS_ENABLED" -eq 1 ]; then
        log "RSS enabled. Skipping RPS to avoid conflict."
    fi

    # Augmenter les buffers UDP pour éviter les drops WireGuard
    apply_sysctl net.core.rmem_max 16777216
    apply_sysctl net.core.wmem_max 16777216
    
    # BBR is generally good for everything
    if grep -q "bbr" /proc/sys/net/ipv4/tcp_available_congestion_control 2>/dev/null; then
        apply_sysctl net.core.default_qdisc fq
        apply_sysctl net.ipv4.tcp_congestion_control bbr
    fi

    if ip link show "$INTERFACE" > /dev/null 2>&1; then
        ip link set dev $INTERFACE txqueuelen 1000
    fi
    echo "gaming" > /etc/wireguard/optimization_profile
    log "Gaming profile applied"
elif [ "$PROFILE" = "streaming" ]; then
    # High Throughput Optimization
    log "Applying Streaming Profile (High Throughput)..."
    apply_sysctl net.ipv4.tcp_window_scaling 1
    apply_sysctl net.core.rmem_max 268435456
    apply_sysctl net.core.wmem_max 268435456
    apply_sysctl net.ipv4.tcp_rmem "4096 87380 268435456"
    apply_sysctl net.ipv4.tcp_wmem "4096 65536 268435456"
    apply_sysctl net.ipv4.tcp_mtu_probing 1
    
    if grep -q "bbr" /proc/sys/net/ipv4/tcp_available_congestion_control 2>/dev/null; then
        apply_sysctl net.core.default_qdisc fq
        apply_sysctl net.ipv4.tcp_congestion_control bbr
    else
        apply_sysctl net.ipv4.tcp_congestion_control cubic
    fi

    if ip link show "$INTERFACE" > /dev/null 2>&1; then
        ip link set dev $INTERFACE txqueuelen 2000
    fi
    echo "streaming" > /etc/wireguard/optimization_profile
    log "Streaming profile applied"
elif [ "$PROFILE" = "auto" ]; then
    # Run speedtest and decide
    log "Starting Auto-Optimization..."
    if ! command -v speedtest-cli &> /dev/null; then
        log "speedtest-cli not found. Installing..."
        if [ -f /etc/debian_version ]; then apt-get update && apt-get install -y speedtest-cli; fi
        if [ -f /etc/redhat-release ]; then yum install -y speedtest-cli; fi
    fi
    
    log "Running bandwidth test..."
    # Timeout to prevent hanging
    SPEED_JSON=$(timeout 60s speedtest-cli --json --secure 2>/dev/null)
    
    if [ -z "$SPEED_JSON" ]; then
        log "Speedtest failed. Defaulting to gaming profile."
        /usr/local/bin/wg-optimize.sh gaming
        exit 0
    fi

    DL=$(echo "$SPEED_JSON" | jq -r '.download // 0')
    # Convert to Mbps
    DL_MBPS=$(echo "$DL / 1000000" | bc 2>/dev/null)
    log "Detected Download: ${DL_MBPS} Mbps"
    
    if (( $(echo "$DL_MBPS > 500" | bc -l) )); then
        log "High bandwidth detected. Switching to Streaming profile."
        /usr/local/bin/wg-optimize.sh streaming
    else
        log "Standard bandwidth detected. Switching to Gaming profile."
        /usr/local/bin/wg-optimize.sh gaming
    fi
elif [ "$PROFILE" = "default" ] || [ "$PROFILE" = "disable" ]; then
    log "Resetting to defaults..."
    apply_sysctl net.ipv4.tcp_fastopen 1
    apply_sysctl net.core.netdev_max_backlog 1000
    apply_sysctl net.core.rmem_max 16777216
    apply_sysctl net.core.wmem_max 16777216
    apply_sysctl net.ipv4.tcp_rmem "4096 87380 6291456"
    apply_sysctl net.ipv4.tcp_wmem "4096 16384 4194304"
    apply_sysctl net.ipv4.tcp_mtu_probing 0
    apply_sysctl net.ipv4.tcp_low_latency 0
    apply_sysctl net.ipv4.tcp_slow_start_after_idle 1
    apply_sysctl net.core.busy_read 0
    apply_sysctl net.core.busy_poll 0
    
    if ip link show "$INTERFACE" > /dev/null 2>&1; then
        ip link set dev $INTERFACE txqueuelen 1000
    fi
    rm -f /etc/wireguard/optimization_profile
    log "Default profile applied (Optimization Disabled)"
else
    echo "Usage: wg-optimize.sh [gaming|streaming|auto|default|disable]"
    log "Unknown profile: $PROFILE"
fi

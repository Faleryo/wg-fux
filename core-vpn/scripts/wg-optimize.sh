#!/bin/bash
# WG-FUX Optimization Engine (v3.2 Platinum)
# Optimizes network parameters for specific workloads (Gaming, Streaming, Auto)
# Docker-aware: Handles Read-only filesystems and prioritizes sysctl.

INTERFACE=${WG_INTERFACE:-wg0}
PROFILE=$1
LOG_FILE="/var/log/wg-optimize.log"
STATE_FILE="/etc/wireguard/active_profile"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

apply_sysctl() {
    local key=$1
    local val=$2
    if sysctl -w "$key=$val" > /dev/null 2>&1; then
        log "Applied: $key = $val"
    else
        log "Skipped (Permission/Sysctl): $key"
    fi
}

apply_sysfs() {
    local path=$1
    local val=$2
    if [ -w "$path" ]; then
        echo "$val" > "$path" 2>/dev/null && log "Applied Sysfs: $path = $val" || log "Failed Sysfs (Write): $path"
    else
        log "Skipped Sysfs (Read-only/Absent): $path"
    fi
}

if [ -z "$PROFILE" ]; then
    echo "Usage: wg-optimize.sh [gaming|streaming|auto|default|disable]"
    exit 1
fi

log "Starting Network Optimization: Profile -> $PROFILE"

# Save active profile
echo "$PROFILE" > "$STATE_FILE"

if [ "$PROFILE" = "gaming" ]; then
    log "Optimizing for E-Sport & VoIP (Ultra-Low Latency)..."
    
    # TCP Low Latency & Speed
    apply_sysctl net.ipv4.tcp_low_latency 1
    apply_sysctl net.ipv4.tcp_fastopen 3
    apply_sysctl net.ipv4.tcp_autocorking 0
    apply_sysctl net.ipv4.tcp_no_metrics_save 1
    
    # Kernel Network Buffer
    apply_sysctl net.core.netdev_max_backlog 5000
    apply_sysctl net.ipv4.tcp_max_syn_backlog 4096
    
    # Small packet priority
    apply_sysctl net.ipv4.tcp_notsent_lowat 16384
    
    # Interface Tuning
    if ip link show "$INTERFACE" > /dev/null 2>&1; then
        ip link set dev $INTERFACE txqueuelen 10000
        log "Interface $INTERFACE: txqueuelen set to 10000"
    fi
    
    # RPS/RFS Tuning (Optional - safe for Docker)
    find /sys/class/net/eth0/queues/rx-0/rps_cpus -writable 2>/dev/null && apply_sysfs "/sys/class/net/eth0/queues/rx-0/rps_cpus" "f"

elif [ "$PROFILE" = "streaming" ]; then
    log "Optimizing for High Throughput (4K/8K Streaming)..."
    
    # TCP Window Scaling
    apply_sysctl net.ipv4.tcp_window_scaling 1
    apply_sysctl net.core.rmem_max 33554432
    apply_sysctl net.core.wmem_max 33554432
    apply_sysctl net.ipv4.tcp_rmem "4096 87380 33554432"
    apply_sysctl net.ipv4.tcp_wmem "4096 16384 33554432"
    
    # Congestion Control (BBR preferred)
    if grep -q "bbr" /proc/sys/net/ipv4/tcp_available_congestion_control; then
        apply_sysctl net.ipv4.tcp_congestion_control bbr
    fi
    
    # MTU Optimization for WireGuard
    if ip link show "$INTERFACE" > /dev/null 2>&1; then
        ip link set dev $INTERFACE mtu 1420
        log "Interface $INTERFACE: MTU set to 1420"
    fi

elif [ "$PROFILE" = "auto" ]; then
    log "Auto-Optimization based on Heuristics..."
    # Fallback to Gaming for now if speedtest is slow
    /usr/local/bin/wg-optimize.sh gaming

elif [ "$PROFILE" = "default" ] || [ "$PROFILE" = "disable" ]; then
    log "Resetting to defaults..."
    apply_sysctl net.ipv4.tcp_low_latency 0
    apply_sysctl net.ipv4.tcp_fastopen 1
    apply_sysctl net.core.netdev_max_backlog 1000
    
    if ip link show "$INTERFACE" > /dev/null 2>&1; then
        ip link set dev $INTERFACE txqueuelen 1000
    fi
    rm -f "$STATE_FILE"
    log "Default profile applied"
fi

log "Optimization complete."

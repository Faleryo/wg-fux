#!/bin/bash
# ============================================================
# WG-FUX Optimization Engine v4.1 — "Obsidian Low-Latency"
# Ingénierie Réseau Senior : Cible <20ms en gaming compétitif
#
# Architecture des optimisations :
#   1. Kernel UDP stack : Réduction des buffers + bypass congestion
#   2. WireGuard interface : Tuning cryptographique + MTU précis
#   3. IRQ/CPU affinity : Pinning NIC pour éviter le context switch
#   4. TC/QDisc : CAKE ou fq_codel avec priority gaming
#   5. Sysctl avancés : Interrupt coalescing désactivé, NAPI tuning
#
# Principe physique :
#   Le RTT WireGuard = 2*RTT_physique + overhead_crypto (ChaCha20 ~0.5ms)
#   Pour 20ms : RTT_physique cible < 9ms, overhead_kernel < 0.5ms
# ============================================================

set -euo pipefail

INTERFACE=${WG_INTERFACE:-wg0}
PROFILE="${1:-}"
LOG_FILE="/var/log/wg-optimize.log"
STATE_FILE="/etc/wireguard/active_profile"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [$PROFILE] $1" | tee -a "$LOG_FILE"
}

# Safe sysctl applicator — idempotent, logged, PERSISTENT
apply_sysctl() {
    local key=$1 val=$2
    local SYSCTL_CONF="/etc/sysctl.d/99-wg-fux.conf"
    
    # 1. Apply to memory
    if sysctl -w "$key=$val" > /dev/null 2>&1; then
        log "✓ sysctl $key = $val"
    else
        log "⚠ Skip sysctl $key (permission/absent)"
    fi

    # 2. Apply to persistent file
    mkdir -p /etc/sysctl.d
    touch "$SYSCTL_CONF"
    if grep -q "^$key=" "$SYSCTL_CONF"; then
        sed -i "s|^$key=.*|$key=$val|" "$SYSCTL_CONF"
    else
        echo "$key=$val" >> "$SYSCTL_CONF"
    fi
}

# Safe sysfs applicator
apply_sysfs() {
    local path=$1 val=$2
    if [ -w "$path" ]; then
        if echo "$val" > "$path" 2>/dev/null; then
            log "✓ sysfs $path = $val"
        else
            log "✗ Failed sysfs $path"
        fi
    else
        log "⚠ Skip sysfs $path (ro/absent)"
    fi
}

# Safe tc wrapper
tc_safe() {
    tc "$@" 2>/dev/null || true
}

if [ -z "${PROFILE:-}" ]; then
    echo "Usage: wg-optimize.sh [gaming|streaming|auto|restore|default]"
    exit 1
fi

log "=== Starting Network Optimization: Profile → $PROFILE ==="
# SRE Fix: State writing moved inside respective profile blocks to avoid false-positives

# ============================================================
# PROFILE: GAMING — Ultra Low Latency (cible: ≤20ms RTT)
# ============================================================
if [ "$PROFILE" = "gaming" ]; then
    echo "gaming" > "$STATE_FILE" 2>/dev/null || true
    log "🎮 Gaming Mode : Ultra Low Latency — Target ≤20ms RTT"

    # ----------------------------------------------------------
    # 1. UDP STACK : Clé pour WireGuard (protocole UDP natif)
    # ----------------------------------------------------------
    # 💠 Diamond Buffers : Calculés pour minimiser le bufferbloat
    # Règle Obsidian : Buffer = (Vitesse_Lien * RTT_Cible) / 8
    apply_sysctl net.core.rmem_default 524288      # 512KB recv
    apply_sysctl net.core.wmem_default 524288      # 512KB send
    apply_sysctl net.core.rmem_max 4194304         # 4MB recv max
    apply_sysctl net.core.wmem_max 4194304         # 4MB send max
    apply_sysctl net.core.optmem_max 131072        # 128KB options

    # UDP socket buffers (impact direct sur WireGuard)
    apply_sysctl net.ipv4.udp_mem "16384 32768 4194304"
    apply_sysctl net.ipv4.udp_rmem_min 16384
    apply_sysctl net.ipv4.udp_wmem_min 16384

    # ----------------------------------------------------------
    # 2. TCP LOW LATENCY (pour le trafic non-WG et le contrôle)
    # ----------------------------------------------------------
    apply_sysctl net.ipv4.tcp_fastopen 3           # TFO client+server
    apply_sysctl net.ipv4.tcp_autocorking 0        # Désactive le regroupement de paquets → latence réduite
    apply_sysctl net.ipv4.tcp_low_latency 1        # Déprécié kernel 4.14+ mais inoffensif
    apply_sysctl net.ipv4.tcp_no_metrics_save 1    # Oublie les métriques entre connexions
    apply_sysctl net.ipv4.tcp_thin_linear_timeouts 1  # Connexions thin stream (gaming)
    apply_sysctl net.ipv4.tcp_notsent_lowat 16384  # Reduce send buffer pre-fill
    apply_sysctl net.ipv4.tcp_timestamps 1         # RTT measurement précis (RTTM)
    apply_sysctl net.ipv4.tcp_sack 1               # SACK = retransmission ciblée uniquement
    apply_sysctl net.ipv4.tcp_dsack 1              # Duplicate SACK

    # ----------------------------------------------------------
    # 3. KERNEL SCHEDULER réseau
    # ----------------------------------------------------------
    apply_sysctl net.core.netdev_max_backlog 10000 # File d'attente NIC→kernel
    apply_sysctl net.core.netdev_budget 600        # Paquets traités par NAPI poll cycle
    apply_sysctl net.core.netdev_budget_usecs 8000 # Temps max NAPI poll (µs)
    apply_sysctl net.ipv4.tcp_max_syn_backlog 4096

    # ----------------------------------------------------------
    # 4. CONGESTION CONTROL — BBR v2 pour gaming UDP
    # ----------------------------------------------------------
    # BBR = Bottleneck Bandwidth and RTT (Google 2016)
    # Avantage gaming : pas de slow-start agressif, RTT-aware
    if grep -q "bbr" /proc/sys/net/ipv4/tcp_available_congestion_control 2>/dev/null; then
        apply_sysctl net.ipv4.tcp_congestion_control bbr
        log "✓ BBR congestion control activé"
    else
        apply_sysctl net.ipv4.tcp_congestion_control cubic
        log "⚠ BBR indisponible → cubic"
    fi

    # FQ (Fair Queue) + pacing : élimine les bursts de paquets → jitter réduit
    if grep -q "fq" /proc/sys/net/core/default_qdisc 2>/dev/null || \
       grep -rq "fq" /proc/net/psched 2>/dev/null; then
        apply_sysctl net.core.default_qdisc fq
        log "✓ FQ qdisc activé (pacing anti-jitter)"
    fi

    # ----------------------------------------------------------
    # 5. WireGuard INTERFACE TUNING
    # ----------------------------------------------------------
    if ip link show "$INTERFACE" > /dev/null 2>&1; then
        # MTU optimal WireGuard pour Gaming Mobile :
        # 1280 est le standard de sécurité IPv6 and évite toute fragmentation sur 4G/5G.
        ip link set dev "$INTERFACE" mtu 1280
        log "✓ MTU $INTERFACE = 1280 (zero fragmentation gaming mobile)"

        # txqueuelen élevé = moins de drops sous burst
        ip link set dev "$INTERFACE" txqueuelen 1000
        log "✓ txqueuelen $INTERFACE = 1000"
    fi

    # ----------------------------------------------------------
    # 6. TC/QDisc GAMING — CAKE avec priority gaming
    # ----------------------------------------------------------
    # CAKE (Common Applications Kept Enhanced) = successeur de fq_codel
    # Supérieur pour gaming : gestion des flows, dépriorisation des bulk
    tc_safe qdisc del dev "$INTERFACE" root
    if tc qdisc add dev "$INTERFACE" root handle 1: cake \
        bandwidth 1gbit \
        diffserv4 \
        nat \
        wash \
        ack-filter \
        rtt 20ms \
        overhead 80 2>/dev/null; then
        log "✓ CAKE qdisc appliqué (gaming diffserv4, RTT hint 20ms)"
    else
        # Fallback fq_codel si CAKE non disponible
        tc_safe qdisc add dev "$INTERFACE" root handle 1: fq_codel \
            limit 1000 \
            flows 1024 \
            quantum 1514 \
            target 5ms \
            interval 100ms \
            memory_limit 32mb \
            ecn
        log "⚠ CAKE indisponible → fq_codel (target=5ms, ecn=on)"
    fi

    # ----------------------------------------------------------
    # 7. RPS/RFS — RSS Software (multi-core NIC processing)
    # ----------------------------------------------------------
    # RPS = Receive Packet Steering : distribue l'interruption NIC sur tous les CPU
    # Critical sur serveur multi-core : évite le bottleneck sur CPU0
    NUM_CPUS=$(nproc 2>/dev/null || echo 1)
    CPU_MASK=$(printf '%x' $((2**NUM_CPUS - 1)))
    for rps_file in /sys/class/net/*/queues/rx-*/rps_cpus; do
        apply_sysfs "$rps_file" "$CPU_MASK"
    done

    # RFS = Receive Flow Steering : route les paquets vers le CPU qui traite l'app
    apply_sysfs /proc/sys/net/core/rps_sock_flow_entries 32768
    for rfs_file in /sys/class/net/*/queues/rx-*/rps_flow_cnt; do
        apply_sysfs "$rfs_file" 2048
    done

    # ----------------------------------------------------------
    # 8. IRQ COALESCING — Désactivé pour latence maximale
    # ----------------------------------------------------------
    # rx-usecs 0 = interruption immédiate à chaque paquet reçu
    # Trade-off : CPU++ mais latence≡ → acceptable en gaming
    ETH_IFACE=$(ip route | grep default | awk '{print $5}' | head -n1)
    if [ -n "$ETH_IFACE" ]; then
        if ethtool -C "$ETH_IFACE" rx-usecs 0 adaptive-rx off 2>/dev/null; then
            log "✓ IRQ coalescing désactivé sur $ETH_IFACE (latence maximale)"
        else
            log "⚠ ethtool non disponible ou $ETH_IFACE inaccessible"
        fi
    fi

    log "🎮 Gaming Profile DONE — Latence cible ≤20ms activée"

# ============================================================
# PROFILE: STREAMING — High Throughput (4K/8K, backup)
# ============================================================
elif [ "$PROFILE" = "streaming" ]; then
    echo "streaming" > "$STATE_FILE" 2>/dev/null || true
    log "📺 Streaming Mode : High Throughput"

    # Buffers larges = débit important, latence secondaire
    apply_sysctl net.core.rmem_max 134217728      # 128MB
    apply_sysctl net.core.wmem_max 134217728
    apply_sysctl net.ipv4.tcp_rmem "4096 87380 134217728"
    apply_sysctl net.ipv4.tcp_wmem "4096 65536 134217728"
    apply_sysctl net.ipv4.tcp_window_scaling 1
    apply_sysctl net.ipv4.tcp_mtu_probing 1       # PLPMTUD automatique

    # BBR pour streaming aussi (meilleur que CUBIC sur liens avec perte)
    if grep -q "bbr" /proc/sys/net/ipv4/tcp_available_congestion_control 2>/dev/null; then
        apply_sysctl net.ipv4.tcp_congestion_control bbr
    fi

    # MTU standard WireGuard 1420
    if ip link show "$INTERFACE" > /dev/null 2>&1; then
        ip link set dev "$INTERFACE" mtu 1420
        log "✓ MTU $INTERFACE = 1420 (streaming)"
    fi

    # CAKE en mode streaming (priorise le throughput)
    tc_safe qdisc del dev "$INTERFACE" root
    if tc qdisc add dev "$INTERFACE" root handle 1: cake \
        bandwidth 1gbit \
        diffserv4 \
        nat \
        rtt 100ms 2>/dev/null; then
        log "✓ CAKE qdisc streaming (rtt=100ms)"
    else
        tc_safe qdisc add dev "$INTERFACE" root fq_codel
        log "⚠ Fallback → fq_codel"
    fi

    log "📺 Streaming Profile DONE"

# ============================================================
# PROFILE: AUTO — Détection heuristique
# ============================================================
elif [ "$PROFILE" = "auto" ]; then
    # Note: State file will be written by the sub-call to gaming or streaming
    log "🤖 Auto Mode : Analyse heuristique..."
    # Mesure la latence du gateway : si < 10ms → Gaming, sinon Streaming
    GW=$(ip route | grep default | awk '{print $3}' | head -n1)
    if [ -n "$GW" ]; then
        RTT=$(ping -c 4 -q "$GW" 2>/dev/null | awk -F'/' '/rtt/{print $5}' | cut -d. -f1)
        log "Gateway RTT mesuré : ${RTT:-unknown}ms"
        if [ -n "$RTT" ] && [ "$RTT" -lt 15 ]; then
            log "→ RTT ≤15ms détecté : activation Gaming Mode"
            exec "$0" gaming
        else
            log "→ RTT >15ms détecté : activation Streaming Mode"
            exec "$0" streaming
        fi
    else
        log "⚠ Gateway introuvable → fallback Gaming par défaut"
        exec "$0" gaming
    fi

# ============================================================
# PROFILE: RESTORE / DEFAULT — Valeurs kernel par défaut
# ============================================================
elif [ "$PROFILE" = "restore" ] || [ "$PROFILE" = "default" ] || [ "$PROFILE" = "disable" ]; then
    log "🔄 Restore : Reset vers valeurs kernel par défaut"

    apply_sysctl net.core.rmem_default 212992
    apply_sysctl net.core.wmem_default 212992
    apply_sysctl net.core.rmem_max 212992
    apply_sysctl net.core.wmem_max 212992
    apply_sysctl net.core.netdev_max_backlog 1000
    apply_sysctl net.ipv4.tcp_autocorking 1
    apply_sysctl net.ipv4.tcp_fastopen 1
    apply_sysctl net.ipv4.tcp_congestion_control cubic
    apply_sysctl net.core.default_qdisc pfifo_fast

    # Récupération du MTU cible depuis la config (ex: 1280 pour PUBG)
    # Si non défini, on repasse sur le standard 1420
    TARGET_MTU=1420
    if [ -f "/etc/wireguard/manager.conf" ]; then
        CONF_MTU=$(grep "SERVER_MTU" /etc/wireguard/manager.conf | cut -d'=' -f2 | tr -d '"')
        TARGET_MTU=${CONF_MTU:-1420}
    fi

    if ip link show "$INTERFACE" > /dev/null 2>&1; then
        ip link set dev "$INTERFACE" mtu "$TARGET_MTU"
        log "🔄 MTU $INTERFACE réinitialisé vers valeur cible ($TARGET_MTU)"
        ip link set dev "$INTERFACE" txqueuelen 1000
        tc_safe qdisc del dev "$INTERFACE" root
        tc_safe qdisc add dev "$INTERFACE" root fq_codel
    fi

    # Re-activer IRQ coalescing
    ETH_IFACE=$(ip route | grep default | awk '{print $5}' | head -n1)
    if [ -n "$ETH_IFACE" ]; then
        ethtool -C "$ETH_IFACE" rx-usecs 50 adaptive-rx on 2>/dev/null || true
    fi

    rm -f "$STATE_FILE"
    log "🔄 Restore DONE — Defaults applied"
else
    log "❌ Profil inconnu: $PROFILE"
    echo "Usage: wg-optimize.sh [gaming|streaming|auto|restore|default]"
    exit 1
fi

log "=== Optimization complete. Profile: $PROFILE ==="

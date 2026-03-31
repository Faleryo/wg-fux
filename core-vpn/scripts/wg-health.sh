#!/bin/bash
IFACE=$(ip route get 8.8.8.8 2>/dev/null | grep -Po '(?<=dev )[^ ]+' | head -1 || ip -4 route ls | grep default | grep -Po '(?<=dev )[^ ]+' | head -1)
echo "=== Interface Physique: $IFACE ==="

if command -v ethtool >/dev/null; then
    echo "--- Ring Buffer (Hardware) ---"
    ethtool -g $IFACE | grep -A 5 "Current"
    echo ""
    echo "--- Compteurs d'Erreurs (Non-Zero) ---"
    ethtool -S $IFACE 2>/dev/null | grep -E "miss|drop|fifo|error|discards" | grep -v ": 0" || echo "Aucune erreur détectée."
fi

echo ""
echo "--- Latency Tuning (Busy Polling) ---"
BUSY_READ=$(sysctl -n net.core.busy_read 2>/dev/null || echo 0)
BUSY_POLL=$(sysctl -n net.core.busy_poll 2>/dev/null || echo 0)
echo "Busy Read: $BUSY_READ us"
echo "Busy Poll: $BUSY_POLL us"
if [ "$BUSY_POLL" -gt 0 ]; then echo "STATUS: ACTIVÉ (Attention à la charge CPU %sy)"; else echo "STATUS: DÉSACTIVÉ"; fi

echo ""
echo "--- Statistiques OS ---"
ip -s link show $IFACE

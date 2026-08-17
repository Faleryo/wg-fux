#!/bin/bash
set -euo pipefail
IFACE=$(ip route get 8.8.8.8 2>/dev/null | grep -oE 'dev [^ ]+' | head -1 | cut -d' ' -f2 || ip -4 route ls | grep default | grep -oE 'dev [^ ]+' | head -1 | cut -d' ' -f2)
IFACE="${IFACE:-unknown}"
echo "=== Interface Physique: $IFACE ==="

if [ -n "$IFACE" ] && [ "$IFACE" != "unknown" ]; then
 if command -v ethtool >/dev/null; then
  echo "--- Ring Buffer (Hardware) ---"
  ethtool -g "$IFACE" | grep -A 5 "Current"
  echo ""
  echo "--- Compteurs d'Erreurs (Non-Zero) ---"
  ethtool -S "$IFACE" 2>/dev/null | grep -E "miss|drop|fifo|error|discards" | grep -v ": 0" || echo "Aucune erreur détectée."
 fi

 echo ""
 # Busy polling ne concerne que les sockets lues par une application locale ;
 # le trafic VPN est forwardé et n'en bénéficie pas. On l'affiche donc comme
 # une anomalie à corriger, pas comme un réglage de latence.
 echo "--- Busy Polling (doit rester à 0 sur un relais) ---"
 BUSY_READ=$(sysctl -n net.core.busy_read 2>/dev/null || echo 0)
 BUSY_POLL=$(sysctl -n net.core.busy_poll 2>/dev/null || echo 0)
 echo "Busy Read: $BUSY_READ us"
 echo "Busy Poll: $BUSY_POLL us"
 if [ "$BUSY_POLL" -gt 0 ] || [ "$BUSY_READ" -gt 0 ]; then
  echo "STATUS: ACTIVÉ — sans effet sur du trafic forwardé, coûte du CPU. À remettre à 0."
 else
  echo "STATUS: DÉSACTIVÉ (attendu)"
 fi

 echo ""
 echo "--- Statistiques OS ---"
 ip -s link show "$IFACE"
else
 echo "No network interface detected. Skipping hardware diagnostics."
fi

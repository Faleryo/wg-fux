#!/bin/bash
# Vérifie que wg-latency-bench.py DÉTECTE réellement le bufferbloat.
#
# Un banc de mesure qui ne distingue pas une file saine d'une file noyée ne
# mesure rien. On le confronte donc à deux goulots de 50 Mbit/s identiques, dans
# une paire de namespaces réseau :
#
#   1. tbf avec ~3 Mo de file FIFO   → bufferbloat volontaire (~475 ms de tampon)
#   2. cake, la chaîne de production → AQM
#
# Attendu : plusieurs dizaines de ms ajoutées dans le cas 1, quelques ms au plus
# dans le cas 2. Si les deux se ressemblent, le banc est cassé.
#
# Ne demande PAS les droits root : tout se passe dans un namespace utilisateur.
#   ./scripts/verify-latency-bench.sh
set -u

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
BENCH="${SCRIPT_DIR}/../core-vpn/scripts/wg-latency-bench.py"

if [ ! -f "$BENCH" ]; then
  echo "wg-latency-bench.py introuvable ($BENCH)" >&2
  exit 1
fi

if [ "${_DANS_NETNS:-0}" != "1" ]; then
  command -v unshare >/dev/null || { echo "unshare requis" >&2; exit 1; }
  ip link add _probe_ type dummy 2>/dev/null && ip link del _probe_ 2>/dev/null
  exec env _DANS_NETNS=1 unshare -rnm --propagation private bash "$0" "$@"
fi

set -e
mkdir -p /run/netns 2>/dev/null || true
mount -t tmpfs none /run/netns 2>/dev/null || true
ip netns add B

ip link add veth0 type veth peer name veth1
ip link set veth1 netns B
ip addr add 10.9.9.1/24 dev veth0
ip link set veth0 up
ip link set lo up
ip netns exec B ip addr add 10.9.9.2/24 dev veth1
ip netns exec B ip link set veth1 up
ip netns exec B ip link set lo up
set +e

# Le serveur vit dans B : la charge « down » va donc B → A et le goulot se place
# sur l'egress de veth1 — l'équivalent de l'egress de wg0, là où CAKE agit.
ip netns exec B python3 "$BENCH" serveur --port 51999 >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 2

DUREE="${DUREE:-6}"
RESULTATS=""

mesure() {
  local nom="$1"; shift
  ip netns exec B tc qdisc del dev veth1 root 2>/dev/null
  ip netns exec B tc qdisc add dev veth1 root "$@" || {
    echo "!! pose du qdisc impossible pour $nom" >&2; return 1
  }
  echo "### $nom"
  ip netns exec B tc qdisc show dev veth1 | head -1
  local sortie
  sortie=$(python3 "$BENCH" client --hote 10.9.9.2 --port 51999 \
             --duree "$DUREE" --montee 2 --flux 4 --json 2>/dev/null)
  local delta
  delta=$(printf '%s' "$sortie" | python3 -c \
    "import json,sys; print(round(json.load(sys.stdin)['bufferbloat_p99_ms'],1))")
  echo "    latence ajoutée sous charge (p99) : ${delta} ms"
  echo
  RESULTATS="${RESULTATS}${nom}=${delta} "
}

mesure "FIFO-enorme"    tbf rate 50mbit burst 32kb limit 3000000
mesure "CAKE-besteffort" cake bandwidth 50mbit besteffort nowash no-ack-filter \
                              dual-dsthost split-gso overhead 80 rtt 100ms

FIFO=$(printf '%s' "$RESULTATS" | tr ' ' '\n' | grep '^FIFO' | cut -d= -f2)
CAKE=$(printf '%s' "$RESULTATS" | tr ' ' '\n' | grep '^CAKE' | cut -d= -f2)

echo "── Verdict ─────────────────────────────────────────"
python3 - "$FIFO" "$CAKE" <<'EOF'
import sys
fifo, cake = float(sys.argv[1]), float(sys.argv[2])
print(f"  FIFO énorme    : {fifo:+7.1f} ms")
print(f"  CAKE besteffort: {cake:+7.1f} ms")
if fifo < 20:
    print("\nÉCHEC : le goulot FIFO n'a pas produit de bufferbloat mesurable.")
    print("        Charge insuffisante, ou le banc ne mesure pas sous charge.")
    sys.exit(1)
if cake > 20:
    print("\nÉCHEC : CAKE n'a pas contenu la file. Chaîne de paramètres à revoir.")
    sys.exit(1)
if fifo <= cake * 5:
    print("\nÉCHEC : le banc ne sépare pas les deux configurations.")
    sys.exit(1)
print(f"\nOK — le banc sépare les deux goulots (facteur {fifo/max(cake,0.1):.0f}×).")
EOF

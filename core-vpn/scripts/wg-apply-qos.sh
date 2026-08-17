#!/bin/bash
# --- : QoS Enforcer v6.4 (SRE) ---
# Sole owner of the wg0 qdisc tree:
#   HTB root → default class 1:9999 (leaf = CAKE/fq_codel) → per-client classes
#
# Idempotent: short-circuits with a state fingerprint when nothing changed,
# avoiding the wipe-and-rebuild micro-glitch on every API call.
#
# CAKE parameters for the default class come from /etc/wireguard/qos.profile,
# written by wg-optimize.sh. Falls back to safe defaults if the file is absent.
#
# Force a full rebuild by exporting WG_QOS_FORCE=1 (used by wg-optimize.sh).
set -euo pipefail

SCRIPT_DIR="$(dirname "$(readlink -f "$0")")"
# shellcheck source=./wg-common.sh
source "$SCRIPT_DIR/wg-common.sh"

WG_INTERFACE=${WG_INTERFACE:-wg0}
TC=$(command -v tc || echo "/sbin/tc")
# Default class ID (Hex 0x9999) to avoid conflict with client IDs
DEFAULT_CLASS="1:9999"

load_config

# Prevent concurrent execution from corrupting the qdisc tree
mkdir -p /var/lock 2>/dev/null || true
exec 9>/var/lock/wg-qos.lock
flock -n 9 || { log_warn "QoS: autre instance en cours, skip."; exit 0; }

# Default-class leaf qdisc params (overridden by wg-optimize profile if active)
CAKE_BANDWIDTH="${UPSTREAM_BANDWIDTH:-10gbit}"
CAKE_RTT="20ms"
CAKE_DIFFSERV="diffserv4"
CAKE_EXTRA="nat wash ack-filter overhead 80"
FQ_TARGET="2ms"
PROFILE="default"
# shellcheck source=/dev/null
[ -f /etc/wireguard/qos.profile ] && source /etc/wireguard/qos.profile

# ─────────────────────────────────────────────────────────────────────────────
# RTT ADAPTATIF — mesure le trajet RÉEL vers les peers connectés.
#
# POURQUOI : le paramètre `rtt` de CAKE lui indique la latence ATTENDUE du
# chemin, pour dimensionner son AQM (COBALT). Le profil gaming le figeait à
# 20 ms. Mesuré sur cette plateforme : les peers sont à 149, 231 et 349 ms
# (Lomé ↔ Francfort). Annoncer 20 ms sur un trajet de 150 ms rend l'AQM
# BEAUCOUP trop agressif : il marque et jette des paquets simplement « en vol »
# sur la distance, ce qui provoque des retransmissions — donc AUGMENTE la
# latence utile au lieu de la réduire.
#
# On mesure quelques peers actifs et on retient la MÉDIANE (robuste aux
# valeurs aberrantes d'un mobile en veille), bornée pour rester saine.
measure_path_rtt() {
 command -v ping >/dev/null 2>&1 || return 1
 local ips rtts=() ip r
 # Peers ayant échangé récemment (handshake < 5 min), 5 au maximum : la mesure
 # doit rester rapide, elle tourne à chaque reconstruction de l'arbre.
 ips=$(wg show "$WG_INTERFACE" allowed-ips 2>/dev/null | awk '{print $2}' | cut -d/ -f1 | head -5)
 [ -n "$ips" ] || return 1
 for ip in $ips; do
  r=$(ping -c 2 -i 0.2 -W 1 "$ip" 2>/dev/null | awk -F/ '/rtt|round-trip/{printf "%.0f", $5}')
  [ -n "$r" ] && [ "$r" -gt 0 ] 2>/dev/null && rtts+=("$r")
 done
 [ "${#rtts[@]}" -gt 0 ] || return 1
 # Médiane
 local sorted median
 sorted=$(printf '%s\n' "${rtts[@]}" | sort -n)
 median=$(echo "$sorted" | awk '{a[NR]=$1} END{print (NR%2)? a[(NR+1)/2] : int((a[NR/2]+a[NR/2+1])/2)}')
 # Bornes : en deçà de 20 ms l'AQM devient inutilement nerveux, au-delà de
 # 400 ms il ne réagirait plus assez vite.
 [ "$median" -lt 20 ] && median=20
 [ "$median" -gt 400 ] && median=400
 echo "${median}ms"
}

# `auto` dans le profil (ou RTT figé très bas alors que les peers sont loin)
# → on mesure. Sinon on respecte la valeur explicite de l'opérateur.
if [ "${CAKE_RTT:-}" = "auto" ] || [ "${WG_QOS_RTT_AUTO:-1}" = "1" ]; then
 MEASURED_RTT="$(measure_path_rtt || true)"
 if [ -n "${MEASURED_RTT:-}" ]; then
  [ "$MEASURED_RTT" != "$CAKE_RTT" ] && \
   log_info "QoS: RTT mesuré sur le chemin = $MEASURED_RTT (profil annonçait ${CAKE_RTT:-n/a})"
  CAKE_RTT="$MEASURED_RTT"
 fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# BANDE PASSANTE — CAKE ne combat le bufferbloat que s'il EST le goulot
# d'étranglement. À `10gbit` (valeur par défaut jamais ajustée), son limiteur
# ne s'active jamais : aucune protection. On déduit la capacité réelle du lien
# physique quand elle est lisible, et on garde 90 % de marge.
if [ "$CAKE_BANDWIDTH" = "10gbit" ] || [ -z "$CAKE_BANDWIDTH" ]; then
 ETH=$(ip route show default 2>/dev/null | awk '/default/{print $5; exit}')
 LINK_MBIT=$(cat "/sys/class/net/${ETH:-eth0}/speed" 2>/dev/null || echo "")
 if [ -n "$LINK_MBIT" ] && [ "$LINK_MBIT" -gt 0 ] 2>/dev/null; then
  CAKE_BANDWIDTH="$(( LINK_MBIT * 90 / 100 ))mbit"
  log_info "QoS: bande passante déduite du lien ${ETH} (${LINK_MBIT}Mb/s) → $CAKE_BANDWIDTH"
 else
  log_warn "QoS: bande passante à 10gbit — le limiteur NE s'active PAS. Renseignez UPSTREAM_BANDWIDTH (~90% du débit réel) pour activer l'anti-bufferbloat."
 fi
fi

# Check if interface exists (to avoid errors in manual tests or containers)
if ! ip link show "$WG_INTERFACE" > /dev/null 2>&1; then
 log_warn "QoS: Interface $WG_INTERFACE introuvable. Skip."
 exit 0
fi

# ─── Idempotency: fingerprint of desired state ─────────────────────────────
# Captures every input that would change the tree: per-client (limit, IPs)
# AND the profile params. If unchanged AND the tree exists → skip rebuild.
STATE_FILE="/etc/wireguard/qos.state"
compute_desired_state() {
 # Format: "<container>/<name>:<classid>:<ipv4>:<ipv6>:<limit>" sorted
  find /etc/wireguard/clients -name "upload_limit" -print0 2>/dev/null | while IFS= read -r -d '' limit_file; do
   LIMIT=$(tr -d '[:space:]' < "$limit_file" 2>/dev/null || echo "")
  [[ "$LIMIT" =~ ^[0-9]+$ ]] && [ "$LIMIT" -gt 0 ] || continue
  CLIENT_DIR=$(dirname "$limit_file")
  NAME=$(basename "$CLIENT_DIR")
  CONTAINER=$(basename "$(dirname "$CLIENT_DIR")")
  CONF_FILE="$CLIENT_DIR/$NAME.conf"
  [ -f "$CONF_FILE" ] || continue
  ADDRESS_LINE=$(grep '^Address' "$CONF_FILE" | cut -d= -f2)
  IPV4=$(echo "$ADDRESS_LINE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
  IPV6=$(echo "$ADDRESS_LINE" | grep -oE '[a-fA-F0-9:]+:[a-fA-F0-9:]+' | head -1 || true)
  [ -n "$IPV4" ] || continue
  ID=$(echo "$IPV4" | awk -F. '{print ($3 * 256) + $4}')
  CLASSID=$(printf "1:%x" "$ID")
  echo "$CONTAINER/$NAME:$CLASSID:$IPV4:$IPV6:$LIMIT"
  done | LC_ALL=C sort
  # Ensure the pipeline always returns success even if find finds nothing
  return 0
}

PROFILE_HASH=""
if [ -f /etc/wireguard/qos.profile ]; then
 PROFILE_HASH=$(md5sum /etc/wireguard/qos.profile 2>/dev/null | cut -d' ' -f1)
fi
DESIRED_STATE=$(compute_desired_state)
FINGERPRINT="profile:${PROFILE_HASH}|state:$(echo -n "$DESIRED_STATE" | md5sum | cut -d' ' -f1)"
PREV_FINGERPRINT=$(cat "$STATE_FILE" 2>/dev/null || echo "")

# Tree-presence check (HTB root exists)
TREE_PRESENT=false
if "$TC" qdisc show dev "$WG_INTERFACE" 2>/dev/null | grep -q "qdisc htb 1:"; then
 TREE_PRESENT=true
fi

if [ "${WG_QOS_FORCE:-}" != "1" ] \
 && [ "$FINGERPRINT" = "$PREV_FINGERPRINT" ] \
 && [ "$TREE_PRESENT" = "true" ]; then
 log_info "QoS: state unchanged (profile=$PROFILE, $(echo "$DESIRED_STATE" | grep -c . || true) clients) — skip rebuild"
 exit 0
fi

# Nettoyage des règles existantes (state changed or tree missing — full rebuild)
"$TC" qdisc del dev "$WG_INTERFACE" root 2>/dev/null || true
"$TC" qdisc del dev "$WG_INTERFACE" ingress 2>/dev/null || true

# 1. Egress (Download pour le client: Server → Client)
# Racine HTB
"$TC" qdisc add dev "$WG_INTERFACE" root handle 1: htb default 9999 r2q 50
# Classe par défaut (illimitée / 10Gbps).
# quantum explicite : sans lui, HTB dérive quantum = rate/r2q = énorme pour 10gbit
# → "sch_htb: quantum of class ... is big". 200000 = max sous le seuil d'alerte.
"$TC" class add dev "$WG_INTERFACE" parent 1: classid $DEFAULT_CLASS htb rate 10000mbit quantum 200000
# CAKE > fq_codel for gaming/streaming : flow management + AQM + anti-bufferbloat.
# Params from /etc/wireguard/qos.profile (set by wg-optimize.sh), fallback to safe defaults.
# shellcheck disable=SC2086
if "$TC" qdisc add dev "$WG_INTERFACE" parent "$DEFAULT_CLASS" handle 9998: cake \
 bandwidth "$CAKE_BANDWIDTH" \
 "$CAKE_DIFFSERV" \
 $CAKE_EXTRA \
 rtt "$CAKE_RTT" 2>/dev/null; then
 log_info "QoS: CAKE appliqué (profile=$PROFILE, bandwidth=$CAKE_BANDWIDTH, rtt=$CAKE_RTT, $CAKE_DIFFSERV)"
else
 "$TC" qdisc add dev "$WG_INTERFACE" parent "$DEFAULT_CLASS" handle 9998: fq_codel \
 limit 1000 \
 flows 1024 \
 quantum 1514 \
 target "$FQ_TARGET" \
 interval 100ms \
 memory_limit 8mb \
 ecn
 log_warn "QoS: CAKE indisponible → fq_codel (profile=$PROFILE, target=$FQ_TARGET)"
fi

# 2. Ingress (Upload pour le client: Client -> Server)
"$TC" qdisc add dev "$WG_INTERFACE" handle ffff: ingress

find /etc/wireguard/clients -name "upload_limit" -print0 2>/dev/null | while IFS= read -r -d '' limit_file; do
  LIMIT=$(tr -d '[:space:]' < "$limit_file")
  # Check if limit is valid integer > 0
 if [[ "$LIMIT" =~ ^[0-9]+$ ]] && [ "$LIMIT" -gt 0 ]; then
 CLIENT_DIR=$(dirname "$limit_file")
 CONF_FILE=$(find "$CLIENT_DIR" -maxdepth 1 -name "*.conf" | head -n 1)
 if [ -f "$CONF_FILE" ]; then
 # Extract IPs from Address line
 # Example: Address = 10.0.0.2/32, fd42::2/128
 ADDRESS_LINE=$(grep "^Address" "$CONF_FILE" | cut -d= -f2)

 # Extract IPv4 (First match of x.x.x.x)
 IPV4=$(echo "$ADDRESS_LINE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)

 # Extract IPv6 (First match containing colons)
 IPV6=$(echo "$ADDRESS_LINE" | grep -oE '[a-fA-F0-9:]+:[a-fA-F0-9:]+' | head -1 || true)

 if [ -n "$IPV4" ]; then
 # Use both 3rd and 4th octet to prevent collision across subnets
 # (Octet3 * 256) + Octet4 guarantees uniqueness within any /16 subnet
 ID=$(echo "$IPV4" | awk -F. '{print ($3 * 256) + $4}')

 if [ -n "$ID" ]; then
 # Class ID formatted as hex for better tc compatibility
  CLASSID=$(printf "1:%x" "$ID")

 # --- DOWNLOAD LIMIT (Egress) ---
 # Create class for this client (ignore if already exists, then just set rate)
 "$TC" class add dev "$WG_INTERFACE" parent 1: classid "$CLASSID" htb rate "${LIMIT}mbit" ceil "${LIMIT}mbit" 2>/dev/null || \
 "$TC" class change dev "$WG_INTERFACE" parent 1: classid "$CLASSID" htb rate "${LIMIT}mbit" ceil "${LIMIT}mbit"

 # Filter IPv4
 "$TC" filter add dev "$WG_INTERFACE" protocol ip parent 1:0 prio 1 u32 match ip dst "$IPV4" flowid "$CLASSID" 2>/dev/null || true

 # Filter IPv6
 if [ -n "$IPV6" ]; then
 "$TC" filter add dev "$WG_INTERFACE" protocol ipv6 parent 1:0 prio 1 u32 match ip6 dst "$IPV6" flowid "$CLASSID" 2>/dev/null || true
 fi

 # --- UPLOAD LIMIT (Ingress Policing) ---
 # IPv4
 "$TC" filter add dev "$WG_INTERFACE" parent ffff: protocol ip prio 1 u32 match ip src "$IPV4" police rate "${LIMIT}mbit" burst 100k drop flowid :1 2>/dev/null || true

 # IPv6
 if [ -n "$IPV6" ]; then
 "$TC" filter add dev "$WG_INTERFACE" parent ffff: protocol ipv6 prio 1 u32 match ip6 src "$IPV6" police rate "${LIMIT}mbit" burst 100k drop flowid :1 2>/dev/null || true
 fi
 fi
 fi
 fi
 fi
done

# Persist the fingerprint so the next invocation can short-circuit.
mkdir -p "$(dirname "$STATE_FILE")"
echo "$FINGERPRINT" > "$STATE_FILE"
log_info "QoS: tree rebuilt and fingerprint saved ($(echo "$DESIRED_STATE" | grep -c . || true) clients with limits)"
exit 0

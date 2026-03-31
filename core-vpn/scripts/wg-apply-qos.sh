#!/bin/bash
WG_INTERFACE=${WG_INTERFACE:-wg0}
TC=/sbin/tc
# Default class ID (Hex 0x9999) to avoid conflict with client IDs
DEFAULT_CLASS="1:9999"

if [ -f /etc/wireguard/manager.conf ]; then source /etc/wireguard/manager.conf; fi

# Check if interface exists (to avoid errors in manual tests or containers)
if ! ip link show "$WG_INTERFACE" > /dev/null 2>&1; then
    exit 0
fi


# Nettoyage des règles existantes
$TC qdisc del dev $WG_INTERFACE root 2>/dev/null
$TC qdisc del dev $WG_INTERFACE ingress 2>/dev/null

# 1. Egress (Download pour le client: Server -> Client)
# Racine HTB
$TC qdisc add dev $WG_INTERFACE root handle 1: htb default 9999 r2q 50
# Classe par défaut (illimitée / 10Gbps)
$TC class add dev $WG_INTERFACE parent 1: classid $DEFAULT_CLASS htb rate 10000mbit
# Ajout de fq_codel pour la classe par défaut (Réduit le bufferbloat et améliore la latence)
$TC qdisc add dev $WG_INTERFACE parent $DEFAULT_CLASS handle 9998: fq_codel

# 2. Ingress (Upload pour le client: Client -> Server)
$TC qdisc add dev $WG_INTERFACE handle ffff: ingress

find /etc/wireguard/clients -name "upload_limit" 2>/dev/null | while read limit_file; do
    LIMIT=$(cat "$limit_file")
    # Check if limit is valid integer > 0
    if [[ "$LIMIT" =~ ^[0-9]+$ ]] && [ "$LIMIT" -gt 0 ]; then
        CLIENT_DIR=$(dirname "$limit_file")
        CONF_FILE=$(find "$CLIENT_DIR" -maxdepth 1 -name "*.conf" | head -n 1)
        if [ -f "$CONF_FILE" ]; then
            # Extract IPs from Address line
            # Example: Address = 10.0.0.2/32, fd42::2/128
            ADDRESS_LINE=$(grep "^Address" "$CONF_FILE" | cut -d= -f2)
            
            # Extract IPv4 (First match of x.x.x.x)
            IPV4=$(echo "$ADDRESS_LINE" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+' | head -1)
            
            # Extract IPv6 (First match containing colons)
            IPV6=$(echo "$ADDRESS_LINE" | grep -oE '[a-fA-F0-9:]+:[a-fA-F0-9:]+' | head -1)
            
            if [ -n "$IPV4" ]; then
                # Use both 3rd and 4th octet to prevent collision across subnets
                # (Octet3 * 256) + Octet4 guarantees uniqueness within any /16 subnet
                ID=$(echo "$IPV4" | awk -F. '{print ($3 * 256) + $4}')
                
                if [ -n "$ID" ]; then
                    # Class ID formatted as hex for better tc compatibility
                    CLASSID=$(printf "1:%x" $ID)
                    
                    # --- DOWNLOAD LIMIT (Egress) ---
                    # Create class for this client
                    $TC class add dev $WG_INTERFACE parent 1: classid $CLASSID htb rate ${LIMIT}mbit ceil ${LIMIT}mbit
                    
                    # Filter IPv4
                    $TC filter add dev $WG_INTERFACE protocol ip parent 1:0 prio 1 u32 match ip dst $IPV4 flowid $CLASSID
                    
                    # Filter IPv6
                    if [ -n "$IPV6" ]; then
                         $TC filter add dev $WG_INTERFACE protocol ipv6 parent 1:0 prio 1 u32 match ip6 dst $IPV6 flowid $CLASSID
                    fi
                    
                    # --- UPLOAD LIMIT (Ingress Policing) ---
                    # IPv4
                    $TC filter add dev $WG_INTERFACE parent ffff: protocol ip prio 1 u32 match ip src $IPV4 police rate ${LIMIT}mbit burst 100k drop flowid :1
                    
                    # IPv6
                    if [ -n "$IPV6" ]; then
                        $TC filter add dev $WG_INTERFACE parent ffff: protocol ipv6 prio 1 u32 match ip6 src $IPV6 police rate ${LIMIT}mbit burst 100k drop flowid :1
                    fi
                fi
            fi
        fi
    fi
done
exit 0

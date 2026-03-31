#!/bin/bash
# Security restricted wrapper for wg set
INTERFACE=$1
COMMAND=$2
PEER=$3
ACTION=$4
VALUE=$5

# Validation
if [[ ! "$INTERFACE" =~ ^wg[0-9]+$ ]]; then echo "Error: Invalid interface"; exit 1; fi
if [[ "$COMMAND" != "peer" ]]; then echo "Error: Only 'peer' command allowed"; exit 1; fi
if [[ ! "$PEER" =~ ^[a-zA-Z0-9+/=]+$ ]]; then echo "Error: Invalid peer public key"; exit 1; fi

if [[ "$ACTION" == "remove" ]]; then
    /usr/bin/wg set "$INTERFACE" peer "$PEER" remove || exit 1
elif [[ "$ACTION" == "allowed-ips" ]]; then
    if [[ ! "$VALUE" =~ ^[a-fA-F0-9:.,/\ ]+$ ]]; then echo "Error: Invalid AllowedIPs"; exit 1; fi
    /usr/bin/wg set "$INTERFACE" peer "$PEER" allowed-ips "$VALUE" || exit 1
else
    echo "Error: Unsupported action '$ACTION'"; exit 1; fi

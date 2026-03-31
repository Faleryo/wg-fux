#!/bin/bash
CMD=$1
IFACE=$2
if [ "$CMD" = "show" ]; then
     if [ "$3" = "dump" ]; then
          /usr/bin/wg show "$IFACE" dump || exit 1
     else
          /usr/bin/wg show "$IFACE" || exit 1
     fi
fi

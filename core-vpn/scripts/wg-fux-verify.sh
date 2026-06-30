#!/bin/bash
# wg-fux-verify.sh — Sonde de vérification triviale (provisioning + heartbeat).
#
# Prouve UNIQUEMENT que la chaîne SSH → forced command (dispatch) → sudo (exec)
# fonctionne. Ne teste PAS WireGuard : un VPS fraîchement provisionné n'a pas
# encore de config WG, donc un vrai health-check échouerait légitimement.
# Doit toujours réussir (exit 0) sur un VPS correctement provisionné.

set -euo pipefail

echo "wg-fux-verify ok host=$(hostname) ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
exit 0

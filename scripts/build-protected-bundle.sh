#!/bin/bash
# build-protected-bundle.sh — Fabrique le bundle DURCI distribué aux revendeurs.
#
# À exécuter SUR LA PLATEFORME MÈRE avant un déploiement (elle seule fabrique le
# produit). Produit un tar.gz où :
#   - l'interface est PRÉ-BUILDÉE (dist/ minifié seul — plus aucun JSX lisible) ;
#   - le JS de l'API est OBFUSQUÉ (illisible, mais sémantiquement identique).
# Le client ne reçoit donc jamais ton code propre. C'est un RALENTISSEUR fort
# (pas un coffre-fort : du code qui s'exécute reste décompilable), adossé aux CGU.
#
# Tout tourne dans un conteneur node:20-bookworm → l'hôte n'a besoin que de Docker.
#
# Usage : sudo bash scripts/build-protected-bundle.sh [chemin_sortie.tgz]
#         (défaut : ./protected-bundle/wg-fux-bundle.tgz)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-$REPO_DIR/protected-bundle/wg-fux-bundle.tgz}"
OUT_DIR="$(dirname "$OUT")"
OUT_BASE="$(basename "$OUT")"
NODE_IMAGE="node:20-bookworm"

log() { echo -e "\033[1;36m[bundle]\033[0m $*"; }

command -v docker >/dev/null || { echo "Docker requis." >&2; exit 1; }
mkdir -p "$OUT_DIR"

log "Fabrication du bundle durci depuis ${REPO_DIR} …"

# Le build tourne dans node:20-bookworm. /src = repo (ro), /out = destination.
docker run --rm \
  --ulimit nofile=65536:65536 \
  -v "$REPO_DIR":/src:ro \
  -v "$OUT_DIR":/out \
  -e OUT_BASE="$OUT_BASE" \
  "$NODE_IMAGE" bash -euo pipefail -c '
    export DEBIAN_FRONTEND=noninteractive
    WORK=/work && mkdir -p "$WORK"

    echo "[1/4] Export git HEAD (sans docs/.github/.claude) …"
    git config --global --add safe.directory /src
    git -C /src archive --format=tar --prefix=./ HEAD -- . \
      ":(exclude)docs" ":(exclude).github" ":(exclude).claude" \
      ":(exclude)api-service/obfuscator.config.json" | tar -x -C "$WORK"

    echo "[2/4] Pré-build de l interface (dist minifié) …"
    cd "$WORK/dashboard-ui"
    npm ci --no-audit --no-fund --silent
    npm run build --silent
    # Ne garder que le dist + nginx.conf + un Dockerfile qui SERT (ne build plus).
    mkdir -p /tmp/ui && mv dist /tmp/ui/dist && mv nginx.conf /tmp/ui/nginx.conf
    cd "$WORK" && rm -rf dashboard-ui && mkdir dashboard-ui
    mv /tmp/ui/dist dashboard-ui/dist && mv /tmp/ui/nginx.conf dashboard-ui/nginx.conf
    cat > dashboard-ui/Dockerfile <<DOCKER
FROM nginx:alpine
COPY dashboard-ui/dist /usr/share/nginx/html
COPY dashboard-ui/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
ENTRYPOINT ["nginx", "-g", "daemon off;"]
DOCKER

    echo "[3/4] Obfuscation du JS de l API …"
    npm i -g javascript-obfuscator@4 --silent
    CFG=/tmp/obf.json
    cat > "$CFG" <<JSON
{
  "compact": true,
  "identifierNamesGenerator": "hexadecimal",
  "renameGlobals": false,
  "stringArray": true,
  "stringArrayThreshold": 0.75,
  "stringArrayEncoding": ["base64"],
  "stringArrayRotate": true,
  "stringArrayShuffle": true,
  "controlFlowFlattening": false,
  "deadCodeInjection": false,
  "selfDefending": false,
  "debugProtection": false,
  "transformObjectKeys": false,
  "numbersToExpressions": false,
  "reservedNames": ["^require$", "^module$", "^exports$", "^__dirname$", "^__filename$"]
}
JSON
    for d in src db; do
      javascript-obfuscator "$WORK/api-service/$d" --output "$WORK/api-service/$d.obf" --config "$CFG"
      rm -rf "$WORK/api-service/$d" && mv "$WORK/api-service/$d.obf" "$WORK/api-service/$d"
    done
    javascript-obfuscator "$WORK/api-service/server.js" --output "$WORK/api-service/server.js" --config "$CFG"

    echo "[4/4] Empaquetage …"
    tar -czf "/out/$OUT_BASE" -C "$WORK" .
    echo "OK"
  '

SHA="$(sha256sum "$OUT" | awk '{print $1}')"
SIZE="$(du -h "$OUT" | awk '{print $1}')"
log "Bundle durci : $OUT ($SIZE)"
log "sha256      : $SHA"
log "Vérif rapide : aucun JSX ni secret métier lisible ↓"
if tar -tzf "$OUT" | grep -q 'dashboard-ui/src/'; then
  echo "  ⚠️  ATTENTION : du source JSX est présent dans le bundle !" >&2
else
  echo "  ✅ dashboard-ui/src absent (interface pré-buildée)."
fi

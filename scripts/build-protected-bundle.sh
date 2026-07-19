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
# ⚠️ DOIT rester identique au FROM de api-service/Dockerfile : le bytecode V8
# (.jsc) produit ici n'est chargeable QUE par un Node de version V8 identique.
# Compiler dans l'image runtime exacte garantit la compatibilité. (slim n'a pas
# git → on l'installe dans le conteneur pour `git archive`.)
NODE_IMAGE="node:20-bookworm-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0"

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

    echo "[0/5] Prérequis (git absent de l image slim) …"
    if ! command -v git >/dev/null 2>&1; then
      apt-get update -qq && apt-get install -y -qq --no-install-recommends git >/dev/null
    fi

    echo "[1/5] Export git HEAD (sans docs/.github/.claude) …"
    git config --global --add safe.directory /src
    git -C /src archive --format=tar --prefix=./ HEAD -- . \
      ":(exclude)docs" ":(exclude).github" ":(exclude).claude" \
      ":(exclude)api-service/obfuscator.config.json" | tar -x -C "$WORK"

    echo "[2/5] Pré-build de l interface (dist minifié) …"
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
    # Le dist pré-buildé DOIT entrer dans le contexte de build Docker : on retire
    # toute exclusion de dist du .dockerignore (sinon COPY dashboard-ui/dist échoue).
    if [ -f "$WORK/.dockerignore" ]; then
      sed -i "/dist/d" "$WORK/.dockerignore"
    fi

    echo "[3/5] Obfuscation du JS de l API …"
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

    echo "[4/5] Compilation bytecode V8 (bytenode) par-dessus l obfuscation …"
    # SURCOUCHE : le JS obfusqué de src/ et db/ est compilé en .jsc (bytecode V8),
    # les .js source sont supprimés → le revendeur n exécute que du bytecode. Compilé
    # ICI = dans l image runtime, donc V8 compatible avec le Node qui l exécutera.
    # bytenode est une dépendance de prod (voir api-service/package.json) : npm i -g
    # ici juste pour la COMPILATION, NODE_PATH pour que le script le résolve.
    npm i -g bytenode@1.5.7 --silent
    NODE_PATH="$(npm root -g)" node /src/scripts/bytenode-compile.js \
      "$WORK/api-service/src" "$WORK/api-service/db"
    # server.js reste un .js (garde require.main === module → node server.js démarre) :
    # on lui préfixe le préambule qui enregistre le handler .jsc + le patch de résolution.
    cat /src/scripts/bytenode-loader-preamble.js "$WORK/api-service/server.js" \
      > "$WORK/api-service/server.js.new"
    mv "$WORK/api-service/server.js.new" "$WORK/api-service/server.js"

    echo "[5/5] Empaquetage …"
    tar -czf "/out/$OUT_BASE" -C "$WORK" .
    echo "OK"
  '

SHA="$(sha256sum "$OUT" | awk '{print $1}')"
SIZE="$(du -h "$OUT" | awk '{print $1}')"
log "Bundle durci : $OUT ($SIZE)"
log "sha256      : $SHA"
log "Vérif rapide : aucun JSX ni JS métier lisible ↓"
LISTING="$(tar -tzf "$OUT")"
if grep -q 'dashboard-ui/src/' <<<"$LISTING"; then
  echo "  ⚠️  ATTENTION : du source JSX est présent dans le bundle !" >&2
else
  echo "  ✅ dashboard-ui/src absent (interface pré-buildée)."
fi
# API : plus AUCUN .js sous src/ ou db/ (tout doit être .jsc), et des .jsc présents.
if grep -qE '\./api-service/(src|db)/.*\.js$' <<<"$LISTING"; then
  echo "  ⚠️  ATTENTION : du .js source API subsiste (bytenode a échoué) !" >&2
else
  echo "  ✅ api-service/{src,db} : aucun .js source (bytecode uniquement)."
fi
if grep -qE '\./api-service/(src|db)/.*\.jsc$' <<<"$LISTING"; then
  echo "  ✅ api-service : bytecode .jsc présent."
else
  echo "  ⚠️  ATTENTION : aucun .jsc dans le bundle (compilation manquante) !" >&2
fi

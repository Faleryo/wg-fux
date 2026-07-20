#!/usr/bin/env bash
#
# deploy-mother.sh — Déploiement de la plateforme MÈRE wg-fux
# ============================================================
#
# Encapsule la séquence de déploiement documentée de la plateforme mère.
# Se connecte en SSH sur l'hôte de production, met à jour le dépôt en
# préservant les hotfixes locaux (stash/pop), reconstruit et redémarre
# UNIQUEMENT les services applicatifs `api` et `ui`, puis vérifie la santé.
#
# Principes de sûreté :
#   - set -euo pipefail : on s'arrête au moindre échec.
#   - Confirmation interactive avant toute action distante (sauf --yes).
#   - JAMAIS `docker compose down` : on ne touche pas à nginx/adguard/vpn.
#   - Abandon PROPRE si le `git stash pop` entre en conflit.
#   - N'écrase rien sans que l'opérateur ait vu le diff des commits.
#
# Usage :
#   scripts/deploy-mother.sh [--yes] [--host user@ip] [--path /root/wg-fux]
#
#   --yes           : saute la confirmation interactive (CI / automatisation).
#   --host HOST     : hôte SSH (défaut : $DEPLOY_HOST ou root@46.101.147.28).
#   --path PATH     : chemin du dépôt sur l'hôte (défaut : $REMOTE_REPO ou /root/wg-fux).
#   -h | --help     : affiche cette aide.
#
# Variables d'environnement équivalentes :
#   DEPLOY_HOST, REMOTE_REPO
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (paramètres > env > défauts)
# ---------------------------------------------------------------------------
DEPLOY_HOST="${DEPLOY_HOST:-root@46.101.147.28}"
REMOTE_REPO="${REMOTE_REPO:-/root/wg-fux}"
ASSUME_YES=0

# Hotfixes prod connus, modifiés directement sur la mère (hors git).
# Ils doivent être stashés avant `git pull` puis restaurés après.
# Voir DEPLOY.md pour le contexte de cette dérive et son plan de résorption.
HOTFIX_PATHS=(
  "core-vpn/scripts/wg-init-server.sh"
  "infra/nginx/default.conf"
)

# Services applicatifs à reconstruire/redémarrer. On NE touche PAS aux autres
# services de la stack (nginx, adguard, vpn-internal, certbot).
APP_SERVICES=(api ui)

# ---------------------------------------------------------------------------
# Utilitaires d'affichage
# ---------------------------------------------------------------------------
log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[warn]\033[0m %s\n'  "$*" >&2; }
err()  { printf '\033[1;31m[error]\033[0m %s\n' "$*" >&2; }
die()  { err "$*"; exit 1; }

usage() {
  # Extrait l'en-tête de commentaire comme aide.
  sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

# ---------------------------------------------------------------------------
# Parsing des arguments
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y)   ASSUME_YES=1; shift ;;
    --host)     DEPLOY_HOST="${2:?--host requiert une valeur}"; shift 2 ;;
    --path)     REMOTE_REPO="${2:?--path requiert une valeur}"; shift 2 ;;
    -h|--help)  usage ;;
    *)          die "Argument inconnu : $1 (voir --help)" ;;
  esac
done

command -v ssh >/dev/null 2>&1 || die "ssh introuvable sur cette machine."

log "Cible      : ${DEPLOY_HOST}"
log "Dépôt      : ${REMOTE_REPO}"
log "Services   : ${APP_SERVICES[*]}"
log "Hotfixes   : ${HOTFIX_PATHS[*]}"

# ---------------------------------------------------------------------------
# Étape 1 — Fetch distant + diff des commits qui seront déployés
# ---------------------------------------------------------------------------
# On récupère l'état distant SANS rien modifier, et on montre à l'opérateur
# exactement ce qui va être appliqué (origin/main vs HEAD courant).
log "Récupération de l'état distant (git fetch, sans modification)…"

# shellcheck disable=SC2087  # on veut l'expansion locale des variables dans le heredoc
DIFF_OUTPUT="$(ssh "${DEPLOY_HOST}" bash -s <<EOF
set -euo pipefail
cd "${REMOTE_REPO}"
git fetch --quiet origin
echo "=== Branche courante : \$(git rev-parse --abbrev-ref HEAD) ==="
echo "=== HEAD local  : \$(git rev-parse --short HEAD) ==="
echo "=== origin/main : \$(git rev-parse --short origin/main) ==="
echo
echo "=== Commits à déployer (HEAD..origin/main) ==="
git --no-pager log --oneline --no-decorate HEAD..origin/main || true
echo
echo "=== Fichiers modifiés localement (dérive prod) ==="
git status --porcelain
EOF
)"

printf '%s\n' "${DIFF_OUTPUT}"

# Si rien n'est en attente, on informe mais on laisse l'opérateur décider
# (un rebuild peut rester utile après un changement d'env ou de bundle).
if ! printf '%s\n' "${DIFF_OUTPUT}" | grep -q '^[0-9a-f]\{7,\} '; then
  warn "Aucun nouveau commit sur origin/main par rapport à HEAD distant."
fi

# ---------------------------------------------------------------------------
# Étape 2 — Confirmation
# ---------------------------------------------------------------------------
if [[ "${ASSUME_YES}" -ne 1 ]]; then
  printf '\n'
  read -r -p "Déployer sur ${DEPLOY_HOST} ? Tape 'yes' pour continuer : " REPLY
  [[ "${REPLY}" == "yes" ]] || die "Abandon à la demande de l'opérateur."
else
  log "--yes fourni : confirmation sautée."
fi

# ---------------------------------------------------------------------------
# Étape 3 — Déploiement distant (idempotent, s'arrête au moindre échec)
# ---------------------------------------------------------------------------
# Tout le corps distant tourne sous `set -euo pipefail`. La gestion du
# stash/pop est explicite : on n'utilise PAS `git pull` si un pop échoue,
# et on laisse le dépôt dans un état inspectable.
log "Lancement de la séquence de déploiement sur l'hôte…"

# On passe la liste des chemins de hotfix et des services via l'environnement
# du shell distant pour éviter les problèmes de quoting.
REMOTE_HOTFIXES="${HOTFIX_PATHS[*]}"
REMOTE_APP_SERVICES="${APP_SERVICES[*]}"

# shellcheck disable=SC2087
ssh "${DEPLOY_HOST}" \
  REMOTE_REPO="${REMOTE_REPO}" \
  REMOTE_HOTFIXES="${REMOTE_HOTFIXES}" \
  REMOTE_APP_SERVICES="${REMOTE_APP_SERVICES}" \
  bash -s <<'REMOTE_SCRIPT'
set -euo pipefail

rlog()  { printf '\033[1;36m[remote]\033[0m %s\n' "$*"; }
rwarn() { printf '\033[1;33m[remote-warn]\033[0m %s\n' "$*" >&2; }
rdie()  { printf '\033[1;31m[remote-error]\033[0m %s\n' "$*" >&2; exit 1; }

cd "${REMOTE_REPO}" || rdie "Dépôt introuvable : ${REMOTE_REPO}"

# Choix de la commande compose (plugin v2 ou binaire legacy).
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  rdie "Ni 'docker compose' ni 'docker-compose' disponibles."
fi
rlog "Commande compose : ${DC[*]}"

# --- 3a. Stash des hotfixes locaux -----------------------------------------
# On ne stash QUE les chemins de hotfix connus, et seulement s'ils sont
# réellement modifiés — pour ne pas embarquer d'autres changements par erreur.
read -r -a HOTFIXES <<< "${REMOTE_HOTFIXES}"
STASH_LIST=()
for f in "${HOTFIXES[@]}"; do
  if [[ -e "$f" ]] && ! git diff --quiet -- "$f" 2>/dev/null; then
    STASH_LIST+=("$f")
  fi
done

DID_STASH=0
if [[ ${#STASH_LIST[@]} -gt 0 ]]; then
  rlog "Stash des hotfixes prod modifiés : ${STASH_LIST[*]}"
  git stash push -m "deploy-mother: hotfixes prod $(date -u +%FT%TZ)" -- "${STASH_LIST[@]}"
  DID_STASH=1
else
  rlog "Aucun hotfix prod modifié à stasher."
fi

# --- 3b. Mise à jour du dépôt (fast-forward uniquement) --------------------
# --ff-only : refuse tout merge implicite ; si l'historique local a divergé,
# on s'arrête (et le stash sera restauré ci-dessous avant de sortir).
rlog "git pull --ff-only origin main…"
if ! git pull --ff-only origin main; then
  rwarn "git pull --ff-only a échoué (historique divergent ?)."
  if [[ "${DID_STASH}" -eq 1 ]]; then
    rlog "Restauration des hotfixes stashés avant abandon…"
    git stash pop || rwarn "Échec du stash pop : inspecter 'git stash list'."
  fi
  rdie "Abandon : dépôt distant non fast-forwardable. Résoudre manuellement."
fi

# --- 3c. Restauration des hotfixes -----------------------------------------
# Si le pop entre en conflit, on ABANDONNE proprement : le pull est déjà fait,
# donc on prévient l'opérateur et on laisse l'arbre en conflit pour inspection.
if [[ "${DID_STASH}" -eq 1 ]]; then
  rlog "git stash pop (restauration des hotfixes prod)…"
  if ! git stash pop; then
    rwarn "CONFLIT lors du stash pop des hotfixes prod."
    rwarn "Le code est à jour MAIS les hotfixes sont en conflit."
    rwarn "Résoudre à la main puis 'git stash drop' ; les services n'ont PAS été redémarrés."
    rdie "Abandon avant build/restart pour éviter de déployer un état incohérent."
  fi
fi

# --- 3d. Build des services applicatifs ------------------------------------
rlog "Build des services : ${REMOTE_APP_SERVICES}"
read -r -a SERVICES <<< "${REMOTE_APP_SERVICES}"
"${DC[@]}" build "${SERVICES[@]}"

# --- 3e. Redémarrage ciblé (JAMAIS `down`) ---------------------------------
# On stoppe puis relance UNIQUEMENT api et ui. `down` détruirait tout le
# réseau/les autres conteneurs (nginx, adguard, vpn) : proscrit.
rlog "Stop des services applicatifs : ${SERVICES[*]}"
"${DC[@]}" stop "${SERVICES[@]}"
rlog "Up -d des services applicatifs : ${SERVICES[*]}"
"${DC[@]}" up -d "${SERVICES[@]}"

# --- 3f. Vérifications post-déploiement -------------------------------------
rlog "État des conteneurs :"
"${DC[@]}" ps

rlog "Contrôle de santé de l'API (http://localhost:3000/api/health)…"
HEALTH_OK=0
for i in 1 2 3 4 5 6; do
  if curl -fsS -m 5 http://localhost:3000/api/health >/dev/null 2>&1; then
    HEALTH_OK=1
    rlog "API en bonne santé (tentative ${i})."
    break
  fi
  rwarn "API pas encore prête (tentative ${i}/6), nouvelle vérif dans 5s…"
  sleep 5
done
[[ "${HEALTH_OK}" -eq 1 ]] || rdie "L'API ne répond pas sur /api/health après redémarrage."

# Grep des logs récents : migrations appliquées + erreurs éventuelles.
rlog "Extrait des logs api (migrations / erreurs) :"
"${DC[@]}" logs --tail=200 api 2>&1 \
  | grep -iE 'migrat|error|erreur|fatal|unhandled' || rlog "Aucune ligne migration/erreur notable."

rlog "Déploiement terminé avec succès."
REMOTE_SCRIPT

log "Séquence distante terminée. Déploiement de la mère OK."

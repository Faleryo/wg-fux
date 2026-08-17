#!/bin/bash
# wg-host-sysctl.sh — Applique SUR L'HÔTE les réglages noyau demandés par l'API.
#
# POURQUOI CE PONT : l'API tourne dans un conteneur dont /proc/sys est monté en
# lecture seule. Tous ses `sysctl -w` échouent — mesuré : 20 refus sur 22, seuls
# les compteurs conntrack (namespacés) passent. Les profils d'optimisation
# étaient donc annoncés « appliqués » sans effet réel sur la machine.
#
# Le conteneur dépose sa demande dans un fichier du volume de données ; ce
# script, lancé par systemd sur l'hôte, la valide puis l'applique.
#
# SÉCURITÉ — le conteneur ne doit PAS pouvoir régler n'importe quel paramètre du
# noyau (ce serait une élévation de privilèges en cas de compromission). D'où :
#   - une ALLOWLIST stricte de préfixes réseau ;
#   - le refus explicite des clés de durcissement (rp_filter, syncookies…) que
#     seul l'opérateur doit maîtriser ;
#   - un format ligne strict `clé=valeur`, sans shell ni substitution.
set -euo pipefail

REQUEST_FILE="${1:-}"
LOG_FILE="/var/log/wg-fux-host-sysctl.log"

# Le journal ne doit JAMAIS faire échouer l'application : sous `set -e`, un
# `tee` qui ne peut pas ouvrir le fichier tuait le script dès la première ligne.
log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

[ -n "$REQUEST_FILE" ] || { echo "Usage: $0 <fichier-de-demande>" >&2; exit 2; }
[ -f "$REQUEST_FILE" ] || { log "Aucune demande ($REQUEST_FILE) — rien à faire."; exit 0; }

# Préfixes autorisés : réglages de PERFORMANCE réseau uniquement.
ALLOWED_PREFIXES=(
  "net.core."
  "net.ipv4.tcp_"
  "net.ipv4.udp_"
  "net.netfilter.nf_conntrack_"
)

# Clés explicitement INTERDITES même si elles matchent un préfixe : ce sont des
# garde-fous de sécurité, pas des réglages de performance.
DENIED_KEYS=(
  "net.ipv4.tcp_syncookies"
  "net.ipv4.conf.all.rp_filter"
  "net.ipv4.conf.default.rp_filter"
  "net.ipv4.ip_forward"
)

is_allowed() {
  local key="$1"
  for d in "${DENIED_KEYS[@]}"; do
    [ "$key" = "$d" ] && return 1
  done
  for p in "${ALLOWED_PREFIXES[@]}"; do
    case "$key" in "$p"*) return 0 ;; esac
  done
  return 1
}

APPLIED=0
REFUSED=0
FAILED=0

log "=== Application des réglages hôte depuis $REQUEST_FILE ==="

while IFS= read -r line || [ -n "$line" ]; do
  # Ignore commentaires et lignes vides.
  case "$line" in ''|'#'*) continue ;; esac

  key="${line%%=*}"
  val="${line#*=}"
  # Trim des espaces autour (le fichier est généré, mais restons stricts).
  key="$(echo "$key" | tr -d '[:space:]')"
  val="$(echo "$val" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"

  [ -n "$key" ] && [ -n "$val" ] || continue

  # Format attendu : clé pointée alphanumérique, valeur sans métacaractère shell.
  if ! [[ "$key" =~ ^[a-z0-9_.]+$ ]]; then
    log "✗ Clé au format inattendu, ignorée : $key"
    REFUSED=$((REFUSED + 1)); continue
  fi
  if ! [[ "$val" =~ ^[0-9a-zA-Z_[:space:]-]+$ ]]; then
    log "✗ Valeur au format inattendu pour $key, ignorée"
    REFUSED=$((REFUSED + 1)); continue
  fi

  if ! is_allowed "$key"; then
    log "✗ Hors périmètre autorisé, ignorée : $key"
    REFUSED=$((REFUSED + 1)); continue
  fi

  # VÉRIFICATION PAR RELECTURE — `sysctl -w` sort en code 0 même lorsqu'il
  # échoue (« permission refusée » va sur stderr, le code reste 0). Se fier au
  # code de retour faisait donc compter comme « appliqués » des réglages qui
  # n'avaient pas bougé. On relit la valeur et on la compare.
  sysctl -w "$key=$val" >/dev/null 2>&1 || true
  readback="$(sysctl -n "$key" 2>/dev/null || echo '__ABSENT__')"
  # Normalise les espaces : les valeurs multiples (tcp_rmem) reviennent
  # séparées par des tabulations.
  norm_want="$(echo "$val" | tr -s '[:space:]' ' ')"
  norm_got="$(echo "$readback" | tr -s '[:space:]' ' ')"

  if [ "$norm_got" = "$norm_want" ]; then
    log "✓ $key = $val"
    APPLIED=$((APPLIED + 1))
  elif [ "$readback" = "__ABSENT__" ]; then
    log "⚠ Clé absente de ce noyau : $key"
    FAILED=$((FAILED + 1))
  else
    log "⚠ NON appliqué : $key (voulu « $norm_want », lu « $norm_got »)"
    FAILED=$((FAILED + 1))
  fi
done < "$REQUEST_FILE"

log "=== Terminé : $APPLIED appliqués, $REFUSED refusés, $FAILED en échec ==="

# Bilan relu par l'API pour afficher l'état RÉEL dans l'interface.
RESULT_FILE="$(dirname "$REQUEST_FILE")/sysctl-result.json"
printf '{"appliedAt":"%s","applied":%d,"refused":%d,"failed":%d}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$APPLIED" "$REFUSED" "$FAILED" > "$RESULT_FILE"
chmod 644 "$RESULT_FILE" 2>/dev/null || true

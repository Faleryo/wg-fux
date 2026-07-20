# Déploiement — plateforme mère wg-fux

Procédure de mise à jour de la **plateforme mère** (l'hôte central qui sert
l'API et le dashboard). Les VPS revendeurs suivent un autre canal
(`wg-self-update`, voir la doc de release).

- **Hôte mère** : `root@46.101.147.28`
- **Dépôt distant** : `/root/wg-fux`
- **Services applicatifs déployés** : `api`, `ui` uniquement.
- **Jamais touchés au déploiement** : `nginx`, `adguard`, `vpn-internal`, `certbot`.

---

## 1. Déploiement via le script

Le script `scripts/deploy-mother.sh` encapsule toute la séquence. Il tourne
**depuis ta machine** (il fait le SSH lui-même) — tu ne te connectes pas à la
main sur la mère.

```bash
# Déploiement standard (avec confirmation interactive) :
scripts/deploy-mother.sh

# Cibler un autre hôte / chemin :
scripts/deploy-mother.sh --host root@46.101.147.28 --path /root/wg-fux

# Non-interactif (automatisation) :
scripts/deploy-mother.sh --yes
```

### Ce que fait le script, dans l'ordre

1. `git fetch` distant **sans rien modifier**, puis affiche le diff des commits
   `HEAD..origin/main` et l'état de dérive locale.
2. **Demande confirmation** (`yes`) — sauf `--yes`.
3. Sur l'hôte, sous `set -euo pipefail` :
   - **stash** des hotfixes prod modifiés (voir §2) ;
   - `git pull --ff-only origin main` (refuse tout merge implicite) ;
   - `git stash pop` pour restaurer les hotfixes ;
   - **abandon propre en cas de conflit** de pop (code à jour, services **non**
     redémarrés, arbre laissé inspectable).
4. `docker compose build api ui`.
5. `docker compose stop api ui` puis `docker compose up -d api ui`
   — **jamais `docker compose down`** (qui détruirait tout le réseau et les
   autres conteneurs).
6. Vérifications : `docker compose ps`, santé `curl http://localhost:3000/api/health`
   (avec retries), et grep des logs pour `migration` / `error`.

Le script s'arrête au moindre échec et n'écrase rien sans confirmation.

---

## 2. Le problème : dérive des hotfixes prod (dette technique)

Deux fichiers de configuration sont **modifiés directement sur la mère**, hors
git, en réaction à des incidents de production :

- `core-vpn/scripts/wg-init-server.sh`
- `infra/nginx/default.conf`

Comme ces modifs ne sont pas committées, un `git pull` naïf échouerait ou les
écraserait. D'où la **danse stash → pull --ff-only → stash pop** intégrée au
script. C'est un contournement, pas une solution : chaque déploiement risque un
conflit de `stash pop`, et l'état réel de la prod n'est tracé nulle part.

### Symptômes

- `git status` sur la mère n'est jamais propre (ces deux fichiers apparaissent
  toujours modifiés).
- Risque de perdre un hotfix si quelqu'un fait un `git checkout` / `reset` à la main.
- Impossible de savoir, depuis le dépôt, ce qui tourne réellement en prod.

---

## 3. Recommandation — résorber la dette

Choisir **l'une** de ces deux approches pour supprimer la danse stash/pop :

### Option A — Committer les configs prod-spécifiques (le plus simple)
Faire des divergences prod des changements **versionnés** :

- committer l'état actuel de `wg-init-server.sh` et `infra/nginx/default.conf`
  s'ils sont censés être la vérité pour tout le monde ; **ou**
- si ces réglages sont propres à la mère, les extraire dans des fichiers
  dédiés versionnés (ex. `infra/nginx/default.prod.conf`) et sélectionner le
  bon fichier au build/déploiement.

Une fois fait, retirer les chemins de `HOTFIX_PATHS` dans
`scripts/deploy-mother.sh` : plus de stash/pop.

### Option B — Piloter par variables d'environnement (le plus propre)
Rendre paramétrable ce qui diffère (domaines, chemins, tailles, IP…) :

- templatiser `default.conf` (`envsubst` au démarrage du conteneur nginx, comme
  `infra/dns/AdGuardHome.yaml.template` le fait déjà pour AdGuard) ;
- exposer les réglages de `wg-init-server.sh` via l'`.env` de la mère.

Le dépôt redevient la source de vérité ; la prod ne fait que fournir ses valeurs
d'environnement. C'est l'objectif à viser à terme.

### En attendant
Le script gère la dérive de façon sûre, mais **tout conflit de `stash pop` doit
être traité à la main** : le code est alors à jour mais les services ne sont pas
redémarrés. Résoudre le conflit, `git stash drop`, puis relancer le script.

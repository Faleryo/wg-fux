# 📓 LESSON_RECORD : Shell Function Export Desync (Shadow Code)

**Date** : 2026-04-03
**Contexte** : Bug-Scanner WG-FUX v6.2

## 1. Ce que j'ai tenté
- Analyse des logs API montrant une erreur `export: run_safe: not a function` dans `wg-common.sh:100`.
- Inspection du fichier `core-vpn/scripts/wg-common.sh` dans le dépôt local.

## 2. Pourquoi ça a échoué techniquement
- **Observation** : Le fichier dans le dépôt était propre, mais le fichier *dans* le conteneur était obsolète.
- **Causalité** : Le Dockerfile utilise `COPY` pour les scripts. Toute modification des scripts bash dans `core-vpn/` sur l'hôte n'est pas répercutée dans le conteneur sans une reconstruction (`build`) de l'image. L'erreur venait d'une version "fantôme" du script restée dans l'image.

## 3. Ce qu'il ne faut SURTOUT PAS refaire
- Tenter de modifier uniquement le fichier sur l'hôte en espérant que le conteneur se mette à jour alors qu'il n'y a pas de montage de volume (`mount`) sur `/usr/local/bin/`.
- Ignorer la possibilité d'une désynchronisation Image/Source lors d'un débogage de scripts embarqués.

## 4. Solution pérenne
- **Action** : `docker compose up -d --build api`.
- **Recommandation** : Pour le développement local, envisager un montage de volume sur `/usr/local/bin/` pour éviter les cycles de build, OU s'assurer que le protocole `bug-scanner` vérifie toujours la version du conteneur en premier.

---
*Enregistré par Vibe-OS v6.2 (Voyager Skill Library)*

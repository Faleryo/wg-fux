---
description: WG-FUX Genesis Workflow (v6.2 Frontier Explorer)
---

# 🌀 GENESIS_FLOW : WG-FUX v6.2

Ce workflow doit être exécuté pour TOUT changement majeur ou toute nouvelle fonctionnalité dans la plateforme VPN **WG-FUX**.

## 1. Phase SCAN & DISTILL
// turbo
1. Analyser l'état actuel des dossiers `api-service`, `core-vpn` et `dashboard-ui`.
2. Extraire les variables d'environnement (`.env.example`) et les fichiers de config.
3. Rédiger un Knowledge Item `knowledge/ki-delta-state.md` résumant l'impact du changement.

## 2. Phase SPAWN_SKILL
// turbo
1. Créer ou mettre à jour un Skill-Item temporaire `.agents/skills/TASK_SPEC.md`.
2. Définir les limites de CPU/RAM pour le composant visé (Blast Radius).

## 3. Phase CRAFT_WORKFLOW (The Frontier Plan)
// turbo
1. Générer le plan d'action dans `.agents/workflows/execution_task.md`.
2. Simuler textuellement en <thought> les 3 chemins possibles (MCTS).

## 4. Phase WRITE_TESTS_FIRST (Zero-Day Watcher)
// turbo
1. Rédiger le script de validation terminal `verify-task.sh`.
2. **Phase Red Teaming** : Rédiger le script `evil-pioneer.sh` dont le seul but est de faire échouer le code que vous allez écrire (Injection, Stress tests).

## 5. Phase IMPLEMENT & REPAIR
1. Développer le code métier.
2. Boucler l'exécution de `verify-task.sh` et la défense contre `evil-pioneer.sh`.
// turbo
3. Marquer la tâche comme terminée uniquement si les deux scripts passent (Code 0).

---
**L'intuition ne vaut rien sans la preuve mathématique du terminal.**
*Imprimé par Vibe-OS v6.2*


---
description: WG-FUX Genesis Workflow (v6.5 The Multilingual Guardian)
---

# 🌀 GENESIS_FLOW : WG-FUX v6.5

Ce workflow doit être exécuté pour TOUT changement majeur ou toute nouvelle fonctionnalité dans la plateforme VPN **WG-FUX**.

## 1. Phase SCAN & DISTILL (The Precision Scanner)
// turbo
1. Analyser l'état actuel via le `parallel_scan_protocol`.
2. Identifier les **Pivot Files** (docker-compose, entrypoints, package.json).
3. Rédiger un Knowledge Item `knowledge/ki-delta-state.md` résumant l'impact.

## 2. Phase SPAWN_SKILL & SPAWN_TOOLS
// turbo
1. Créer ou mettre à jour un Skill-Item temporaire `.agents/skills/TASK_SPEC.md`.
2. Générer les outils locaux dans `.vibe/tools/` (ex: `verify-service.sh`).

## 3. Phase CRAFT_WORKFLOW (The Frontier Plan)
// turbo
1. Générer le plan d'action dans `.agents/workflows/execution_task.md`.
2. Simulation MCTS pour les chemins critiques.

## 4. Phase REVERSED VERIFICATION (Zero-Day Watcher)
// turbo
1. Rédiger le script de validation terminal `verify-task.sh`.
2. **Phase Red Teaming** : Rédiger le script `evil-pioneer.sh`.

## 5. Phase IMPLEMENT & OBSERVE (Obsidian Healing)
1. Développer le code métier.
2. Boucler l'exécution de `verify-task.sh` (Vérification 0-Status).

---
**L'intuition ne vaut rien sans la preuve mathématique du terminal.**
*Imprimé par Vibe-OS v6.5*


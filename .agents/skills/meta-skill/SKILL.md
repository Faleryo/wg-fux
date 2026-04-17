---
name: meta-skill
description: >
  Workflow universel pour projets de développement logiciel. Utiliser ce skill pour TOUT ce qui touche au dev :
  création from scratch, projet existant, debug/bug/crash, pentest/sécurité, refactoring,
  CI/CD, migrations BDD, observabilité, multi-projets, reprise de session.
  Active une approche terminal-first, git-native avec validation continue à chaque étape.
  Déclencher dès que l'utilisateur mentionne un projet, un bug, une migration, un refactoring,
  un pentest, une reprise de session, ou toute tâche de développement — même sans demande explicite de workflow.
---

# META-SKILL — Universal Workflow Generator
> v7.0 "Living System" · from scratch · existant · debug · pentest · refactoring · CI/CD · migrations · observabilité · rollback · multi-projets · session restore · auto-amélioration

---

## PHILOSOPHIE

- **Lire avant d'écrire. Toujours.**
- **Chaque action se termine par une preuve shell. Sans exception.**
- **Faire le minimum nécessaire. Vérifier le maximum possible.**
- **Un agent qui suppose est un agent qui régresse.**
- **La prod est sacrée. Chaque opération est réversible ou elle ne se fait pas.**

---

## PROTOCOLE D'AMORÇAGE

> S'exécute avant tout le reste. Dans cet ordre exact.

### ÉTAPE 0 — LANGUE

Si la langue n'est pas évidente depuis le message de l'utilisateur, poser cette unique question :

```
"In which language would you like to work?
Dans quelle langue souhaitez-vous travailler ?
¿En qué idioma desea trabajar?"
```

Si l'utilisateur écrit directement dans une langue → adopter immédiatement. Ne jamais changer sans demande explicite.

### ÉTAPE 1 — DÉTECTION DE SESSION

```
Nouvelle session  → aucun projet mentionné, première interaction → DÉTECTION DU MODE
Session reprise   → nom de projet mentionné, "on reprend", fichiers ouverts → SESSION RESTORE
                    Lire : references/protocols.md § P15
```

### ÉTAPE 2 — DÉTECTION DU MODE

| Mode | Signaux | Séquence |
|------|---------|----------|
| **A — From scratch** | Aucun fichier, idée en langage naturel | INTAKE → STACK → SKILLS |
| **B — Projet existant** | Fichiers présents, "j'ai déjà / modifier / ajouter" | SCAN → DIAGNOSTIC → SKILLS |
| **C — Debug** | "bug / erreur / crash / ça marche pas" | REPRODUCE → TRIAGE → PIPELINE → RÉGRESSION |
| **D — Pentest** | "test sécu / intrusion / pentest / audit" | SCOPE → RECON → ATTAQUE → RAPPORT |
| **E — Refactoring** | "refactoriser / réécrire / nettoyer / restructurer" | COVERAGE → PLAN → EXTRACT → VERIFY |

**Mode C prioritaire sur tout.** D et E uniquement sur demande explicite.
Si ambigu A/B : *"Tu pars de zéro ou tu as déjà une base ?"*
Si ambigu B/E : *"Tu veux ajouter une fonctionnalité ou réorganiser du code existant ?"*

Détails de chaque mode → `references/modes.md`

---

## P0 — TERMINAL-FIRST

**Chaque action produit une preuve shell avant de passer à la suivante.**

```
Fichier créé       → cat [fichier] | head -20
Package installé   → npm list | grep [pkg] ou pip show [pkg]
Serveur démarré    → curl -s -o /dev/null -w "%{http_code}" http://localhost:[port]
Migration lancée   → SELECT COUNT(*) FROM [table]
Test passé         → echo $? → doit retourner 0
Port ouvert        → lsof -i :[port]
Variable d'env     → printenv | grep [VAR]
Build réussi       → ls -lh dist/ ou ls -lh build/
```

Si la preuve échoue → **STOP. Basculer Mode C. Ne jamais continuer.**

---

## P1 — MINIMAL FOOTPRINT

Avant chaque action :
```
1. J'ai BESOIN de ce fichier ou c'est par précaution ?
2. Cette modification est dans le scope de la tâche en cours ?
3. Existe-t-il un chemin qui touche MOINS de fichiers ?
→ Si OUI à 3 : prendre ce chemin.
```

Interdictions : reformater un fichier entier pour corriger 3 lignes · installer un package si une fonction native suffit · refactoriser hors scope · créer un fichier si un existant peut être étendu proprement.

---

## P2 — MACHINE D'ÉTAT

**Afficher au début de chaque réponse en mode projet :**

```
╔═══════════════════════════════════════════╗
║ ÉTAT WORKFLOW                             ║
║ Projet       : [Nom]                      ║
║ Mode         : [A/B/C/D/E]               ║
║ Phase        : [0/1/2/3/Livraison]        ║
║ Tâche        : [Tâche atomique en cours]  ║
║ Statut       : [EN COURS / BLOQUÉ / WAIT] ║
║ Confiance    : [X%]                       ║
║ Prochain ckpt: [Ce que l'utilisateur      ║
║                 devra valider ensuite]    ║
╚═══════════════════════════════════════════╝
```

**Transitions légales :**
```
Phase 0 → 1 : validation utilisateur du Plan/Diagnostic
Phase 1 → 2 : validation schéma + contrats d'API
Phase 2 → 3 : exit 0 sur chaque tâche atomique
Phase 3 → Livraison : validation critère de succès fonctionnel

INTERDIT : sauter une phase.
INTERDIT : revenir en arrière sans le signaler explicitement.
```

---

## P3 — BUDGET DE CONTEXTE

```
Garder actif uniquement :
- Le fichier pivot en cours
- Le contrat d'interface dont il dépend
- Le test qui le valide

SIGNAL : > 5 fichiers actifs simultanément → CONTEXT FLUSH obligatoire
```

```markdown
## CONTEXT FLUSH — [Timestamp]
Archivé en KB : [fichier/info] → kb/[clé]
Gardé actif   : [fichier en cours] · [contrat d'interface]
Purgé         : [logs résolus] · [décisions documentées]
```

---

## P4 — GIT-NATIVE

**Branches :**
```
main          → prod uniquement. Jamais de commit direct.
develop       → intégration. Merge depuis feature branches.
feature/[nom] → une feature = une branche = une PR
fix/[bug]     → un bug = une branche = une PR
refactor/[nom]→ un périmètre de refactoring = une branche
pentest/[date]→ cycle de pentest isolé
```

**Commits (Conventional Commits) :**
```
feat|fix|refactor|test|docs|chore|security|perf|migrate(scope): description
INTERDIT : "fix stuff" · "WIP" · "update" · "changes"
```

**Avant chaque commit :**
```bash
git diff --staged          # Relire chaque ligne
git add -p                 # Staging interactif — jamais git add .
# Vérifier : pas de console.log · pas de secret · tests passants
```

**Checkpoint avant modification risquée :**
```bash
git stash && git checkout -b fix/[nom]
# ... modifications ... git diff && git add -p
```

---

## P5 — BOUCLE DE VÉRIFICATION CONTINUE

```
1. LIRE l'état actuel
2. PLANIFIER le changement minimal
3. EXÉCUTER
4. VÉRIFIER → exit 0 requis
5. COMMIT atomique
6. METTRE À JOUR l'état workflow

Si exit ≠ 0 → STOP → Mode C → résoudre
```

---

## P6 — CONTRAT DE HANDOFF

```markdown
## HANDOFF : [Émetteur] → [Récepteur]
Confiance émetteur : [X%]

### Fait (avec preuve terminal)
- [Action 1 — exit 0 confirmé]

### État système
- Fichiers modifiés : [liste]
- Tests passants : [liste]
- Services actifs : [liste + ports]

### À faire (critères précis)
- [Tâche — critère de succès mesurable]

### Ne pas toucher
- [Composant — raison]

### Dépendances critiques
- [Interface X retourne Y — contrat immuable]

### Si bloqué
→ KB : blockers/[date]-[description] · Ne pas improviser
```

---

## GUARDRAILS GLOBAUX

| Niveau | Action | Comportement |
|--------|--------|-------------|
| 🟢 Auto | Lecture, lint, nouveaux fichiers | Exécution directe |
| 🟡 Confirm | Modification existants, packages, branches, migrations | Confirmation |
| 🔴 Stop | Suppression, prod, BDD prod, force push, DROP TABLE | Arrêt + "OK" explicite |

**Interdictions absolues :**
Modifier sans avoir lu l'état actuel · supposer le succès sans exit 0 · patcher sous 80% de confiance · committer directement sur main · migration sans DOWN fonctionnel testé · déploiement sans backup vérifié · scope creep · > 5 fichiers actifs sans Context Flush · handoff sans format standard + confiance émetteur

**Format d'erreur universel :**
```json
{ "error": "Description humaine", "cause": "Cause technique", "action": "Ce qui va être fait", "confidence": "X%", "rollback_available": true }
```

---

## ANTI-PATTERNS — Détection automatique

| Pattern | Signal |
|---------|--------|
| Variable avant déclaration dans callback | ⚠️ HOISTING-TDZ |
| devDependencies importé en runtime | 🚫 DEVDEP-RUNTIME |
| Route interceptant le flux avant la cible | ⚠️ SHADOW-ROUTE |
| Secret dans le code ou les logs | 🚫 SECRET-EXPOSED |
| `exec()` / `subprocess` avec string concaténée | 🚫 SHELL-INJECT |
| README ≠ stack réelle | ⚠️ DOC-DRIFT |
| `[object Object]` dans un mapping | ⚠️ DOUBLE-PARSE |
| Protection UI sans validation serveur | 🚫 EXPIRY-BYPASS |
| `git add .` sans relecture | ⚠️ BLIND-COMMIT |
| Modification hors scope | ⚠️ SCOPE-CREEP |
| Log contenant email/password/token | 🚫 LOG-LEAK |
| Résultat assumé sans preuve terminal | 🚫 BLIND-ASSUMPTION |
| Migration sans DOWN fonctionnel | 🚫 IRREVERSIBLE-MIGRATION |
| Déploiement sans backup vérifié | 🚫 NAKED-DEPLOY |
| `npm install` en CI au lieu de `npm ci` | ⚠️ LOCKFILE-BYPASS |
| Package avec nom proche d'un officiel | ⚠️ TYPOSQUATTING |
| Refactoring qui change le comportement | 🚫 BEHAVIOR-DRIFT |
| Bug corrigé sans test de régression | ⚠️ REGRESSION-NAKED |

---

## FLUX COMPLET

```
Première interaction
        │
        ▼
PROTOCOLE D'AMORÇAGE (Langue → Session → Mode)
        │
  ┌─────┴────┬──────────┬──────────┬──────────┐
  ▼          ▼          ▼          ▼          ▼
MODE A    MODE B     MODE C     MODE D     MODE E
INTAKE    SCAN       REPRODUCE  PÉRIMÈTRE  COVERAGE
SCORING   PARALLEL   TRIAGE     RECON      PLAN
STACK     DIAGNOSTIC SEUIL 80%  SURFACES   ATOMIQUE
MÉTIER    RÈGLES     PIPELINE   RAPPORT    TESTS
SUCCÈS               5 POURQUOI CORRECTION VERIFY
  │          │       RÉGRESSION
  └────┬─────┘       LESSON
       │
       ▼
 ÉTAT WORKFLOW (P2) · bilan multi-projets (P14) · prochain checkpoint
       │
       ▼
 PLAN / DIAGNOSTIC ARTIFACT → validation utilisateur
       │
       ▼
 GIT : branch + CI/CD (P9) + budget perf (P12) + runbook rollback (P13)
 Registre multi-projets mis à jour (P14)
       │
       ▼
 SKILLS ENFANTS
 ARCHITECT → HANDOFF → IMPLEMENTER → HANDOFF → AUDITOR
       │
       ▼
 BOUCLE VÉRIFICATION CONTINUE (P5)
 [action → terminal → exit 0 → commit atomique]
       │
       ▼
 Context Flush si > 5 fichiers (P3)
       │
       ▼
 AUDIT FINAL · critère succès fonctionnel · CI vert · budget perf
       │
       ▼
 SESSION SNAPSHOT (P15)
       │
       ▼
 PR → develop → main · KB · Backlog · Runbook
       │
       ▼
 [5+ Lesson Records ?] → CONSOLIDATION AUTO-AMÉLIORATION (P16)
       │
       ▼
     ✅ LIVRAISON
```

---

## RÉFÉRENCES — Quand lire quoi

| Besoin | Fichier |
|--------|---------|
| Instrumentation logs / self-healing loop | `references/principles.md` |
| CI/CD · Tests · Migrations BDD · Observabilité · Rollback | `references/protocols.md` |
| Multi-projets (P14) · Session Restore (P15) · Auto-amélioration (P16) | `references/protocols.md` |
| Détail Mode A (from scratch) | `references/modes.md § Mode A` |
| Détail Mode B (existant) · Mode C (debug) | `references/modes.md` |
| Détail Mode D (pentest) · Mode E (refactoring) | `references/modes.md` |
| Désalignement · Scope Creep · Workflow Principal | `references/modes.md § Transversaux` |
| SKILL_ARCHITECT · SKILL_IMPLEMENTER · SKILL_AUDITOR | `references/child-skills.md` |

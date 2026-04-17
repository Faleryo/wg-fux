# Protocoles P9-P16

## Table des matières
- [P9 — CI/CD Pipeline Native](#p9)
- [P10 — Pyramide de Tests](#p10)
- [P11 — Protocole de Migration BDD](#p11)
- [P12 — Observabilité Complète](#p12)
- [P13 — Rollback Protocol](#p13)
- [P14 — Gestion Multi-Projets](#p14)
- [P15 — Session Restore](#p15)
- [P16 — Boucle d'Auto-Amélioration](#p16)
- [Knowledge Base — Structure](#kb)

---

## P9 — CI/CD PIPELINE NATIVE {#p9}

> Tout guardrail manuel devient une règle CI. Ce que l'humain oublie, la machine enforce.

**Générer systématiquement en Phase 0 selon la plateforme détectée.**

**GitHub Actions — `.github/workflows/ci.yml` :**
```yaml
name: CI
on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm run test -- --coverage
      - run: npm audit --audit-level=high

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Scan secrets
        uses: trufflesecurity/trufflehog@main
      - name: SAST scan
        uses: returntocorp/semgrep-action@v1

  build:
    needs: [quality, security]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci && npm run build
      - uses: actions/upload-artifact@v4
        with: { name: build, path: dist/ }
```

**GitLab CI — `.gitlab-ci.yml` :**
```yaml
stages: [lint, test, security, build]

lint:
  stage: lint
  script: [npm ci, npm run lint, npm run type-check]

test:
  stage: test
  script: [npm ci, npm run test -- --coverage]
  coverage: '/Lines\s*:\s*(\d+\.?\d*)%/'

security:
  stage: security
  script: [npm audit --audit-level=high]

build:
  stage: build
  needs: [lint, test, security]
  script: [npm ci, npm run build]
  artifacts: { paths: [dist/] }
```

**Règles de protection de branche :**
```
main    → PR obligatoire · CI verte requise · 1 reviewer minimum · no force push
develop → CI verte requise · no force push
```

**Gates de qualité minimaux (non-négociables) :**
```
Couverture de tests  : ≥ 70% (seuil bloquant)
Lint                 : 0 erreur
Type check           : 0 erreur
Audit sécurité       : 0 vulnérabilité high/critical
Build                : succès
```

---

## P10 — PYRAMIDE DE TESTS {#p10}

```
         ╱ E2E ╲           ← 10% · Flux complets · Lents · Coûteux
        ╱────────╲
       ╱Integration╲       ← 30% · Frontières entre modules
      ╱──────────────╲
     ╱   Unit Tests   ╲    ← 60% · Logique isolée · Rapides
    ╱──────────────────╲
```

| Type | Quand | Mock ou réel ? |
|------|-------|----------------|
| **Unit** | Toute fonction avec logique métier | Mock les dépendances externes |
| **Integration** | Toute frontière (API ↔ BDD, service ↔ service) | BDD réelle en container |
| **E2E** | Flux critiques (auth, achat, inscription) | Environnement complet |

**Règles de qualité :**
```
Nommage : "should [résultat attendu] when [condition]"
Jamais de logique métier dans les tests (pas de if/for)
Un test qui passe toujours sans valider quoi que ce soit → supprimer
Couverture de ligne ≠ couverture de comportement → tester les edge cases
```

**Tests de régression — règle absolue :**
```
Chaque bug corrigé → 1 test qui aurait détecté ce bug
Rouge sur ancienne version → preuve qu'il est pertinent
Vert sur version corrigée → preuve que le fix est réel
```

**Mocking :**
```
Mock uniquement ce qui est externe à l'unité testée
Ne jamais mocker ce qu'on est en train de tester
Préférer des fakes déterministes aux mocks dynamiques complexes
```

---

## P11 — PROTOCOLE DE MIGRATION BDD {#p11}

> L'opération la plus risquée d'un projet. Zéro improvisation.

**Règles fondamentales :**
```
1. Une migration = un changement atomique (jamais plusieurs en une)
2. Toute migration doit avoir un DOWN (rollback) fonctionnel
3. Tester UP et DOWN avant tout déploiement
4. Jamais de migration destructive sans backup vérifié
5. Les migrations sont immuables une fois en prod
```

**Cycle complet :**
```
ÉTAPE 1 — ÉCRIRE
  Nommage : [timestamp]_[action]_[table].sql
  Exemple : 20260408_add_column_users_verified.sql

ÉTAPE 2 — VALIDER EN LOCAL
  → UP · vérifier données · DOWN · re-UP (idempotence)

ÉTAPE 3 — TESTER EN STAGING
  → Dump prod anonymisé · migrer · vérifier app · mesurer durée
  → Durée > 30s sur prod = migration à risque

ÉTAPE 4 — PRÉPARER LE ROLLBACK
  → Script rollback testé et prêt · backup vérifié

ÉTAPE 5 — DÉPLOYER EN PROD
  → SELECT COUNT(*) avant · appliquer · exit 0 · smoke test

ÉTAPE 6 — VÉRIFIER POST-MIGRATION
  → Métriques · données · logs
```

**Migrations dangereuses :**
```
DROP TABLE / DROP COLUMN   → backup + fenêtre de maintenance
ALTER COLUMN (type change) → 3 étapes : add new · migrate data · drop old
Renommage de colonne       → idem (jamais RENAME direct en prod)
Index sur grande table     → CREATE INDEX CONCURRENTLY (PostgreSQL)
```

**Format standard :**
```sql
-- Migration : 20260408_add_verified_to_users
-- Description : Ajoute le flag de vérification email
-- Réversible : OUI · Durée estimée : < 1s · Risque : Faible

-- UP
ALTER TABLE users ADD COLUMN verified BOOLEAN NOT NULL DEFAULT false;

-- DOWN
ALTER TABLE users DROP COLUMN verified;
```

---

## P12 — OBSERVABILITÉ COMPLÈTE {#p12}

> Logs + Métriques + Traces. Logs seuls = vision partielle.

**Les 3 piliers :**
```
LOGS     → Que s'est-il passé ? (→ P7)
MÉTRIQUES→ À quelle fréquence / combien ? (Prometheus/DataDog)
TRACES   → Pourquoi ça a pris autant de temps ? (OpenTelemetry)
```

**Budget de performance — définir dès la Phase 0 :**
```
API responses  : p50 < 100ms · p95 < 500ms · p99 < 1000ms
BDD queries    : p50 < 20ms  · p95 < 100ms
Page load      : First Contentful Paint < 1.5s
Erreur rate    : < 0.1% sur les endpoints critiques

Seuil d'alerte : p95 > 2× le budget → signaler
Seuil critique : p99 > 5× le budget → incident
```

**Traces distribuées (OpenTelemetry) :**
```javascript
const tracer = opentelemetry.trace.getTracer('service-name');
const span = tracer.startSpan('operation-name');
span.setAttribute('user.id', userId);
// ... opération ...
span.end();
```

**Checklist — vérifier en Phase 3 :**
```
- [ ] Logs JSON structurés sur toutes les frontières critiques
- [ ] Métriques exposées sur /metrics
- [ ] Request ID propagé sur toutes les requêtes
- [ ] Health endpoint : GET /health → { status: "ok", version, uptime }
- [ ] Readiness endpoint : GET /ready → vérifie BDD, cache, dépendances
- [ ] Budget de performance défini et instrumenté
- [ ] Alertes configurées sur les seuils critiques
```

---

## P13 — ROLLBACK PROTOCOL {#p13}

> Ce qui se déploie peut casser. Chaque déploiement a un plan de retour. Toujours.

**Runbook de déploiement — générer en Phase 0 :**
```markdown
## RUNBOOK DE DÉPLOIEMENT : [Version] — [Date]

### Pré-déploiement
- [ ] Tests CI verts · Build validé en staging · Backup BDD vérifié : [timestamp]
- [ ] Métriques baseline : [latence p95, error rate] · Rollback testé en staging

### Déploiement
- [ ] Feature flags activés si applicable · Déploiement lancé : [timestamp]
- [ ] Smoke test immédiat : [endpoints critiques]

### Post-déploiement (15 min de surveillance)
- [ ] Métriques comparées au baseline · Logs sans erreurs nouvelles

### Rollback si nécessaire
Déclencher si : error rate > 1% · p95 > 2× baseline · crash · perte de données
→ [Commande de rollback préparée]
→ Durée max avant décision : 10 minutes
```

**Types de rollback :**
```
ROLLBACK CODE (sans migration BDD)     → git revert ou build précédent → < 5 min
ROLLBACK CODE + MIGRATION RÉVERSIBLE   → DOWN de migration + build précédent
ROLLBACK MIGRATION IRRÉVERSIBLE (DROP) → Restaurer le backup vérifié
FEATURE FLAG ROLLBACK (le plus rapide) → Désactiver le flag → < 1 min, zéro redéploiement
```

**Feature Flags — quand les utiliser :**
```
Auth · paiements · modification comportementale utilisateur
Migration de données progressive · A/B testing · déploiements progressifs (10% → 50% → 100%)
```

---

## P14 — GESTION MULTI-PROJETS {#p14}

> Sans protocole explicite, les contextes se contaminent.

**Registre — KB : `multi-project/registry.md` :**
```markdown
| Projet | Mode | Phase | Branche Git | Dernière action | Dépendances |
|--------|------|-------|-------------|-----------------|-------------|
| [Nom A] | B | Phase 2 | feature/auth | [date] | Aucune |
| [Nom B] | A | Phase 1 | feature/api  | [date] | Partage DB avec A |
```

**Règles de cloisonnement :**
```
1. ISOLATION : chaque projet a sa propre branche KB (projects/[nom]/)
   Un agent sur Projet A ne lit jamais la KB du Projet B sauf dépendance déclarée

2. DÉPENDANCES INTER-PROJETS : si B dépend d'une API de A
   → Documenter dans le registre
   → Tout changement de contrat dans A → notification vers B

3. DÉCISIONS PARTAGÉES : infrastructure commune (BDD, auth, queue)
   → KB : shared/arch/[décision].md
   → Modification = checkpoint obligatoire avec les deux projets

4. CONFLIT DE RESSOURCES : deux projets sur le même fichier/service
   → Le projet en Phase la plus avancée est prioritaire
   → Signaler le conflit à l'utilisateur — jamais résoudre par déduction
```

**Bilan multi-projets — format d'état étendu :**
```
╔════════════════════════════════════════════════╗
║ ÉTAT MULTI-PROJETS                             ║
║ Projet actif : [Nom] — Phase [N] — Mode [X]   ║
║ Autres projets :                               ║
║   [Projet B] — Phase [N] — [Statut]           ║
║ Dépendances actives : [OUI/NON — détail]      ║
║ Conflits détectés   : [OUI/NON — détail]      ║
╚════════════════════════════════════════════════╝
```

---

## P15 — SESSION RESTORE {#p15}

> Reprendre un projet après une pause sans relire toute la KB.

**Déclenchement :** mention d'un projet par son nom · "on reprend" · "où en étais-je" · fichiers du projet ouverts.

**Séquence de restauration :**
```
ÉTAPE 1 — CHARGER LE SNAPSHOT
  → Lire KB : projects/[nom]/session-snapshot.md
  → Si absent → construire depuis arch/*, git/*, ops/*, lessons/*

ÉTAPE 2 — VÉRIFIER L'ÉTAT ACTUEL
  → git status + git log --oneline -10
  → État des services : curl /health si applicable
  → CI pipeline : dernier run vert ou rouge ?
  → Comparer avec snapshot → détecter les dérives

ÉTAPE 3 — PRÉSENTER LE RÉSUMÉ
```

```markdown
## SESSION RESTORE : [Nom Projet]

### Où on en était
Phase : [N] — Tâche interrompue : [description]
Dernière action confirmée : [action + preuve terminal]

### État actuel du système
Git : [branche] · [N commits depuis snapshot] · CI : [vert/rouge]

### Dérives détectées depuis la dernière session
- [Dérive — action requise] ou : Aucune dérive ✅

### Prochaine action recommandée
[Tâche exacte + critère de succès]

→ On reprend là ?
```

**Format du snapshot (généré automatiquement à chaque fin de session) :**
```markdown
## SESSION SNAPSHOT : [Projet] — [Date/Heure]

Mode : [X] · Phase : [N] · Statut : [EN COURS/BLOQUÉ]
Tâche interrompue : [description] · Confiance : [X%]

### Dernières actions (avec preuves)
1. [Action] → exit 0 ✅

### Fichiers modifiés depuis dernier commit
[git status snapshot]

### État des services + backlog actuel

### Points d'attention + prochain checkpoint
```

**Règle :** générer à chaque fin de phase, interruption signalée ("pause", "à plus tard"), avant Context Flush majeur.

---

## P16 — BOUCLE D'AUTO-AMÉLIORATION {#p16}

> Les Lesson Records s'accumulent — les consolider en règles nouvelles.

**Déclenchement :** "améliore le meta-skill" · "consolidate lessons" · après 5+ Lesson Records sans consolidation.

**Séquence :**
```
ÉTAPE 1 — AUDIT : lire KB lessons/* · identifier patterns récurrents (2+ occurrences)

ÉTAPE 2 — EXTRACTION : pour chaque pattern :
  - Formuler la règle préventive en une phrase
  - Identifier où dans le meta-skill elle s'applique
  - Vérifier qu'elle n'est pas déjà couverte

ÉTAPE 3 — RAPPORT DE CONSOLIDATION ARTIFACT
```

```markdown
## RAPPORT DE CONSOLIDATION — [Date]

### Patterns détectés
| Pattern | Occurrences | Cause racine commune |
|---------|-------------|---------------------|

### Règles nouvelles proposées
**Règle 1 :** [Contexte] → [Formulation] → Intégrer dans [Section]
Anti-pattern : [Signal à ajouter]

→ Valides ces ajouts ? Je mets à jour le meta-skill.
```

```
ÉTAPE 4 — MISE À JOUR (après validation)
  → Ajouter règles + anti-patterns · Incrémenter version (patch) · Archiver Lesson Records
```

**Règle d'or :** jamais modifier le meta-skill pendant l'exécution d'un projet. Toujours en session dédiée, après validation humaine explicite.

---

## KNOWLEDGE BASE — Structure complète {#kb}

| Clé | Contenu |
|-----|---------|
| `arch/stack-decision` | Stack + scoring |
| `arch/data-schema` | Schéma validé |
| `arch/api-contracts` | Contrats + edge cases |
| `arch/migrations` | Plan migrations + historique |
| `arch/domain-constraints` | Contraintes métier/légales |
| `arch/success-criteria` | Critère de succès fonctionnel |
| `arch/performance-budget` | SLA définis |
| `git/branch-strategy` | Stratégie branches |
| `ci/pipeline` | Config CI + gates qualité |
| `ops/rollback-runbook` | Runbook de déploiement |
| `ops/feature-flags` | État des feature flags |
| `backup/[fichier]-[date]` | État avant modification |
| `lessons/[pattern]-[date]` | Lesson Record + nom pattern |
| `blockers/[date]-[desc]` | Blocage signalé |
| `backlog/features` | Features en attente |
| `security/pentest-[date]` | Rapport pentest |
| `multi-project/registry` | Registre des projets actifs |
| `shared/arch/[décision]` | Décisions partagées entre projets |
| `projects/[nom]/session-snapshot` | Snapshot de fin de session |
| `lessons/archive/[pattern]` | Lesson Records consolidés |

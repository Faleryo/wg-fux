# Modes A–E + Protocoles Transversaux

## Table des matières
- [Mode A — From Scratch](#mode-a)
- [Mode B — Projet Existant](#mode-b)
- [Mode C — Debug Universel](#mode-c)
- [Mode D — Pentest](#mode-d)
- [Mode E — Refactoring](#mode-e)
- [Transversaux — Désalignement · Scope Creep · Workflow Principal](#transversaux)

---

## MODE A — FROM SCRATCH {#mode-a}

### A1. INTAKE (3 questions max)

```
1. Quel est le problème que ça résout ? (une phrase)
2. Qui l'utilise ? (type d'utilisateur, contexte)
3. Contrainte technique non-négociable ?
   → "aucune" = je choisis le path optimal via scoring matrix
```

### A2. STACK SELECTOR — Scoring Matrix

S'active si Q3 = "aucune". Scorer chaque candidat :

```
CRITÈRE                  POIDS   ÉVALUATION
─────────────────────────────────────────────────
Maturité de l'équipe      25%   [0-10]
Vélocité prototype        20%   [0-10]
Maintenabilité long terme 20%   [0-10]
Écosystème / libs         15%   [0-10]
Déploiement / ops         10%   [0-10]
Coût infrastructure       10%   [0-10]

SCORE FINAL = Σ (note × poids)
→ Recommander la stack avec le score le plus élevé
→ Si 2 stacks à moins de 5 points d'écart : présenter les deux
```

**Livrable :**
```markdown
### Stack recommandée : [Nom] — Score : [X/10]

Pourquoi pour ton projet :
- [Raison 1 ancrée dans tes contraintes]

Limite honnête : [1 faiblesse réelle]
Alternative : [Stack Y — Score : Z/10] si tu veux [X]

→ On part avec ça ?
```

### A3. CONTRAINTES MÉTIER

| Domaine | Contraintes |
|---------|------------|
| Santé | RGPD renforcé, HDS, pas de logs patient |
| Finance | PCI-DSS, jamais stocker carte, audit trail |
| Enfants | COPPA, consentement parental |
| RH | RGPD, droit à l'effacement, accès restreint |
| Contenu public | CGU, modération, DMCA si uploads |

### A4. CRITÈRE DE SUCCÈS FONCTIONNEL

```markdown
Le projet est terminé quand :
- [Action utilisateur] → [Résultat observable et mesurable]
```

Défini à l'intake. Vérifié en dernier. Un exit 0 ne remplace pas cette validation.

---

## MODE B — PROJET EXISTANT {#mode-b}

### B1. SCAN (parallèle — jamais séquentiel)

```
Vague 1 : arborescence + manifest (package.json / requirements.txt / go.mod)
Vague 2 : entrypoint + infra (docker-compose / Makefile) + auth + CI existant
Vague 3 : fichiers référencés par imports de vague 2 uniquement
```

### B2. DIAGNOSTIC ARTIFACT

```markdown
## DIAGNOSTIC : [Projet]

Stack réelle : [déduite des fichiers]
CI existant  : [OUI/NON — plateforme]
Tests        : [OUI/NON — couverture estimée]
Migrations   : [OUI/NON — outil]

Écarts :
- DOC-DRIFT : [OUI/NON]
- DEVDEP-RUNTIME : [OUI/NON]
- Secrets exposés : [OUI/NON]
- Dead code : [OUI/NON]
- Migration non appliquée : [OUI/NON]
- CI absente ou cassée : [OUI/NON]

Impact de la demande :
- Fichiers touchés : [liste]
- Migration BDD requise : [OUI/NON]
- Régression : [Faible/Moyen/Élevé]

Recommandation : [direct ou nettoyer avant ?]
```

### B3. RÈGLES PROJET EXISTANT

```
1. Lire le fichier complet avant de modifier
2. git diff avant ET après chaque modification
3. Surface de changement minimale
4. Backup KB : backup/[fichier]-avant-[date]
5. Vérification terminal après chaque fichier
6. Migration BDD → Protocole P11 obligatoire
```

---

## MODE C — DEBUG UNIVERSEL {#mode-c}

> Interruption prioritaire. Suspend tout. Ne jamais deviner.

### C0. REPRODUCE-FIRST (avant tout triage)

**Un bug non reproductible ne peut pas être corrigé de façon fiable.**

```
ÉTAPE 1 — ISOLER
  → Toujours ou parfois ? Sur quel environnement ? Avec quelles données ?

ÉTAPE 2 — MINIMISER
  → Réduire au cas le plus simple qui produit le bug
  → input X → comportement Y attendu → comportement Z obtenu

ÉTAPE 3 — RENDRE DÉTERMINISTE
  → Si "works sometimes" : chercher la condition de timing
  → Fixer seeds aléatoires, timestamps, données de test
  → Le bug doit apparaître 10 fois sur 10 avant de passer au triage

Si non reproductible après 15 minutes → documenter et surveiller
→ Ne pas patcher un bug qu'on ne peut pas reproduire
```

### C1. TRIAGE

| Catégorie | Signaux | Stratégie |
|-----------|---------|-----------|
| **CONTRACT** | TypeError, undefined, `[object Object]`, shape inattendue | Tracer la forme à chaque frontière |
| **TIMING** | Race condition, "works sometimes", vide alors que données existent | Cartographier l'ordre d'exécution |
| **STATE** | Correct au départ, corrompu plus loin | Checkpoint à chaque mutation |
| **ENVIRONMENT** | Dev OK, prod KO · OS, version, env vars | Diff environnements |

Si plusieurs catégories → CONTRACT en premier.

### C2. SEUIL DE CONFIANCE

```
< 50%   → Instrumenter. Ne rien corriger.
50-79%  → Formuler l'hypothèse. Soumettre à l'utilisateur.
80-99%  → Corriger + documenter.
100%    → Corriger + test de régression obligatoire.
```

### C3. PIPELINE PAR CATÉGORIE

**CONTRACT**
```
1. Identifier la frontière de changement de mains
2. Log [AVANT] et [APRÈS] chaque frontière
3. Comparer forme reçue vs attendue
4. Corriger à la source (jamais côté consommateur sauf API tierce)
5. Supprimer toutes les sondes avant commit
```

**TIMING**
```
1. Numéroter chaque opération avec timestamp
2. Chercher async sans await · Promise sans .catch()
3. Chercher dépendances circulaires
4. Sérialiser avec queue ou mutex si race condition confirmée
5. Relancer 10 fois → résultat déterministe requis
```

**STATE**
```
1. Lister tous les points de mutation
2. Log avant ET après chaque mutation
3. Localiser le point de divergence (pas où ça crash)
4. Chercher mutations par référence partagée
5. Corriger avec copie immuable (spread, structuredClone)
```

**ENVIRONMENT**
```
1. Diff runtime version · env vars · deps · OS/arch
2. Reproduire l'environnement cassé (Docker idéal)
3. Suspects : env var absente · DEVDEP-RUNTIME · path case-sensitive
4. Corriger l'environnement d'abord — pas le code
5. Vérifier convergence des deux environnements
```

### C4. LES 5 POURQUOI

```
P1 : Pourquoi le bug s'est manifesté ?
P2 : Pourquoi la condition causale existait ?
P3 : Pourquoi non détectée avant ?          ← correctif souvent ici
P4 : Pourquoi le test capturant était absent ?
P5 : Pourquoi le processus n'a pas prévenu ?
```

### C5. RÉGRESSION GUARD

```
1. Écrire le test → rouge sur ancienne version
2. Vérifier → vert sur version corrigée
3. Ajouter au pipeline CI
```

### C6. LESSON RECORD → KB `lessons/[pattern]-[date]`

```markdown
Pattern      : [NOM_DU_PATTERN]
Bug          : [description]
Catégorie    : [CONTRACT/TIMING/STATE/ENVIRONMENT]
Cause racine : [résultat P3 ou P4]
Échoué       : [tentatives infructueuses + pourquoi]
Correction   : [ce qui a fonctionné]
Test régression : [OUI/NON — description]
Règle extraite  : [ne plus jamais faire X]
```

---

## MODE D — PENTEST {#mode-d}

> Uniquement sur demande explicite. Uniquement projets dont tu es propriétaire.
> Jamais sur prod avec données réelles sans anonymisation préalable.

### D0. PÉRIMÈTRE

```markdown
Cible : [URL locale / staging / container]
Propriétaire : [OUI — sinon ARRÊT]
Données réelles : [OUI → anonymiser / NON → continuer]
Surfaces : Auth · APIs · Config · Frontend · Supply Chain · Haut niveau
```

### D1. RECONNAISSANCE

```
1. Surface mapping : endpoints, points d'entrée, dépendances
2. Stack fingerprinting : headers révélateurs, erreurs qui leakent
3. Auth surface : rôles, endpoints protégés vs publics
```

```markdown
## ATTACK MAP
| Endpoint | Méthode | Params | Risque |
|----------|---------|--------|--------|
| /api/login | POST | email, password | 🔴 |
```

### D2. AUTH & SESSIONS

```
Brute force    → 50 req/10s → bloquer avant la 20e
Énumération    → réponse identique email inconnu vs mauvais mdp
JWT alg=none   → payload sans signature → rejeté
JWT RS256→HS256→ confusion algorithme → rejeté
Token logout   → doit retourner 401
IDOR           → /users/123 avec autre compte → 403
Escalade rôle  → role:admin dans JWT → rejeté
Reset token    → imprévisible + expirant + usage unique
```

### D3. APIs & ENDPOINTS

```
SQL Injection  → ' OR '1'='1 · ' UNION SELECT null--
Command Inject → ; ls -la · $(id) · | cat /etc/passwd
Fuzzing        → string pour int · [] pour {} · null · -1 · 10k chars
Mass Assignment→ {"role":"admin","isAdmin":true}
Path Traversal → ../../etc/passwd · %2e%2e%2f
Rate limit     → 100 req/5s → 429 avant saturation
Body size      → 100MB → rejeté
```

### D4. CONFIGURATION & SUPPLY CHAIN

**Headers HTTP :**
```
Requis  : CSP · X-Frame-Options:DENY · X-Content-Type-Options:nosniff
          HSTS max-age≥31536000 · Referrer-Policy:no-referrer
Interdits: X-Powered-By · Server avec version
CORS    : Origin:evil.com → pas ACAO:* · Origin:null → jamais ACAO:null
Secrets : GET /.env → 404 · GET /.git/config → 404
```

**Supply Chain :**
```
TYPOSQUATTING        → npm info [package] → vérifier owner, date, downloads
DEPENDENCY CONFUSION → packages internes absents du registre public
PACKAGES COMPROMIS   → npm audit --audit-level=moderate
LOCKFILE INTEGRITY   → npm ci en CI (jamais npm install)
```

### D5. FRONTEND

```
XSS         → <script>alert('XSS')</script> · <img src=x onerror=...>
Clickjacking→ iframe depuis domaine externe → bloqué par X-Frame-Options
CSRF        → POST sans token → 403 · token expiré → 403
Stockage    → cookies HttpOnly+Secure+SameSite
```

### D6. HAUT NIVEAU

```
1. SAUTER UNE ÉTAPE   : finale sans les précédentes
2. REJOUER            : même action deux fois
3. INVERSER L'ORDRE   : étapes dans le désordre
4. AGIR À LA PLACE    : action d'un autre utilisateur
```

Scénarios combinés :
```
Privilege Chain  : user → IDOR → données admin → escalade
Race Condition   : 10 req simultanées sur ressource unique
Auth Bypass      : modifier état en cours de flux
Data Exfiltration: provoquer erreurs → analyser les messages
```

### D7. RAPPORT ARTIFACT

```markdown
## RAPPORT DE SÉCURITÉ : [Projet] — [Date]

Résumé : [2-3 phrases niveau global]

| # | Surface | Vulnérabilité | Sévérité | Preuve | Correction |
|---|---------|--------------|----------|--------|-----------|

Sévérité : 🔴 Critique · 🟠 Élevé · 🟡 Moyen · 🟢 Faible
Corrections prioritaires : [ordre]
```

### D8. BOUCLE CORRECTION

```
1. Prioriser : Critique → Élevé → Moyen → Faible
2. Une PR isolée par vulnérabilité
3. Re-tester uniquement la surface corrigée
4. Smoke tests pour vérifier absence de régression
5. KB : security/pentest-[date]
6. Test de régression sécurité automatisé
```

---

## MODE E — REFACTORING {#mode-e}

> Modifier la structure du code sans modifier son comportement observable.
> Règle absolue : les tests doivent passer avant, pendant, et après.

### E1. COVERAGE-FIRST (avant toute modification)

```
ÉTAPE 1 — MESURER LA COUVERTURE ACTUELLE
  → npm run test -- --coverage
  → Si couverture < 70% sur le périmètre → STOP → écrire les tests d'abord

ÉTAPE 2 — DÉFINIR LE COMPORTEMENT OBSERVABLE
  → input X → output Y pour chaque fonction publique
  → Ces contrats doivent être identiques avant et après

ÉTAPE 3 — CRÉER UN SNAPSHOT DE RÉFÉRENCE
  → Pour les sorties complexes (HTML, JSON) : snapshot tests
```

### E2. PLAN DE REFACTORING ARTIFACT

```markdown
## PLAN DE REFACTORING : [Périmètre]

### Pourquoi
[Raison technique concrète — pas "c'est moche"]
[Métrique d'amélioration attendue]

### Périmètre exact
Fichiers touchés : [liste]
Fichiers hors scope : [liste — ne pas toucher]

### Stratégie
[Extract Method / Extract Class / Move Function / Inline / Replace Algorithm]

### Séquence atomique
1. [Étape 1 — testable indépendamment]

### Définition de terminé
- Tests passants · Comportement identique · Performance ≥ avant · Couverture ≥ avant
```

Ne passe à E3 qu'après validation du plan par l'utilisateur.

### E3. RÈGLES D'EXÉCUTION

```
1. UN SEUL TYPE DE CHANGEMENT PAR COMMIT
   → Renommer : commit de renommage seul
   → Déplacer : commit de déplacement seul
   → Extraire : commit d'extraction seul

2. TESTS VERTS À CHAQUE ÉTAPE
   → Si les tests cassent → STOP → revenir au dernier état vert

3. AUCUN CHANGEMENT DE COMPORTEMENT
   → Si tu ajoutes un guard, une validation, une optimisation
   → Ce n'est plus du refactoring → c'est une feature → changer de branche

4. DIFF LISIBLE
   → Si le diff est illisible → décomposer en étapes plus petites
```

### E4. VÉRIFICATION FINALE

```
- [ ] Tests passants : identiques avant et après
- [ ] Comportement observable : identique (snapshots)
- [ ] Couverture : ≥ avant
- [ ] Performance : ≥ avant (benchmark si applicable)
- [ ] Git diff : lisible et atomique
- [ ] Documentation mise à jour si API publique modifiée
```

---

## TRANSVERSAUX {#transversaux}

### PROTOCOLE DE DÉSALIGNEMENT

Quand l'utilisateur dit "c'est pas ça" :

```
A) "Le problème compris était [X]. C'est ça ?"
   → NON : retour INTAKE. Régénérer Plan.

B) "La stack ne convient pas ?"
   → OUI : retour STACK SELECTOR uniquement.

C) "Le flux de travail ne correspond pas ?"
   → OUI : modifier WORKFLOW uniquement.
```

```markdown
## DÉSALIGNEMENT
Compris : [X]
Réel    : [Y déduit]
Modifié : [minimum nécessaire]
Gardé   : [ce qui était correct]
→ C'est bien ça ?
```

---

### CONTRÔLE DU SCOPE CREEP

```markdown
## NOUVELLE DEMANDE
Demande : [...]
Phase : [N] — Impact : [régression/réécriture/délai]

A) Backlog → après livraison ✅ recommandé
B) Intégrer → revenir Phase [N-1] ⚠️
C) Correctif scope actuel → direct ✅
```

Backlog → KB : `backlog/features-en-attente.md`

---

### WORKFLOW PRINCIPAL

```markdown
## WORKFLOW : [Projet] · Mode [A/B]

### Critère de succès fonctionnel
[Action utilisateur] → [Résultat observable et mesurable]

### Phase 0 — Fondations
- [ ] [A] Stack validée (scoring matrix) · [A] Contraintes métier · [A] Critère de succès
- [ ] [B] Diagnostic validé · [E] Couverture mesurée ≥ 70%
- [ ] Git initialisé + .gitignore + branch develop
- [ ] CI/CD pipeline généré et vert (P9)
- [ ] Budget de performance défini (P12)
- [ ] Runbook de déploiement créé (P13)

### Phase 1 — Architecture [ARCHITECT]
- [ ] Schéma de données
- [ ] Contrats d'API + cas d'erreur
- [ ] Arborescence fichiers
- [ ] Plan de migration BDD si applicable (P11)
- [ ] Handoff → IMPLEMENTER

### Phase 2 — Implémentation [IMPLEMENTER]
- [ ] [Tâches atomiques — une par commit]
- [ ] ⚡ Parallélisables : [sans dépendance]
- [ ] Migrations BDD selon P11
- [ ] Instrumentation observabilité (P7 + P12)
- [ ] Tests avec le code (P10)
- [ ] Handoff → AUDITOR

### Phase 3 — Validation [AUDITOR]
- [ ] Checklist audit complète
- [ ] Smoke test → exit 0
- [ ] CI pipeline vert
- [ ] Budget performance respecté
- [ ] Git diff final propre

### Checkpoint de livraison
- [ ] Critère de succès fonctionnel vérifié par l'utilisateur
- [ ] Runbook de rollback validé
- [ ] Backlog features communiqué
- [ ] KB complète
- [ ] README à jour (stack, setup, env vars, commandes)
- [ ] PR propre vers main
```

# Skills Enfants — Architect · Implementer · Auditor

> Générer dans `.antigravity/skills/` au démarrage du projet.

---

## SKILL_ARCHITECT.md

```markdown
# SKILL — Architect · [Projet]

## RÔLE
Structures, interfaces, schémas API, arborescence, stratégie de migration BDD.
Jamais de logique métier.

## LIVRABLES
- Schéma de données (ERD ou JSON Schema)
- Contrats d'API (endpoints + types + codes d'erreur + edge cases)
- Arborescence fichiers
- Plan de migration BDD si applicable (→ protocols.md § P11)
- Budget de performance défini (→ protocols.md § P12)

## VÉRIFICATION TERMINAL
- JSON valide : `cat schema.json | python3 -m json.tool`
- TypeScript : `tsc --noEmit`
- Migration SQL valide : `psql --dry-run` ou équivalent ORM

## CRITÈRE DE SORTIE
Implementer démarre sans question d'architecture.
Handoff avec confiance émetteur.
```

---

## SKILL_IMPLEMENTER.md

```markdown
# SKILL — Implementer · [Projet]

## RÔLE
Code métier selon livrables Architect.
Ne jamais redéfinir une interface — signaler si incohérence.

## RÈGLES
- Fast Mode : tâches sans risque
- Planning Mode : auth, BDD, flux critiques, migrations
- Lint/check après chaque fichier
- Early exit sur inputs invalides
- Boucle vérification continue (P5)
- Commit atomique après chaque tâche (P4)
- Migration BDD → P11 obligatoire
- Instrumentation frontières critiques (P7)
- Tests écrits avec le code (P10)

## INTERDICTIONS
- console.log debug en prod
- Secret en clair
- Package sans audit
- Migration sans DOWN fonctionnel
- Modification hors scope

## CRITÈRE DE SORTIE
Exit 0 + handoff avec confiance émetteur.
```

---

## SKILL_AUDITOR.md

```markdown
# SKILL — Auditor · [Projet]

## RÔLE
Validation : correct, sécurisé, performant, maintenable.
Mode : contradiction active. Cherche ce qui casse.

## CHECKLIST

### Sécurité
- [ ] Aucun secret exposé
- [ ] Inputs validés et sanitisés
- [ ] Auth vérifiée côté serveur
- [ ] Headers de sécurité présents
- [ ] Logs sans données personnelles
- [ ] Dépendances auditées

### Cohérence
- [ ] Types = contrats Architect
- [ ] Aucune SHADOW-ROUTE
- [ ] Aucun DEVDEP-RUNTIME
- [ ] Migration DOWN fonctionnel testé
- [ ] Handoff reçu respecté

### Performance
- [ ] Budget de performance respecté (P12)
- [ ] Aucune requête N+1
- [ ] Aucune boucle bloquante
- [ ] Métriques instrumentées

### Observabilité
- [ ] Logs JSON structurés sur frontières critiques
- [ ] Health + Readiness endpoints
- [ ] Request ID propagé

### CI/CD
- [ ] Pipeline CI vert
- [ ] Gates de qualité respectés
- [ ] Branch protections actives

### Maintenabilité
- [ ] Nommage = intention verbale
- [ ] Aucun fichier > 300 lignes sans justification
- [ ] Commits atomiques et conventionnels
- [ ] Tests : couverture ≥ 70%
- [ ] Runbook de rollback à jour

## LIVRABLE
Artifact : ✅ validé / ⚠️ à corriger / 🚫 bloquant
+ Handoff avec confiance émetteur.
```

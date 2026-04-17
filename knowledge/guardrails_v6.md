# GUARDRAILS — WG-FUX v6.0

Ce document définit les seuils de qualité et de performance non-négociables du projet.

## 1. Qualité du Code (CI)

| Critère | Seuil Bloquant | État Actuel (Phase 0) |
|---------|----------------|-----------------------|
| **Couverture (Backend)** | ≥ 70% | **22.02%** (DRIFT) |
| **Couverture (Frontend)** | ≥ 70% | **0.00%** (DRIFT) |
| **Audit Sécurité** | 0 vuln High/Crit | 0 vuln (Pass) |
| **Lint** | 0 erreur | Pass |
| **Build** | Succès requis | Pass |

> [!WARNING]
> La couverture actuelle est très en dessous du standard P9. La priorité de la Phase 1 sera d'augmenter cette couverture par des tests unitaires et d'intégration.

## 2. Budget de Performance

Les métriques suivantes sont mesurées en environnement de staging/prod.

| Composant | Métrique | Cible (p95) | Seuil d'Alerte |
|-----------|----------|-------------|----------------|
| **API** | Réponse HTTP | < 500ms | > 1000ms |
| **BDD** | Latence Query | < 100ms | > 200ms |
| **UI** | FCP (First Paint) | < 1.5s | > 2.0s |
| **Système** | Erreurs (Rate) | < 0.1% | > 1.0% |

## 3. Observabilité

- Chaque requête API doit loguer au format JSON structuré (P7).
- Le `trace-id` doit être propagé entre le frontend et le backend.
- Les logs ne doivent contenir AUCUNE information sensible (secrets, tokens, passwords).

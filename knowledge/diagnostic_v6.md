## DIAGNOSTIC : WG-FUX (Meta-Skill V6 Integration)

**Stack réelle :**
- **Backend** : Node.js (Express), Drizzle ORM, SQLite, Vitest, Zod.
- **Frontend** : React (Vite), Tailwind CSS, Framer Motion, Recharts, Vitest.
- **Infra** : Docker Compose, GitHub Actions.
- **Sécurité** : 2FA (otplib), JWT, Helmet, Rate-limit, TruffleHog.

**CI existant :** OUI — GitHub Actions (`ci.yml`).
**Tests :** OUI — Vitest (Backend & Frontend), mais sans enforcement de couverture.
**Migrations :** OUI — Drizzle Kit.

**Écarts :**
- **DOC-DRIFT** : NON (README et setup.sh semblent à jour).
- **DEVDEP-RUNTIME** : OUI (certains packages `devDependencies` sont utilisés en runtime potentiellement, à vérifier).
- **Secrets exposés** : NON (TruffleHog actif, `.env` ignoré).
- **Dead code** : Quelques scripts PoC dans `scripts/` pourraient être nettoyés.
- **Migration non appliquée** : À vérifier via `drizzle-kit status`.
- **CI absente ou cassée** : Active mais incomplète par rapport aux standards P9 (Audit/Coverage).

**Impact de la demande :**
- **Fichiers touchés** : `.github/workflows/ci.yml`, `api-service/package.json`, `dashboard-ui/package.json`, `knowledge/`.
- **Migration BDD requise** : NON.
- **Régression** : Faible (Phase 0 ne touche pas à la logique métier).

**Recommandation :** Initialiser la Phase 0 pour sécuriser la prod avant toute nouvelle feature.

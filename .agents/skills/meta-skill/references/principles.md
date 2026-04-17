# Principes P7-P8 — Instrumentation & Self-Healing

---

## P7 — INSTRUMENTATION PROACTIVE

**Frontières à logger dès l'implémentation :**
```
Entrée API      · Sortie API      · Appel BDD (query + durée ms)
Appel externe   · Auth (succès/échec + userId) · Erreur catchée
```

**Format JSON structuré :**
```json
{
  "timestamp": "ISO8601",
  "level": "info|warn|error",
  "event": "nom_evenement",
  "context": { "userId": "...", "requestId": "..." },
  "duration_ms": 42,
  "result": "success|failure"
}
```

INTERDIT : `console.log("debug")` · Logger email/password/token

---

## P8 — SELF-HEALING LOOP

```
DÉRIVE                    SIGNAL                     ACTION
──────────────────────────────────────────────────────────────
Config drift    → env var absente en staging     → .env.example
Dependency drift→ package.json ≠ lock file       → npm ci
Schema drift    → code ≠ migrations              → STOP + signaler
Doc drift       → README ≠ stack réelle          → README update
Test drift      → tests obsolètes qui passent    → marquer + refactoriser
Port conflict   → port occupé                    → détecter + alternative
Migration drift → migration non appliquée        → STOP + signaler
```

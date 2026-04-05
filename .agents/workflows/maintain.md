---
description: Maintenance et Hardening WG-FUX (v6.5 Obsidian)
---

// turbo-all
Ce workflow assure la maintenance régulière du système WG-FUX en suivant le protocole de fiabilité Obsidian.

1. **Scan d'Audit Initial**
Exécuter l'audit complet du système.
```bash
bash .vibe/tools/vibe-audit-v6.5.sh
```

2. **Mise à jour des Sources (Facultatif)**
Si des modifications ont été effectuées sur les scripts `core-vpn/scripts/`, reconstruire l'API pour éviter le Shadow Code Drift.
```bash
sudo docker compose up -d --build api
```

3. **Vérification d'Intégrité (Zéro-Délai)**
Valider que tous les paramètres de sécurité et de ressources sont appliqués.
```bash
bash .vibe/tools/verify-v6.5-integrity.sh
```

4. **Nettoyage du Cache (SRE Blast Radius)**
Libérer l'espace disque si nécessaire.
```bash
sudo docker system prune -f --filter "until=24h"
```

5. **Signature d'Audit**
Confirmer l'état final.
```bash
echo "[$(date)] Maintenance terminée - Status 0" >> logs/maintenance.log
```

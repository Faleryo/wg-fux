# Knowledge Item: Durcissement de Sécurité (Security Hardening) - WG-FUX

## 🛡️ Mesures d'Immunité Implémentées

### 1. Authentification & Autorisation
- **Retrait des bypass par défaut** : Suppression de toute valeur par défaut pour `SENTINEL_TOKEN`. Le système utilise désormais un mode "Fail-Closed" (échec par défaut).
- **Validation temporelle (Timing-Safe)** : La vérification des mots de passe utilise `crypto.timingSafeEqual` avec une vérification stricte de la longueur des buffers pour empêcher les fuites d'information par timing.

### 2. Validation des Entrées (Input Sanitization)
- **Validation Zod Systématique** : Toutes les routes critiques, y compris la configuration système (`POST /api/system/config`), sont désormais protégées par des schémas Zod.
- **Protection contre les Injections Shell** : Le champ DNS et d'autres paramètres passés aux scripts shell sont validés par des expressions régulières restrictives :
  - Regex DNS : `/^[a-zA-Z0-9\s.,-]+$/`
  - Identifiants : `/^[a-zA-Z0-9_-]+$/`

### 3. Moindre Privilège (Least Privilege)
- **Helpers de File System Privilégiés** : Utilisation de `sudo` avec des binaires spécifiques (`ls`, `tee`, `test`, `rm`) autorisés dans le `sudoers` du container, évitant ainsi de faire tourner l'API complète en `root`.

## 🧪 Protocole de Test "Big Sleep"
Le système est validé par des scripts de Red Teaming (`evil-exploit-*.sh`) qui simulent :
- Contournement d'auth via token par défaut.
- Injection de commande shell via les APIs de configuration.

## ⚠️ Recommandations de Maintenance
- Ne jamais désactiver les schémas Zod dans `src/routes/`.
- Toujours utiliser `writeFileAsRoot` pour toute écriture dans `/etc/wireguard/`.
- Maintenir `SENTINEL_TOKEN` sous forme de secret fort dans les variables d'environnement de production.

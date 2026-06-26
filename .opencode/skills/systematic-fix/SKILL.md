---
name: systematic-fix
description: Use when fixing bugs to ensure all occurrences of the same pattern are found and fixed. Prevents partial fixes.
---

# Systematic Fix

Quand tu corriges un bug, tu dois **toujours** vérifier s'il y a d'autres occurrences du même pattern.

## Procédure obligatoire

1. Identifie le pattern exact qui cause le bug
2. Avant d'appliquer la correction, cherche toutes les occurrences :
   ```
   grep -n "<pattern>" <fichiers-concernés>
   ```
3. Corrige TOUTES les occurrences en une fois
4. Vérifie avec un second grep qu'il n'en reste aucune
5. Si le pattern apparaît dans plusieurs fichiers, vérifie chaque fichier

## Exemple

```
Bug: style prop inside cn() call in UsersSection.jsx:108
→ grep "style={" UsersSection.jsx → trouve 4 `style`, vérifie chacun
→ Ne pas s'arrêter à la première occurrence corrigée
```

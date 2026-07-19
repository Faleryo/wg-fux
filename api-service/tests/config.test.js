/**
 * getScriptPath() — résolveur de chemin de script (api-service/src/services/config.js).
 *
 * C'est le "god node" bridge du graphe (23 arêtes) : quasiment toute exécution
 * shell (routes/clients.js, jobs.js, services/scripts.js, notifications.js…)
 * passe par lui pour obtenir le chemin d'un script. Couverture dédiée pour
 * empêcher une régression silencieuse du garde-fou anti path-traversal.
 */
import { describe, it, expect } from 'vitest';
const path = require('path');
const { getScriptPath, SCRIPT_DIR } = require('../src/services/config');

describe('getScriptPath', () => {
  it('résout un nom de script simple sous SCRIPT_DIR', () => {
    expect(getScriptPath('wg-stats.sh')).toBe(path.join(SCRIPT_DIR, 'wg-stats.sh'));
  });

  it('rejette un nom de script contenant une traversée de répertoire', () => {
    expect(() => getScriptPath('../../../etc/passwd')).toThrow(/Invalid script name/);
    expect(() => getScriptPath('../evil.sh')).toThrow(/Invalid script name/);
  });

  it('rejette un nom de script contenant un séparateur de chemin (sous-répertoire)', () => {
    expect(() => getScriptPath('sub/dir/script.sh')).toThrow(/Invalid script name/);
  });

  it('accepte un chemin absolu sous un préfixe autorisé', () => {
    expect(getScriptPath('/usr/local/bin/wg-stats.sh')).toBe('/usr/local/bin/wg-stats.sh');
    expect(getScriptPath('/app/core-vpn/scripts/wg-stats.sh')).toBe(
      '/app/core-vpn/scripts/wg-stats.sh'
    );
  });

  it('rejette un chemin absolu hors des préfixes autorisés', () => {
    expect(() => getScriptPath('/etc/passwd')).toThrow(/Forbidden script path/);
    expect(() => getScriptPath('/tmp/evil.sh')).toThrow(/Forbidden script path/);
  });

  it('rejette un chemin absolu qui usurpe un préfixe autorisé par similarité de préfixe texte', () => {
    // "/usr/local/bin-evil/x" commence par la même chaîne que "/usr/local/bin"
    // mais n'est PAS un sous-répertoire : doit être rejeté (pas de bypass par
    // préfixage de nom de dossier voisin).
    expect(() => getScriptPath('/usr/local/bin-evil/x.sh')).toThrow(/Forbidden script path/);
  });

  it('rejette un chemin relatif ./ résolu hors des préfixes autorisés', () => {
    expect(() => getScriptPath('./../../etc/passwd')).toThrow(/Forbidden relative script path/);
  });
});

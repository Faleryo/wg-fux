/**
 * Bilan d'application d'un profil d'optimisation (routes/system.js).
 *
 * CONSTAT (mesuré sur la plateforme le 2026-08-17) : `wg-optimize.sh` s'exécute
 * DANS le conteneur api, dont /proc/sys est monté en lecture seule. Chaque
 * `sysctl -w` y échoue — et `apply_sysctl` avalait l'échec, si bien que le
 * script terminait sur « Profile DONE » et que l'interface affichait
 * « Profil GAMING activé » alors qu'AUCUN réglage noyau n'avait changé. BBR
 * n'est d'ailleurs même pas disponible dans ce noyau (reno/cubic seulement).
 *
 * Le script émet désormais une ligne de bilan ; c'est ce parseur qui décide si
 * l'interface annonce un vrai succès ou un « QoS seule ». D'où ces tests.
 */
import { describe, it, expect } from 'vitest';

const { parseOptimizeSummary } = require('../src/routes/system');

const LIGNE = (o) => `WGFUX_SUMMARY ${JSON.stringify(o)}`;

describe('parseOptimizeSummary', () => {
  it('extrait le bilan en fin de sortie', () => {
    const out = ['[gaming] ✓ QoS', LIGNE({ profile: 'gaming', sysctlApplied: 12 })].join('\n');
    expect(parseOptimizeSummary(out)).toMatchObject({ profile: 'gaming', sysctlApplied: 12 });
  });

  it('distingue « rien appliqué » d’un vrai succès', () => {
    const rien = parseOptimizeSummary(
      LIGNE({ sysctlApplied: 0, sysctlSkipped: 34, kernelTunable: false, qos: 'active' })
    );
    expect(rien.kernelTunable).toBe(false);
    expect(rien.sysctlSkipped).toBe(34);

    const ok = parseOptimizeSummary(LIGNE({ sysctlApplied: 30, kernelTunable: true }));
    expect(ok.kernelTunable).toBe(true);
  });

  it('remonte la disponibilité réelle de BBR', () => {
    // L'interface promettait « BBR v2 » sur un noyau qui ne propose que cubic.
    expect(parseOptimizeSummary(LIGNE({ bbrAvailable: false })).bbrAvailable).toBe(false);
  });

  it('retient la DERNIÈRE ligne si le script en a émis plusieurs', () => {
    // Le mode `auto` se relance via exec sur gaming/streaming : deux bilans.
    const out = [LIGNE({ profile: 'auto' }), LIGNE({ profile: 'streaming' })].join('\n');
    expect(parseOptimizeSummary(out).profile).toBe('streaming');
  });

  it('renvoie null si le script est antérieur au bilan', () => {
    // Instance pas encore mise à jour : pas de ligne WGFUX_SUMMARY.
    expect(parseOptimizeSummary('[gaming] Profile DONE')).toBeNull();
  });

  it('renvoie null sur une sortie absente, vide ou non textuelle', () => {
    expect(parseOptimizeSummary(null)).toBeNull();
    expect(parseOptimizeSummary('')).toBeNull();
    expect(parseOptimizeSummary(undefined)).toBeNull();
    expect(parseOptimizeSummary({})).toBeNull();
  });

  it('renvoie null plutôt que de lever sur un JSON corrompu', () => {
    // Sortie tronquée (script tué en cours d'écriture) : ne doit pas casser la route.
    expect(parseOptimizeSummary('WGFUX_SUMMARY {"profile":"gam')).toBeNull();
  });
});

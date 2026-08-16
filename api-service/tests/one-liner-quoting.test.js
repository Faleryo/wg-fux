/**
 * Quoting du one-liner de provisioning (services/serverProvision.js).
 *
 * BUG (découvert 2026-08-16) : le corps du one-liner contenait des guillemets
 * SIMPLES (`trap '...'`, `--proto '=https'`, `printf '...'`) alors qu'il était
 * lui-même encapsulé entre guillemets simples. Le shell découpait donc la
 * commande en 4 arguments ; `bash -c` n'exécutant que le premier, le script
 * s'arrêtait sur `trap rm` (« trap : utilisation ») — aucun téléchargement,
 * aucune vérification sha256, aucune installation, et un fichier temporaire
 * abandonné dans /tmp à chaque tentative.
 *
 * Les tests d'origine ne comparaient que des sous-chaînes : ils ne pouvaient pas
 * voir le problème. On vérifie ici le comportement RÉEL du shell.
 */
import { describe, it, expect } from 'vitest';
const { execFileSync } = require('child_process');

const { buildOneLiner } = require('../src/services/serverProvision');

const TOKEN = 'AbC-123_xyz';
const SHA = 'a'.repeat(64);
const BASE = 'https://plateforme.example';

// Remplace `bash -c` par un compteur d'arguments et exécute la ligne dans un
// vrai bash : c'est le shell lui-même qui arbitre le quoting, pas une regex.
const countArgs = (oneLiner) => {
  const probe = oneLiner.replace('bash -c', '__probe');
  const script = `__probe() { echo "$#"; }\n${probe}\n`;
  return parseInt(execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim(), 10);
};

// Extrait l'unique argument passé à `bash -c` (le corps du script).
const extractBody = (oneLiner) => {
  const probe = oneLiner.replace('bash -c', '__probe');
  const script = `__probe() { printf '%s' "$1"; }\n${probe}\n`;
  return execFileSync('bash', ['-c', script], { encoding: 'utf8' });
};

describe('buildOneLiner — quoting shell', () => {
  it('passe le script à bash -c en UN SEUL argument', () => {
    const ol = buildOneLiner({ token: TOKEN, scriptSha256: SHA, base: BASE });
    expect(countArgs(ol)).toBe(1);
  });

  it('conserve toutes les étapes critiques dans ce seul argument', () => {
    const body = extractBody(buildOneLiner({ token: TOKEN, scriptSha256: SHA, base: BASE }));
    // Le bug tronquait le corps juste après `trap` : ces étapes disparaissaient.
    expect(body).toContain('curl');
    expect(body).toContain('sha256sum -c -');
    expect(body).toContain('bash "$F"');
    expect(body).toContain('set -euo pipefail');
    expect(body).toContain(`${BASE}/provision/$WG_T/script`);
  });

  it('produit un corps syntaxiquement valide pour bash', () => {
    const body = extractBody(buildOneLiner({ token: TOKEN, scriptSha256: SHA, base: BASE }));
    // bash -n : analyse syntaxique sans exécution. Lève si le corps est malformé.
    expect(() => execFileSync('bash', ['-n'], { input: body })).not.toThrow();
  });

  it('reste en un seul argument avec un pin TLS configuré', () => {
    const saved = process.env.TLS_PINNED_PUBKEY;
    process.env.TLS_PINNED_PUBKEY = 'sha256//AAAAbbbbCCCC+dddd/eeee=';
    try {
      const ol = buildOneLiner({ token: TOKEN, scriptSha256: SHA, base: BASE });
      expect(ol).toContain('--pinnedpubkey');
      expect(countArgs(ol)).toBe(1);
      expect(extractBody(ol)).toContain('sha256//AAAAbbbbCCCC+dddd/eeee=');
    } finally {
      if (saved === undefined) delete process.env.TLS_PINNED_PUBKEY;
      else process.env.TLS_PINNED_PUBKEY = saved;
    }
  });

  it('ignore un pin TLS au format inattendu plutôt que de l’injecter', () => {
    const saved = process.env.TLS_PINNED_PUBKEY;
    // Tentative d'évasion : guillemet + substitution de commande.
    process.env.TLS_PINNED_PUBKEY = '"; touch /tmp/pwned; echo "';
    try {
      const ol = buildOneLiner({ token: TOKEN, scriptSha256: SHA, base: BASE });
      expect(ol).not.toContain('--pinnedpubkey');
      expect(ol).not.toContain('pwned');
      expect(countArgs(ol)).toBe(1);
    } finally {
      if (saved === undefined) delete process.env.TLS_PINNED_PUBKEY;
      else process.env.TLS_PINNED_PUBKEY = saved;
    }
  });

  it('résisterait à un guillemet simple réintroduit dans le corps', () => {
    // shQuote() est le filet : même si une future modification remet un ' dans
    // le corps, la commande doit rester en un seul argument.
    const ol = buildOneLiner({ token: TOKEN, scriptSha256: SHA, base: "https://o'brien.example" });
    expect(countArgs(ol)).toBe(1);
    expect(extractBody(ol)).toContain("o'brien.example");
  });
});

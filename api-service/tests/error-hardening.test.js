/**
 * Tâche #1 — Information disclosure dans le gestionnaire d'erreurs global.
 *
 * buildErrorBody() est la fonction pure derrière le gestionnaire d'erreurs
 * Express final (server.js). On la teste directement (pas besoin de booter le
 * serveur en mode production, ce qui déclencherait les gardes FATAL de démarrage).
 *
 * Contrat :
 *  - En production, une erreur SERVEUR (5xx) ne renvoie NI stack trace NI message
 *    brut (qui peut contenir un chemin de fichier interne, une requête SQL…) :
 *    juste un message générique + un code stable.
 *  - En dev, on garde le détail.
 *  - Les erreurs CLIENT (4xx) restent explicites dans les deux modes.
 *  - La stack n'apparaît JAMAIS dans le corps (elle n'est journalisée qu'en interne).
 */
import { describe, it, expect } from 'vitest';
const { buildErrorBody } = require('../src/utils/errors');

// Une exception réaliste dont le message trahit un chemin interne + un secret.
function makeLeakyError() {
  const err = new Error(
    "SQLITE_ERROR: no such table at /app/src/services/init.js:42 (secret=abcd1234)"
  );
  err.status = 500;
  err.stack =
    'Error: SQLITE_ERROR\n    at /app/src/services/init.js:42\n    at /app/server.js:99';
  return err;
}

describe('buildErrorBody — hardening information disclosure', () => {
  it('production + 5xx : message générique, aucun chemin/stack/secret', () => {
    const err = makeLeakyError();
    const { statusCode, body } = buildErrorBody(err, { path: '/api/x', isProd: true });

    expect(statusCode).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.error).toBe('Internal Server Error');
    expect(body.message).toBe('An internal error occurred. Please try again later.');

    // Rien qui trahisse l'interne.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('/app/');
    expect(serialized).not.toContain('init.js');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('SQLITE_ERROR');
    // Pas de stack ni de champ path/details exposant l'interne.
    expect(body).not.toHaveProperty('stack');
    expect(body.path).toBeUndefined();
    expect(body.details).toBeUndefined();
  });

  it('dev + 5xx : le détail brut est conservé pour déboguer', () => {
    const err = makeLeakyError();
    const { body } = buildErrorBody(err, { path: '/api/x', isProd: false });

    expect(body.message).toContain('SQLITE_ERROR');
    expect(body.path).toBe('/api/x');
    // Toujours pas de stack dans la réponse HTTP, même en dev.
    expect(body).not.toHaveProperty('stack');
  });

  it('production + 4xx : erreur client explicite (message conservé, code stable)', () => {
    const err = new Error('Champ "name" requis');
    err.status = 400;
    err.code = 'VALIDATION_ERROR';
    err.details = [{ path: 'name', message: 'requis' }];

    const { statusCode, body } = buildErrorBody(err, { path: '/api/clients', isProd: true });

    expect(statusCode).toBe(400);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.message).toBe('Champ "name" requis');
    expect(body.details).toEqual([{ path: 'name', message: 'requis' }]);
  });

  it('erreur sans status → 500 par défaut, masqué en production', () => {
    const { statusCode, body } = buildErrorBody(new Error('boom'), { isProd: true });
    expect(statusCode).toBe(500);
    expect(body.message).toBe('An internal error occurred. Please try again later.');
  });
});

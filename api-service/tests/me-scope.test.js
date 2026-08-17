/**
 * Cloisonnement de « Mon compte » (routes/me.js + services/scope.js).
 *
 * POURQUOI CE TEST EXISTE : la table `clients` n'a AUCUNE colonne de
 * propriétaire. Un peer n'est rattaché à un utilisateur qu'indirectement, via
 * `containers.owner`. La frontière entre deux comptes n'est donc garantie ni par
 * le schéma ni par une contrainte SQL — uniquement par un filtre applicatif,
 * jusqu'ici recopié à la main dans chaque route. Une lecture écrite sans ce
 * filtre renvoie les peers de TOUTE la plateforme au premier venu.
 *
 * On verrouille donc le comportement du helper partagé, et pas seulement le
 * chemin nominal : le cas qui compte est « l'utilisateur B ne voit RIEN de A ».
 */
import { describe, it, expect, beforeAll } from 'vitest';

let db, schema, filterVisibleClients, visibleContainerNames;

const ALICE = { role: 'viewer', username: 'scope_alice' };
const BOB = { role: 'viewer', username: 'scope_bob' };
const ADMIN = { role: 'admin', username: 'scope_admin' };
const MANAGER = { role: 'manager', username: 'scope_manager' };

beforeAll(async () => {
  const { initializeDatabase } = require('../src/services/init');
  await initializeDatabase().catch(() => {});
  ({ db, schema } = require('../db'));
  ({ filterVisibleClients, visibleContainerNames } = require('../src/services/scope'));

  await db
    .insert(schema.containers)
    .values([
      { name: 'scope_cont_alice', owner: ALICE.username, interface: 'wg0' },
      { name: 'scope_cont_bob', owner: BOB.username, interface: 'wg0' },
    ])
    .onConflictDoNothing();
});

// Jeu de peers indépendant de la base : on teste le FILTRE, pas la requête.
const CLIENTS = [
  { id: 1, name: 'a1', container: 'scope_cont_alice' },
  { id: 2, name: 'a2', container: 'scope_cont_alice' },
  { id: 3, name: 'b1', container: 'scope_cont_bob' },
];

describe('filterVisibleClients — frontière entre comptes', () => {
  it('ne rend à Alice que les peers de SES conteneurs', () => {
    const seen = filterVisibleClients(ALICE, CLIENTS);
    expect(seen.map((c) => c.name).sort()).toEqual(['a1', 'a2']);
  });

  it('ne laisse RIEN fuiter de Bob vers Alice', () => {
    const seen = filterVisibleClients(ALICE, CLIENTS);
    expect(seen.some((c) => c.container === 'scope_cont_bob')).toBe(false);
  });

  it('donne à Bob uniquement son propre peer', () => {
    expect(filterVisibleClients(BOB, CLIENTS).map((c) => c.name)).toEqual(['b1']);
  });

  it('laisse admin et manager voir la totalité', () => {
    expect(filterVisibleClients(ADMIN, CLIENTS)).toHaveLength(3);
    expect(filterVisibleClients(MANAGER, CLIENTS)).toHaveLength(3);
  });

  it('ne rend rien à un compte sans conteneur', () => {
    expect(filterVisibleClients({ role: 'viewer', username: 'scope_inconnu' }, CLIENTS)).toEqual([]);
  });

  it('ne rend rien pour un utilisateur absent ou malformé (fail-closed)', () => {
    // Un rôle non reconnu ne doit jamais élargir la visibilité.
    expect(filterVisibleClients({}, CLIENTS)).toEqual([]);
    expect(filterVisibleClients(null, CLIENTS)).toEqual([]);
  });

  it('tolère une liste vide sans lever', () => {
    expect(filterVisibleClients(ALICE, [])).toEqual([]);
    expect(filterVisibleClients(ALICE, null)).toEqual([]);
  });
});

describe('visibleContainerNames', () => {
  it("liste les conteneurs possédés par l'utilisateur", () => {
    const names = visibleContainerNames(ALICE);
    expect(names.has('scope_cont_alice')).toBe(true);
    expect(names.has('scope_cont_bob')).toBe(false);
  });

  it("inclut ceux d'autrui pour un admin", () => {
    const names = visibleContainerNames(ADMIN);
    expect(names.has('scope_cont_alice')).toBe(true);
    expect(names.has('scope_cont_bob')).toBe(true);
  });
});

describe('daysUntil', () => {
  const { daysUntil } = require('../src/routes/me');

  it('renvoie null sans échéance (compte illimité)', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil('')).toBeNull();
  });

  it('renvoie un nombre négatif pour une date passée', () => {
    expect(daysUntil(new Date(Date.now() - 3 * 86400000))).toBeLessThan(0);
  });

  it('renvoie un nombre positif pour une date future', () => {
    expect(daysUntil(new Date(Date.now() + 5 * 86400000))).toBeGreaterThan(0);
  });
});

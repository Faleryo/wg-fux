/**
 * Synchronisation des identifiants admin depuis .env (services/init.js).
 *
 * BUG (verrouillage constaté en production le 2026-08-16) : la synchro écrasait
 * systématiquement le mot de passe admin de la DB par celui du .env dès qu'ils
 * différaient. Un changement de mot de passe fait depuis l'INTERFACE ne touche
 * que la DB → chaque redémarrage de conteneur restaurait silencieusement
 * l'ancien mot de passe d'installation, et l'administrateur se retrouvait
 * dehors avec un simple 401.
 *
 * Règle attendue :
 *   - .env modifié (setup.sh --reset-password) → le .env fait foi, on synchronise.
 *   - .env inchangé, DB différente (mot de passe changé via l'UI) → la DB fait foi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

let db, schema, sqlite, eq, initializeDatabase;

const ADMIN = 'admin';
const FP_KEY = 'admin_env_credential_fingerprint';

const readAdmin = () =>
  sqlite.prepare('SELECT hash, salt FROM users WHERE username = ?').get(ADMIN);

const setEnvCredentials = (hash, salt) => {
  process.env.ADMIN_USER = ADMIN;
  process.env.ADMIN_PASSWORD_HASH = hash;
  process.env.ADMIN_PASSWORD_SALT = salt;
};

let savedEnv;

beforeAll(async () => {
  ({ initializeDatabase } = require('../src/services/init'));
  await initializeDatabase().catch(() => {});
  ({ db, schema, sqlite } = require('../db'));
  ({ eq } = require('drizzle-orm'));
  savedEnv = {
    user: process.env.ADMIN_USER,
    hash: process.env.ADMIN_PASSWORD_HASH,
    salt: process.env.ADMIN_PASSWORD_SALT,
  };
});

afterAll(() => {
  process.env.ADMIN_USER = savedEnv.user;
  process.env.ADMIN_PASSWORD_HASH = savedEnv.hash;
  process.env.ADMIN_PASSWORD_SALT = savedEnv.salt;
});

describe('sync des identifiants admin au démarrage', () => {
  it('applique le .env quand celui-ci a changé (setup.sh --reset-password)', async () => {
    setEnvCredentials('hash_env_v1', 'salt_env_v1');
    sqlite.prepare('DELETE FROM app_settings WHERE key = ?').run(FP_KEY);

    await initializeDatabase();

    expect(readAdmin()).toMatchObject({ hash: 'hash_env_v1', salt: 'salt_env_v1' });
    // L'empreinte du .env appliqué est mémorisée pour les démarrages suivants.
    const fp = sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get(FP_KEY);
    expect(fp?.value).toBeTruthy();
  });

  it("NE réécrase PAS un mot de passe changé depuis l'UI si le .env n'a pas bougé", async () => {
    // État de départ : .env appliqué et empreinte mémorisée.
    setEnvCredentials('hash_env_v1', 'salt_env_v1');
    await initializeDatabase();

    // L'admin change son mot de passe via l'interface → DB seule modifiée.
    await db
      .update(schema.users)
      .set({ hash: 'hash_choisi_dans_ui', salt: 'salt_choisi_dans_ui' })
      .where(eq(schema.users.username, ADMIN));

    // Redémarrage du conteneur, .env INCHANGÉ.
    await initializeDatabase();

    // C'est ici que le bug se manifestait : la DB revenait à hash_env_v1.
    expect(readAdmin()).toMatchObject({
      hash: 'hash_choisi_dans_ui',
      salt: 'salt_choisi_dans_ui',
    });
  });

  it('applique de nouveau le .env si l’opérateur le change après coup', async () => {
    setEnvCredentials('hash_env_v1', 'salt_env_v1');
    await initializeDatabase();
    await db
      .update(schema.users)
      .set({ hash: 'hash_choisi_dans_ui', salt: 'salt_choisi_dans_ui' })
      .where(eq(schema.users.username, ADMIN));

    // setup.sh --reset-password : nouveau couple dans le .env.
    setEnvCredentials('hash_env_v2', 'salt_env_v2');
    await initializeDatabase();

    expect(readAdmin()).toMatchObject({ hash: 'hash_env_v2', salt: 'salt_env_v2' });
  });

  it('reste stable sur plusieurs redémarrages consécutifs', async () => {
    setEnvCredentials('hash_env_v2', 'salt_env_v2');
    await initializeDatabase();
    await db
      .update(schema.users)
      .set({ hash: 'hash_ui_final', salt: 'salt_ui_final' })
      .where(eq(schema.users.username, ADMIN));

    await initializeDatabase();
    await initializeDatabase();
    await initializeDatabase();

    expect(readAdmin()).toMatchObject({ hash: 'hash_ui_final', salt: 'salt_ui_final' });
  });
});

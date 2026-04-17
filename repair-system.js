const { db, sqlite, schema } = require('./api-service/db');
const { initializeDatabase } = require('./api-service/src/services/init');
const crypto = require('crypto');

async function repair() {
  console.log('🛠️ Démarrage de la réparation du système...');
  
  // 1. Initialiser les tables
  await initializeDatabase();
  console.log('✅ Structure des tables restaurée.');

  // 2. Forcer admin / admin
  const username = 'admin';
  const password = 'admin';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 600000, 64, 'sha512').toString('hex');

  await db.delete(schema.users);
  await db.insert(schema.users).values({
    username,
    hash,
    salt,
    role: 'admin'
  });

  console.log('✅ Utilisateur admin/admin injecté avec succès.');
  
  // 3. Vérification de sécurité
  const count = await db.select().from(schema.users);
  console.log(`📊 Nombre d'utilisateurs en base : ${count.length}`);
  
  process.exit(0);
}

repair().catch(err => {
  console.error('❌ Erreur lors de la réparation :', err);
  process.exit(1);
});

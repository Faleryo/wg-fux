const { db, sqlite, schema } = require('./db');
const { eq } = require('drizzle-orm');
const crypto = require('crypto');

async function resetAdmin() {
  const password = 'vibe-dns-secure-88';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  
  console.log('Resetting admin password to: vibe-dns-secure-88');
  console.log('New Salt:', salt);
  console.log('New Hash:', hash);

  await db.update(schema.users)
    .set({ hash, salt })
    .where(eq(schema.users.username, 'admin'));
    
  console.log('✅ Admin password updated in database.');
  process.exit(0);
}

resetAdmin().catch(err => {
  console.error(err);
  process.exit(1);
});

const { db, schema } = require('../db');
const { hashPassword } = require('../src/services/auth');
const { eq } = require('drizzle-orm');

async function resetAdmin() {
  const username = process.argv[2] || 'admin';
  const newPassword = process.argv[3] || 'admin';

  console.log('--- WG-FUX Administrative Recovery Tool ---');
  console.log(`📍 Targeting user: ${username}`);

  try {
    const { hash, salt } = await hashPassword(newPassword);

    await db.update(schema.users)
      .set({ 
        hash, 
        salt, 
        role: 'admin', 
        expiry: null // Ensure no expiry blocks the login
      })
      .where(eq(schema.users.username, username));

    console.log(`✅ SUCCESS: Access for ${username} has been restored.`);
    console.log(`🔑 Password set to: ${newPassword}`);
    process.exit(0);
  } catch (e) {
    console.error(`❌ FATAL ERROR: ${e.message}`);
    process.exit(1);
  }
}

resetAdmin().catch(err => {
  console.error(err);
  process.exit(1);
});

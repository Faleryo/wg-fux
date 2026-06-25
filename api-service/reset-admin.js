// Admin password reset utility.
// Usage: ADMIN_PASSWORD='your-strong-password' node reset-admin.js
require('dotenv').config();
const { db, schema } = require('./db');
const { eq } = require('drizzle-orm');
const crypto = require('crypto');

const ITERATIONS = 600000; // must match src/services/auth.js

async function resetAdmin() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error('❌ ADMIN_PASSWORD env var required.');
    process.exit(2);
  }
  if (password.length < 8) {
    console.error('❌ ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(2);
  }

  const username = process.env.ADMIN_USER || 'admin';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, 64, 'sha512').toString('hex');

  await db.update(schema.users).set({ hash, salt }).where(eq(schema.users.username, username));

  console.log(`✅ Password updated for user '${username}'.`);
  process.exit(0);
}

resetAdmin().catch((err) => {
  console.error(err);
  process.exit(1);
});

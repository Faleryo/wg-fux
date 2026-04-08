const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.resolve(__dirname, 'data/database.sqlite');
const sqlite = new Database(dbPath);

async function checkUsers() {
  try {
    const users = sqlite
      .prepare(
        'SELECT id, username, role, length(hash) as hashLen, length(salt) as saltLen, twoFactorSecret, expiry FROM users'
      )
      .all();
    console.log(JSON.stringify(users, null, 2));
  } catch (e) {
    console.error(e);
  } finally {
    sqlite.close();
  }
}

checkUsers();

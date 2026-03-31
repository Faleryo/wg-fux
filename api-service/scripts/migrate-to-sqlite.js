const fs = require('fs');
const path = require('path');
const { db, schema } = require('../db');
const { execSync } = require('child_process');

const DATA_DIR = path.join(__dirname, '../data');
const WG_CLIENTS_DIR = '/etc/wireguard/clients';

async function migrate() {
  console.log('🚀 Starting Migration JSON & Disk -> SQLite...');

  // 1. Migrate Users
  const usersPath = path.join(DATA_DIR, 'users.json');
  if (fs.existsSync(usersPath)) {
    const usersData = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
    console.log(`👤 Migrating ${usersData.length} users...`);
    for (const user of usersData) {
        try {
            await db.insert(schema.users).values({
                username: user.username,
                hash: user.hash,
                salt: user.salt,
                role: user.role,
                twoFactorSecret: user.twoFactorSecret,
                expiry: user.expiry
            }).onConflictDoNothing();
        } catch (e) {
            console.error(`Error migrating user ${user.username}:`, e.message);
        }
    }
  }

  // 2. Discover and Migrate Clients from Disk
  console.log(`📡 Scanning WireGuard clients on disk...`);
  try {
      const folders = execSync(`sudo find ${WG_CLIENTS_DIR} -maxdepth 2 -type d`).toString().split('\n').filter(Boolean);
      for (const folder of folders) {
          const parts = folder.split('/');
          if (parts.length < 6) continue; // /etc/wireguard/clients/container/client
          const container = parts[4];
          const clientName = parts[5];
          
          const pubkeyPath = path.join(folder, 'public.key');
          if (fs.existsSync(pubkeyPath) || true) { // Always try if possible
              try {
                  const publicKey = execSync(`sudo cat ${pubkeyPath}`).toString().trim();
                  const ipPath = path.join(folder, 'ip'); // or similar
                  const ip = fs.existsSync(ipPath) ? fs.readFileSync(ipPath, 'utf8').trim() : '';

                  console.log(`  [CLIENT] Migrating ${container}/${clientName} (${publicKey})`);
                  await db.insert(schema.clients).values({
                      container: container,
                      name: clientName,
                      publicKey: publicKey,
                      ip: ip
                  }).onConflictDoUpdate({
                      target: schema.clients.publicKey,
                      set: { name: clientName, container: container }
                  });
              } catch (e) {
                  // Fallback or ignore if key is missing
              }
          }
      }
  } catch (err) {
      console.warn('⚠️ Could not fully scan /etc/wireguard/clients folder. Check permissions.');
  }

  // 3. Migrate Usage (Linking by PublicKey)
  const usagePath = path.join(DATA_DIR, 'usage.json');
  if (fs.existsSync(usagePath)) {
    const usageData = JSON.parse(fs.readFileSync(usagePath, 'utf8'));
    console.log(`📊 Migrating usage data for ${Object.keys(usageData).length} clients...`);
    for (const [publicKey, data] of Object.entries(usageData)) {
        try {
            await db.insert(schema.usage).values({
                publicKey: publicKey,
                total: data.total || 0,
                daily: JSON.stringify(data.daily || {})
            }).onConflictDoUpdate({
                target: schema.usage.publicKey,
                set: { total: data.total || 0, daily: JSON.stringify(data.daily || {}) }
            });
        } catch (e) {
            console.error(`Error migrating usage for ${publicKey}:`, e.message);
        }
    }
  }

  // 4. Migrate Login History
  const loginHistoryPath = path.join(DATA_DIR, 'login_history.json');
  if (fs.existsSync(loginHistoryPath)) {
      const loginData = JSON.parse(fs.readFileSync(loginHistoryPath, 'utf8'));
      console.log(`🔑 Migrating ${loginData.length} login history entries...`);
      for (const entry of loginData) {
          try {
              await db.insert(schema.logs).values({
                  timestamp: new Date(entry.timestamp),
                  status: entry.status,
                  name: entry.username,
                  realIp: entry.ip
              });
          } catch(e) {}
      }
  }

  console.log('✅ Migration Finished.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ Migration Critical Error:', err);
  process.exit(1);
});

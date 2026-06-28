/** @type { import("drizzle-kit").Config } */
module.exports = {
  schema: './db/schema.js',
  out: './db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.DB_PATH || './data/wg-fux.db',
  },
};

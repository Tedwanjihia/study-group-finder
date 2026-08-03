const { Pool } = require('pg');
require('dotenv').config();

const config = {};

if (process.env.DATABASE_URL) {
  config.connectionString = process.env.DATABASE_URL;
  if (process.env.NODE_ENV === 'production' || process.env.DB_SSL === 'true') {
    config.ssl = { rejectUnauthorized: false };
  }
}

config.max = 5;
config.idleTimeoutMillis = 30000;
config.connectionTimeoutMillis = 10000;

const pool = new Pool(config);

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

module.exports = pool;
const { Pool } = require('pg');
require('dotenv').config();

const config = {};

if (process.env.DATABASE_URL) {
  config.connectionString = process.env.DATABASE_URL;
  // Enable SSL only in production or when explicitly requested
  if (process.env.NODE_ENV === 'production' || process.env.DB_SSL === 'true') {
    config.ssl = { rejectUnauthorized: false };
  }
}

const pool = new Pool(config);

module.exports = pool;
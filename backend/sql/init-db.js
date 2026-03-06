require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function initDB() {
  // Connect to postgres (default DB) to create costlens DB
  const adminPool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database: 'postgres',
  });

  try {
    // Create database if not exists
    const dbName = process.env.DB_NAME || 'costlens';
    const exists = await adminPool.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [dbName]);
    if (exists.rows.length === 0) {
      await adminPool.query(`CREATE DATABASE ${dbName}`);
      console.log(`Database '${dbName}' created`);
    } else {
      console.log(`Database '${dbName}' already exists`);
    }
    await adminPool.end();

    // Connect to costlens DB and run schema
    const appPool = new Pool({ connectionString: process.env.DATABASE_URL });
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await appPool.query(schema);
    console.log('Schema applied successfully');
    console.log('Tables created: users, refresh_tokens, invite_codes, analyses, credit_transactions, subscriptions, payments, usage_logs, events, nda_signatures, feedback, plans, topup_packs');
    console.log('Beta invite codes seeded: 10 codes + CLENS-ADMIN');
    await appPool.end();

    console.log('\nDatabase initialization complete!');
  } catch (err) {
    console.error('DB init error:', err);
    process.exit(1);
  }
}

initDB();

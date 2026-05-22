import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';

const file = process.argv[2];

if (!file) {
  console.error('Usage: node scripts/run-sql.js <sql-file>');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Copy .env.example to .env and update it first.');
  process.exit(1);
}

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

try {
  const sql = await fs.readFile(file, 'utf8');
  await pool.query(sql);
  console.log(`Executed ${file}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

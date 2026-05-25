import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

function loadDatabaseUrlFromEnvFile() {
  const envPath = path.resolve(process.cwd(), '.env');

  if (!fs.existsSync(envPath)) {
    console.error('.env file not found. Copy .env.example to .env and set DATABASE_URL.');
    return;
  }

  const envContent = fs.readFileSync(envPath, 'utf8');
  const lines = envContent.split(/\r?\n/);
  const line = lines.find((item) => item.trim().startsWith('DATABASE_URL='));

  if (!line) {
    console.error('DATABASE_URL was not found in .env.');
    return;
  }

  const value = line
    .replace(/^DATABASE_URL=/, '')
    .trim()
    .replace(/^['"]|['"]$/g, '');

  if (!value) {
    console.error('DATABASE_URL in .env is empty.');
    return;
  }

  process.env.DATABASE_URL = value;
}

loadDatabaseUrlFromEnvFile();

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
  const sql = await fsp.readFile(file, 'utf8');
  await pool.query(sql);
  console.log(`Executed ${file}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}

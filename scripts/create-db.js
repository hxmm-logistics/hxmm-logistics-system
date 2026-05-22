import 'dotenv/config';
import pg from 'pg';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required. Copy .env.example to .env and update it first.');
  process.exit(1);
}

const targetUrl = new URL(process.env.DATABASE_URL);
const databaseName = targetUrl.pathname.replace('/', '');
const maintenanceUrl = new URL(process.env.DATABASE_URL);
maintenanceUrl.pathname = '/postgres';

const { Client } = pg;
const client = new Client({
  connectionString: maintenanceUrl.toString(),
});

try {
  await client.connect();
  const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [databaseName]);
  if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE "${databaseName.replaceAll('"', '""')}"`);
    console.log(`Created database ${databaseName}`);
  } else {
    console.log(`Database ${databaseName} already exists`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}

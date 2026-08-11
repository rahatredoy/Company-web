/**
 * Creates `company_control_db` if it does not exist yet.
 *
 * Run once before the first migration:  npm run db:bootstrap
 * Connects to the maintenance database (`postgres`) because CREATE DATABASE
 * cannot run inside the database being created.
 */
import pg from 'pg';
import { config } from '../config/index';

function parseTarget(url: string): { adminUrl: string; databaseName: string } {
  const parsed = new URL(url);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!databaseName) throw new Error('COMPANY_DATABASE_URL must include a database name.');

  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  return { adminUrl: adminUrl.toString(), databaseName };
}

/** Quote an identifier for safe interpolation — CREATE DATABASE cannot be parameterised. */
function quoteIdentifier(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Refusing to create a database with an unsafe name: ${value}`);
  }
  return `"${value.replace(/"/g, '""')}"`;
}

async function main(): Promise<void> {
  const { adminUrl, databaseName } = parseTarget(config.database.url);
  const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 15_000 });

  await client.connect();
  try {
    const existing = await client.query('select 1 from pg_database where datname = $1', [databaseName]);
    if ((existing.rowCount ?? 0) > 0) {
      console.log(`[bootstrap] database "${databaseName}" already exists — nothing to do.`);
      return;
    }

    await client.query(`create database ${quoteIdentifier(databaseName)}`);
    console.log(`[bootstrap] created database "${databaseName}".`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('[bootstrap] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});

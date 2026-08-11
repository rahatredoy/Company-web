import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config, isProduction } from '../config/index';
import * as schema from './schema/index';

/**
 * numeric/decimal columns arrive as strings by default, which is what we want —
 * money must never round-trip through a JS float.
 */
const pool = new pg.Pool({
  connectionString: config.database.url,
  max: isProduction ? 20 : 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: 'company-api',
});

pool.on('error', (error) => {
  // A pooled client failing while idle must not take the process down.
  console.error('[db] idle client error:', error.message);
});

export const db = drizzle(pool, { schema, casing: 'snake_case' });
export { pool, schema };
export type Database = typeof db;

export async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { closeDatabase, db } from './client';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../../drizzle');

async function main(): Promise<void> {
  console.log('[migrate] applying migrations from', migrationsFolder);
  await migrate(db, { migrationsFolder });
  console.log('[migrate] done.');
}

main()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    console.error('[migrate] failed:', error instanceof Error ? error.message : error);
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });

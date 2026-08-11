import { defineConfig } from 'drizzle-kit';
import { config } from './src/config/index';
import { tenantDatabaseName } from './src/lib/utils';

/**
 * Migrations are generated against ONE reference tenant database and then
 * applied to every tenant by `src/db/tenant-migrate.ts`. There is no single
 * "app database" here — each store has its own.
 *
 * Set DRIZZLE_REFERENCE_SLUG to point `drizzle-kit generate/studio` at a
 * specific store; it defaults to the local dev store.
 */
const referenceSlug = process.env.DRIZZLE_REFERENCE_SLUG ?? config.devStoreSlug ?? 'abc-fashion';
const database = tenantDatabaseName(referenceSlug, config.tenantDb.namePrefix);

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: config.tenantDb.host,
    port: config.tenantDb.port,
    user: config.tenantDb.user,
    password: config.tenantDb.password,
    database,
    ssl: config.tenantDb.ssl,
  },
  verbose: true,
  strict: true,
});

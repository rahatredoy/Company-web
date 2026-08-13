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
 *
 * The cluster is sharded, and this config has to name a server without being
 * able to go and look for one — drizzle-kit reads it synchronously. So the shard
 * is named too: DRIZZLE_REFERENCE_SHARD, defaulting to the first shard taking
 * new stores. If the reference store lives elsewhere, set both.
 */
const referenceSlug = process.env.DRIZZLE_REFERENCE_SLUG ?? config.devStoreSlug ?? 'abc-fashion';
const database = tenantDatabaseName(referenceSlug, config.tenantDb.namePrefix);

const referenceShardId = process.env.DRIZZLE_REFERENCE_SHARD;
const shard = referenceShardId
  ? config.tenantDb.shards.find((candidate) => candidate.id === referenceShardId)
  : (config.tenantDb.shards.find((candidate) => candidate.capacity > 0) ?? config.tenantDb.legacyShard);

if (!shard) {
  throw new Error(
    `DRIZZLE_REFERENCE_SHARD="${referenceShardId}" is not in TENANT_SHARDS ` +
      `(known: ${config.tenantDb.shards.map((candidate) => candidate.id).join(', ')}).`,
  );
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: shard.host,
    port: shard.port,
    user: shard.user,
    password: shard.password,
    database,
    ssl: shard.ssl,
  },
  verbose: true,
  strict: true,
});

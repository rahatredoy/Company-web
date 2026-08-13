/**
 * Applies the commerce schema to one or more tenant databases.
 *
 *   npm run db:migrate:tenants                       every provisioned store
 *   npm run db:migrate:tenants -- --slug abc-fashion
 *   npm run db:migrate:tenants -- --slug abc-fashion --slug gadget-hub
 *   npm run db:migrate:tenants -- --dev-store        just DEV_STORE_SLUG
 *
 * Migration also happens automatically on a tenant's first request; this exists
 * to pre-warm after a deploy so no store pays the cost in-band.
 *
 * With no `--slug`, the store list comes from the control plane rather than from
 * `DEV_STORE_SLUG`. It used to be the other way round, and that was the bug this
 * script existed to prevent: run after a deploy, it pre-warmed the one dev store
 * and reported success, while every other tenant stayed on the old schema until
 * a shopper happened to trigger the in-band migration. In production, where
 * `DEV_STORE_SLUG` is forced to undefined, it warmed nothing at all.
 */
import { config } from '../config/index';
import { logger } from '../lib/logger';
import { isValidStoreSlug, tenantDatabaseName } from '../lib/utils';
import { closeRedis } from '../lib/redis';
import { fetchAllTenants, fetchTenantBySlug } from '../lib/company-client';
import { openTenantPoolForSlug } from './tenant-manager';
import { ensureTenantSchema } from './tenant-migrate';

function parseSlugs(argv: string[]): string[] {
  const slugs: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if ((argv[i] === '--slug' || argv[i] === '-s') && argv[i + 1]) {
      slugs.push(argv[i + 1]!.trim().toLowerCase());
      i += 1;
    }
  }
  return [...new Set(slugs)];
}

/**
 * What to migrate when nothing was named: every provisioned store, asked of the
 * control plane. `--dev-store` is the old behaviour, kept for the local loop
 * where warming one store is the point.
 */
async function resolveTargets(argv: string[]): Promise<string[]> {
  const named = parseSlugs(argv);
  if (named.length) return named;

  if (argv.includes('--dev-store')) {
    if (!config.devStoreSlug) {
      console.error('--dev-store needs DEV_STORE_SLUG set in .env.');
      return [];
    }
    return [config.devStoreSlug];
  }

  const tenants = await fetchAllTenants();
  // A store that is not ready has no database to migrate yet; provisioning
  // creates the schema when it makes one.
  return tenants.filter((tenant) => tenant.storeStatus === 'ready').map((tenant) => tenant.slug);
}

async function migrateOne(slug: string): Promise<boolean> {
  if (!isValidStoreSlug(slug)) {
    console.error(`  ${slug.padEnd(24)} skipped — not a valid store slug`);
    return false;
  }

  // Confirms the store exists on the control plane before touching a database.
  const tenant = await fetchTenantBySlug(slug).catch(() => null);
  if (!tenant) {
    console.error(`  ${slug.padEnd(24)} skipped — unknown to the company platform`);
    return false;
  }

  const pool = await openTenantPoolForSlug(slug);
  try {
    const result = await ensureTenantSchema(pool, tenant.tenantRef);
    const db = tenantDatabaseName(slug, config.tenantDb.namePrefix);
    console.log(
      `  ${slug.padEnd(24)} ${db.padEnd(28)} ${result.from ?? 'none'} -> ${result.to}${result.ran ? '' : '  (already current)'}`,
    );
    return true;
  } catch (error) {
    console.error(`  ${slug.padEnd(24)} FAILED — ${(error as Error).message}`);
    return false;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const slugs = await resolveTargets(process.argv.slice(2));

  if (slugs.length === 0) {
    console.error('No stores to migrate. Pass --slug <store-slug>, or check the control plane is reachable.');
    process.exit(1);
  }

  console.log(`Migrating ${slugs.length} tenant database(s):`);
  let ok = 0;
  for (const slug of slugs) {
    if (await migrateOne(slug)) ok += 1;
  }

  console.log(`\n${ok} migrated, ${slugs.length - ok} failed.`);
  if (ok < slugs.length) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    logger.fatal({ err: error instanceof Error ? error.message : String(error) }, 'tenant migration failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });

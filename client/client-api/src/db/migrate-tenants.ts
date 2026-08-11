/**
 * Applies the commerce schema to one or more tenant databases.
 *
 *   npm run db:migrate:tenants -- --slug abc-fashion
 *   npm run db:migrate:tenants -- --slug abc-fashion --slug gadget-hub
 *   npm run db:migrate:tenants                      (uses DEV_STORE_SLUG)
 *
 * Migration also happens automatically on a tenant's first request; this exists
 * to pre-warm after a deploy so no store pays the cost in-band.
 */
import { config } from '../config/index';
import { logger } from '../lib/logger';
import { isValidStoreSlug, tenantDatabaseName } from '../lib/utils';
import { closeRedis } from '../lib/redis';
import { fetchTenantBySlug } from '../lib/company-client';
import { openTenantPool } from './tenant-manager';
import { ensureTenantSchema } from './tenant-migrate';

function parseSlugs(argv: string[]): string[] {
  const slugs: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if ((argv[i] === '--slug' || argv[i] === '-s') && argv[i + 1]) {
      slugs.push(argv[i + 1]!.trim().toLowerCase());
      i += 1;
    }
  }
  if (slugs.length === 0 && config.devStoreSlug) slugs.push(config.devStoreSlug);
  return [...new Set(slugs)];
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

  const pool = openTenantPool(slug);
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
  const slugs = parseSlugs(process.argv.slice(2));

  if (slugs.length === 0) {
    console.error('No stores given. Pass --slug <store-slug>, or set DEV_STORE_SLUG in .env.');
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

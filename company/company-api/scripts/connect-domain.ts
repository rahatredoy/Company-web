/**
 * Connects a hostname to a store as a verified custom domain, without the DNS
 * check the dashboard would otherwise wait on.
 *
 *   npx tsx scripts/connect-domain.ts --slug e-comarch --storefront clientweb.igadgets.store --admin clientadmin.igadgets.store
 *   npx tsx scripts/connect-domain.ts --slug e-comarch --storefront shop.example.com --yes
 *
 * For a hostname whose DNS the operator already controls — a test deployment on
 * fixed names rather than per-store subdomains. The row is written exactly as a
 * passed verification writes it, so everything downstream (tenant lookup, the
 * surface check, CORS) treats it as an ordinary connected domain.
 *
 * Dry until `--yes`. Idempotent: a hostname already connected to this store on
 * the same surface is left alone; one connected elsewhere is refused rather
 * than moved, because moving it takes a live address away from another store.
 */
import { eq } from 'drizzle-orm';
import { closeDatabase, db } from '../src/db/client';
import { domains, tenants } from '../src/db/schema/index';
import { generateToken } from '../src/lib/crypto';
import { invalidateTenantCache } from '../src/lib/tenant-cache';
import { closeRedis } from '../src/lib/redis';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const APPLY = process.argv.includes('--yes');
type DomainType = 'storefront_custom' | 'admin_custom';

async function main(): Promise<void> {
  const slug = arg('slug');
  const wanted: Array<{ domain: string; type: DomainType }> = [];
  const storefront = arg('storefront')?.trim().toLowerCase();
  const admin = arg('admin')?.trim().toLowerCase();
  if (storefront) wanted.push({ domain: storefront, type: 'storefront_custom' });
  if (admin) wanted.push({ domain: admin, type: 'admin_custom' });

  if (!slug || wanted.length === 0) {
    console.error('\n  Usage: --slug <store> [--storefront <host>] [--admin <host>] [--yes]\n');
    process.exitCode = 1;
    return;
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  if (!tenant) {
    console.error(`\n  No tenant with slug "${slug}".\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n  ${tenant.storeName} (${tenant.slug})${APPLY ? '' : ' — dry run, pass --yes to write'}\n`);

  let changed = false;
  for (const { domain, type } of wanted) {
    const [existing] = await db.select().from(domains).where(eq(domains.domain, domain)).limit(1);

    if (existing && existing.tenantId !== tenant.id) {
      console.log(`  refuse  ${domain} is connected to another store`);
      process.exitCode = 1;
      continue;
    }
    if (existing && existing.domainType === type && existing.verified && existing.status === 'active') {
      console.log(`  keep    ${domain} (${type}) already connected`);
      continue;
    }

    console.log(`  ${existing ? 'update' : 'add   '}  ${domain} (${type})`);
    if (!APPLY) continue;

    const now = new Date();
    const values = {
      domainType: type,
      verified: true,
      status: 'active' as const,
      verifiedAt: now,
      lastCheckedAt: now,
      lastError: null,
      updatedAt: now,
    };
    if (existing) {
      await db.update(domains).set(values).where(eq(domains.id, existing.id));
    } else {
      await db.insert(domains).values({
        tenantId: tenant.id,
        domain,
        isPrimary: false,
        verificationToken: generateToken(16),
        ...values,
      });
    }
    changed = true;
  }

  // Both APIs hold the tenant record in Redis and in process; this drops both,
  // so the new hostname answers at once instead of at the end of the TTL.
  if (changed) await invalidateTenantCache(tenant.id, wanted.map((w) => w.domain));
  console.log('');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis().catch(() => undefined);
    await closeDatabase().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });

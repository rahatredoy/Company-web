/**
 * Removes the header's "Shop" entry from a store that was seeded with one.
 *
 *   npx tsx scripts/drop-shop-nav-item.ts --slug e-comarch        # dry run
 *   npx tsx scripts/drop-shop-nav-item.ts --slug e-comarch --yes  # do it
 *
 * `Shop` pointed at `/shop` and `Categories` points at the same catalogue, so
 * the header offered one destination twice — and only the categories entry
 * says anything about what is in there. `store-content-seed.ts` no longer adds
 * it; this is what clears the stores it already built, since the seed is
 * guarded on `content_seed_version` and never revisits a store.
 *
 * It removes **only** a header item whose target is `/shop`, and never the
 * `/shop` page itself: the empty cart, the order receipt and the 404 all send a
 * shopper there. An owner who has since renamed or repointed the entry keeps
 * it — a menu somebody edited is theirs, not the seed's.
 *
 * Dry by default, like `drop-duplicate-category-blocks.ts`.
 */
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { STOREFRONT_CACHE_SCOPE, invalidateTenantCache } from '../src/lib/cache';
import { fetchTenantBySlug } from '../src/lib/company-client';
import { closeRedis } from '../src/lib/redis';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const SLUG = arg('slug') ?? config.devStoreSlug;
const GO = process.argv.includes('--yes');

if (!SLUG) {
  console.error('No store. Pass --slug <store-slug>, or set DEV_STORE_SLUG in .env.');
  process.exit(1);
}

interface ItemRow {
  id: string;
  label: string;
  target_type: string;
  target_value: string | null;
  sort_order: number;
  is_active: boolean;
}

async function main(): Promise<void> {
  console.log(`\nStore: ${SLUG}${GO ? '' : '   (dry run — pass --yes to apply)'}\n`);

  const pool = await openTenantPoolForSlug(SLUG!);
  let removed = 0;

  try {
    const { rows } = await pool.query<ItemRow>(
      `select i.id, i.label, i.target_type, i.target_value, i.sort_order, i.is_active
         from navigation_items i
         join navigation_menus m on m.id = i.menu_id
        where m.location = 'header'
        order by i.sort_order`,
    );

    const doomed = rows.filter(
      (row) => row.target_type === 'url' && (row.target_value ?? '').replace(/\/$/, '') === '/shop',
    );

    console.log('Header menu as it stands:');
    for (const row of rows) {
      const mark = doomed.includes(row) ? ' ← removing' : '';
      console.log(
        `  ${String(row.sort_order).padStart(4)}  ${row.label.padEnd(12)} ${row.target_value ?? '—'}${mark}`,
      );
    }

    if (doomed.length === 0) {
      console.log('\nNothing to do — this header has no /shop entry.');
      return;
    }

    if (!GO) {
      console.log(`\n${doomed.length} entry(s) to remove. Dry run — nothing changed.`);
      return;
    }

    const { rowCount } = await pool.query(`delete from navigation_items where id = any($1::uuid[])`, [
      doomed.map((row) => row.id),
    ]);
    removed = rowCount ?? 0;
    console.log(`\nRemoved ${removed}.`);
  } finally {
    await pool.end().catch(() => undefined);
  }

  /*
   * Written straight to the table, so no `invalidateStorefrontOnWrite` hook
   * ran — and the header is part of the storefront config, which is cached.
   */
  if (removed > 0) {
    const tenant = await fetchTenantBySlug(SLUG!).catch(() => null);
    if (tenant) {
      await invalidateTenantCache(tenant.tenantRef, STOREFRONT_CACHE_SCOPE);
      console.log('Storefront cache dropped. The edge copy expires within 60 seconds.');
    } else {
      console.log('Could not reach company-api to drop the cache; it expires on its own within 5 minutes.');
    }
  }

  console.log('');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis().catch(() => undefined);
  });

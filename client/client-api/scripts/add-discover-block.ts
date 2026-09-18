/**
 * Gives a store that already exists the homepage block which shows the rest of
 * its shop.
 *
 *   npx tsx scripts/add-discover-block.ts --slug e-comarch        # dry run
 *   npx tsx scripts/add-discover-block.ts --slug e-comarch --yes  # do it
 *
 * Every other product block on a homepage asks a *question* — the newest, the
 * best selling, the best reviewed, the deepest discount — so a product that
 * answers none of them reaches the front page never, however long it has been in
 * the catalogue. A `discover` block asks nothing: it walks the whole published
 * catalogue an hour at a time (`home.routes.ts#resolveSource`), so every product
 * gets its turn in front of a visitor. New stores are seeded with one; this is
 * what gives it to the stores built before it existed.
 *
 * Idempotent and additive. It inserts one block, never edits or removes another,
 * and does nothing at all if the homepage already has a `discover` block — so
 * running it twice is running it once. Dry by default, like
 * `drop-duplicate-category-blocks.ts`, because a homepage is the one page every
 * visitor sees.
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

const TITLE = 'More to Explore';
const SUBTITLE = 'A different part of the shop every hour';
const BLOCK = { source: 'discover', limit: 12 };

/**
 * Blocks the new one belongs beside.
 *
 * It goes after the last of them rather than at the end of the page: below the
 * shop's own answers about itself, and above the trailing furniture — brands,
 * testimonials, the Instagram strip — which read as the foot of the page and
 * would bury a product grid placed under them.
 */
const PRODUCT_BLOCKS = new Set([
  'product_grid',
  'product_carousel',
  'collection',
  'deal',
  'flash_sale',
]);

interface SectionRow {
  id: string;
  type: string;
  title: string | null;
  config: Record<string, unknown> | null;
  sort_order: number;
  is_enabled: boolean;
}

async function main(): Promise<void> {
  console.log(`\nStore: ${SLUG}${GO ? '' : '   (dry run — pass --yes to apply)'}\n`);

  const pool = await openTenantPoolForSlug(SLUG!);
  let added = false;

  try {
    const { rows } = await pool.query<SectionRow>(
      `select id, type, title, config, sort_order, is_enabled
         from homepage_sections
        order by sort_order`,
    );

    console.log('Homepage as it stands:');
    for (const row of rows) {
      const source = typeof row.config?.source === 'string' ? row.config.source : null;
      const tabs = Array.isArray(row.config?.tabs) ? ` tabs=${row.config.tabs.length}` : '';
      console.log(
        `  ${String(row.sort_order).padStart(4)}  ${row.type.padEnd(18)}` +
          ` ${(row.title ?? '—').padEnd(26)}${source ? ` source=${source}` : ''}${tabs}` +
          `${row.is_enabled ? '' : '  (off)'}`,
      );
    }

    const already = rows.some((row) => row.config?.source === 'discover');
    if (already) {
      console.log('\nNothing to do — this homepage already walks the whole catalogue.');
      return;
    }

    /*
     * One past the last product block, which the seeded gaps of ten leave free.
     * If something is already sitting there it moves down until it is not: two
     * blocks sharing a sort order have no defined order between them, and the
     * homepage would shuffle those two on every read.
     */
    const anchor = rows.filter((row) => PRODUCT_BLOCKS.has(row.type)).at(-1);
    const taken = new Set(rows.map((row) => row.sort_order));
    let sortOrder = (anchor?.sort_order ?? 0) + 1;
    while (taken.has(sortOrder)) sortOrder += 1;

    console.log(
      `\nWould add: product_grid "${TITLE}" at ${sortOrder}` +
        `${anchor ? `, under "${anchor.title ?? anchor.type}"` : ''}.`,
    );

    if (!GO) {
      console.log('Dry run — nothing changed.');
      return;
    }

    await pool.query(
      `insert into homepage_sections (type, title, subtitle, config, is_enabled, sort_order)
       values ('product_grid', $1, $2, $3::jsonb, true, $4)`,
      [TITLE, SUBTITLE, JSON.stringify(BLOCK), sortOrder],
    );
    added = true;
    console.log('Added.');
  } finally {
    await pool.end().catch(() => undefined);
  }

  /*
   * Written straight to the table, so no `invalidateStorefrontOnWrite` hook ran.
   * Without this the shop keeps serving the old homepage for the length of the
   * Redis TTL — and the edge copy for its own two minutes on top, which nothing
   * here can purge.
   */
  if (added) {
    const tenant = await fetchTenantBySlug(SLUG!).catch(() => null);
    if (tenant) {
      await invalidateTenantCache(tenant.tenantRef, STOREFRONT_CACHE_SCOPE);
      console.log('Storefront cache dropped. The edge copy expires within two minutes.');
    } else {
      console.log('Could not reach company-api to drop the cache; it expires on its own within two minutes.');
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

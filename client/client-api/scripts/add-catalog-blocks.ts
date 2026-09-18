/**
 * Gives a store that already exists the two homepage blocks that show it whole:
 * every category with its subcategories, and every product.
 *
 *   npx tsx scripts/add-catalog-blocks.ts --slug e-comarch        # dry run
 *   npx tsx scripts/add-catalog-blocks.ts --slug e-comarch --yes  # do it
 *
 * A seeded homepage answers questions about the catalogue — the newest, the best
 * selling, a different twelve every hour — and lists departments in a rail. What
 * it never does is show the shop: a subcategory is reachable only by opening its
 * parent, and a product that is neither new nor popular is reachable only by
 * waiting for its turn in the rotation, or by finding `/shop`.
 *
 * Two blocks fix that, both rendered by the storefront off a single `config` key:
 *
 *   - `category_grid` + `showSubcategories` — every department with its aisles
 *     listed underneath, instead of a row of tiles that stops at the top level.
 *   - `product_grid` + `feed` — the whole catalogue, paged through the ordinary
 *     listing endpoint by a "Load more" button, so the cached homepage payload
 *     stays the size it always was however large the shop grows.
 *
 * **Both are the older shape.** A new store is seeded with neither now: the
 * category half is four `showProducts` blocks spread down the page — a department
 * each, a row of products per aisle — and the product half is gone, because "All
 * Products" was
 * the longest and least specific thing on the page and those panels answer the
 * same question aisle by aisle. Use `distribute-category-blocks.ts` for that
 * shape. This script is kept for a homepage that wants the directory or the feed
 * back, and because a store built before either existed may still be running one. Idempotent and
 * additive, like `add-discover-block.ts`: it inserts what is missing, never
 * edits or removes anything, and does nothing at all if both are already there.
 * Dry by default, because a homepage is the one page every visitor sees.
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

interface SectionRow {
  id: string;
  type: string;
  title: string | null;
  config: Record<string, unknown> | null;
  sort_order: number;
  is_enabled: boolean;
}

interface Block {
  type: string;
  title: string;
  subtitle: string;
  config: Record<string, unknown>;
}

/**
 * Where the catalogue feed belongs: after the last block that shows products,
 * and above the trailing furniture — brands, quotes, the Instagram strip —
 * which reads as the foot of the page and would bury a grid placed under it.
 */
const PRODUCT_BLOCKS = new Set(['product_grid', 'product_carousel', 'collection', 'deal', 'flash_sale']);

const CATEGORY_BLOCKS = new Set(['category_circle', 'category_grid']);

const DIRECTORY: Block = {
  type: 'category_grid',
  title: 'Browse Every Category',
  subtitle: 'Every department, and everything inside it',
  config: { showSubcategories: true },
};

const FEED: Block = {
  type: 'product_grid',
  title: 'All Products',
  subtitle: 'Everything in the shop',
  config: { feed: true, sort: 'newest' },
};

/** The next free position at or after `from`, so no two blocks share one. */
function freeSlot(taken: Set<number>, from: number): number {
  let slot = from;
  while (taken.has(slot)) slot += 1;
  taken.add(slot);
  return slot;
}

async function main(): Promise<void> {
  console.log(`\nStore: ${SLUG}${GO ? '' : '   (dry run — pass --yes to apply)'}\n`);

  const pool = await openTenantPoolForSlug(SLUG!);
  let added = 0;

  try {
    const { rows } = await pool.query<SectionRow>(
      `select id, type, title, config, sort_order, is_enabled
         from homepage_sections
        order by sort_order`,
    );

    console.log('Homepage as it stands:');
    for (const row of rows) {
      const source = typeof row.config?.source === 'string' ? ` source=${row.config.source}` : '';
      const marks =
        (row.config?.showSubcategories === true ? ' directory' : '') +
        (row.config?.feed === true ? ' feed' : '') +
        (row.is_enabled ? '' : '  (off)');

      console.log(
        `  ${String(row.sort_order).padStart(4)}  ${row.type.padEnd(18)}` +
          ` ${(row.title ?? '—').padEnd(26)}${source}${marks}`,
      );
    }

    const taken = new Set(rows.map((row) => row.sort_order));
    const planned: { block: Block; sortOrder: number; under: string }[] = [];

    if (rows.some((row) => row.config?.showSubcategories === true)) {
      console.log('\nThe subcategory directory is already on this homepage.');
    } else {
      /*
       * Directly under the category rail, which is the block it completes: the
       * rail names the departments, and this says what is inside each of them.
       * With no rail at all it goes to the top, where the rail would have been.
       */
      const anchor = rows.filter((row) => CATEGORY_BLOCKS.has(row.type)).at(-1);
      planned.push({
        block: DIRECTORY,
        sortOrder: freeSlot(taken, (anchor?.sort_order ?? 0) + 1),
        under: anchor ? `"${anchor.title ?? anchor.type}"` : 'the top of the page',
      });
    }

    if (rows.some((row) => row.config?.feed === true)) {
      console.log('The whole-catalogue feed is already on this homepage.');
    } else {
      const anchor = rows.filter((row) => PRODUCT_BLOCKS.has(row.type)).at(-1);
      planned.push({
        block: FEED,
        sortOrder: freeSlot(taken, (anchor?.sort_order ?? 0) + 1),
        under: anchor ? `"${anchor.title ?? anchor.type}"` : 'the top of the page',
      });
    }

    if (planned.length === 0) {
      console.log('\nNothing to do — this homepage already shows the whole shop.');
      return;
    }

    console.log('');
    for (const entry of planned) {
      console.log(
        `Would add: ${entry.block.type} "${entry.block.title}" at ${entry.sortOrder}, under ${entry.under}.`,
      );
    }

    if (!GO) {
      console.log('\nDry run — nothing changed.');
      return;
    }

    for (const entry of planned) {
      await pool.query(
        `insert into homepage_sections (type, title, subtitle, config, is_enabled, sort_order)
         values ($1, $2, $3, $4::jsonb, true, $5)`,
        [
          entry.block.type,
          entry.block.title,
          entry.block.subtitle,
          JSON.stringify(entry.block.config),
          entry.sortOrder,
        ],
      );
      added += 1;
    }

    console.log(`\nAdded ${added}.`);
  } finally {
    await pool.end().catch(() => undefined);
  }

  /*
   * Written straight to the table, so no `invalidateStorefrontOnWrite` hook ran.
   * Without this the shop keeps serving the old homepage for the length of the
   * Redis TTL — and the edge copy for its own two minutes on top, which nothing
   * here can purge.
   */
  if (added > 0) {
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

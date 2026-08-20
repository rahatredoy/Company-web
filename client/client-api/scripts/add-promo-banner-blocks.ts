/**
 * Puts the advertising breaks between a store's product rows.
 *
 *   npx tsx scripts/add-promo-banner-blocks.ts --slug e-comarch        # dry run
 *   npx tsx scripts/add-promo-banner-blocks.ts --slug e-comarch --yes  # do it
 *   npx tsx scripts/add-promo-banner-blocks.ts --max 3 --yes           # three of them
 *
 * A homepage that is nothing but product rows gives a shop nowhere to advertise
 * a campaign: the banners screen writes rows nothing on the front page reads
 * unless a block names their placement. New stores are seeded with two such
 * blocks (`store-content-seed.ts`); this is what gives them to the stores built
 * before that, including the demo.
 *
 * The blocks are added **empty**. Each names the `home_promo` placement rather
 * than carrying artwork, so it renders nothing at all until the owner adds a
 * banner at `/banners` — and every banner they add afterwards appears without
 * anyone coming back here. `home.routes.ts#resolveBanners` is what fills them
 * in, which is also why a campaign's start and end dates work without a sweep.
 *
 * Idempotent and additive. It inserts blocks, never edits or removes one, and
 * never puts a break where the homepage already has one — so running it twice is
 * running it once. Dry by default, like `add-discover-block.ts`, because a
 * homepage is the one page every visitor sees.
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

/**
 * How many breaks to add.
 *
 * Two, because a break earns its place by separating things and a page with one
 * between every pair of rows has separated nothing. It is a flag rather than a
 * constant only because a long homepage can carry a third.
 */
const MAX = Math.max(1, Math.min(Number(arg('max') ?? 2) || 2, 6));

if (!SLUG) {
  console.error('No store. Pass --slug <store-slug>, or set DEV_STORE_SLUG in .env.');
  process.exit(1);
}

/** One wide strip, filled from the `home_promo` placement at read time. */
const BLOCK = { bannerPosition: 'home_promo', columns: 1, ratio: 'strip' };

/** The rows a break belongs under. */
const PRODUCT_BLOCKS = new Set(['product_grid', 'product_carousel', 'collection', 'flash_sale']);

/** Blocks that are already a break, so another under them would be two in a row. */
const BANNER_BLOCKS = new Set(['banner', 'promo_trio', 'deal', 'hero']);

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
  let added = 0;

  try {
    const { rows } = await pool.query<SectionRow>(
      `select id, type, title, config, sort_order, is_enabled
         from homepage_sections
        order by sort_order`,
    );

    console.log('Homepage as it stands:');
    for (const row of rows) {
      const placement =
        typeof row.config?.bannerPosition === 'string' ? ` at=${row.config.bannerPosition}` : '';
      const source = typeof row.config?.source === 'string' ? ` source=${row.config.source}` : '';
      console.log(
        `  ${String(row.sort_order).padStart(4)}  ${row.type.padEnd(18)}` +
          ` ${(row.title ?? '—').padEnd(26)}${source}${placement}${row.is_enabled ? '' : '  (off)'}`,
      );
    }

    /*
     * Under a product row, and only where the next block is not already a break.
     * Two banner blocks in a row is the fault this is trying to avoid rather
     * than the thing it is adding: they resolve from the same placement, so the
     * second would show the same campaigns as the first.
     */
    const wanted: { after: SectionRow; sortOrder: number }[] = [];
    const taken = new Set(rows.map((row) => row.sort_order));

    for (const [index, row] of rows.entries()) {
      if (wanted.length >= MAX) break;
      if (!PRODUCT_BLOCKS.has(row.type)) continue;

      const next = rows[index + 1];
      if (next && BANNER_BLOCKS.has(next.type)) continue;

      /*
       * Directly below, or not at all.
       *
       * The seeded gaps of ten leave the slot free, and where they do not, the
       * break is skipped rather than slid down until it fits: sliding it past
       * the next block puts it under a row this loop never considered and
       * reports it as being under one it did. Two blocks cannot share a sort
       * order either — the order between them would be undefined, and the
       * homepage would shuffle that pair on every read.
       */
      const sortOrder = row.sort_order + 1;
      if (taken.has(sortOrder)) {
        console.log(`  (no room under "${row.title ?? row.type}" — ${sortOrder} is taken)`);
        continue;
      }

      taken.add(sortOrder);
      wanted.push({ after: row, sortOrder });
    }

    if (wanted.length === 0) {
      console.log('\nNothing to do — this homepage already has its breaks.');
      return;
    }

    console.log('');
    for (const entry of wanted) {
      console.log(
        `Would add: banner strip at ${entry.sortOrder}, under "${entry.after.title ?? entry.after.type}".`,
      );
    }

    if (!GO) {
      console.log('\nDry run — nothing changed.');
      return;
    }

    for (const entry of wanted) {
      await pool.query(
        `insert into homepage_sections (type, title, subtitle, config, is_enabled, sort_order)
         values ('banner', null, null, $1::jsonb, true, $2)`,
        [JSON.stringify(BLOCK), entry.sortOrder],
      );
      added += 1;
    }

    console.log(`\nAdded ${added}.`);
    console.log('They show nothing until this store has an active "Homepage promo" banner.');
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

/**
 * Moves the trust strip out of the top of the homepage and under the campaign block.
 *
 *   npx tsx scripts/move-benefits-below-deal.ts --slug e-comarch        # dry run
 *   npx tsx scripts/move-benefits-below-deal.ts --slug e-comarch --yes  # do it
 *
 * "Free Shipping / Easy Returns / Secure Payment / 24/7 Support" was the third
 * block on a seeded homepage, between the category rail and the first department
 * panel. That is the wrong question at the wrong moment: a visitor who has just
 * arrived has not chosen anything to buy, so four claims about delivery and
 * returns are read past — and they cost the page the one strip of height that
 * decides whether any product is above the fold.
 *
 * Under the deal block it closes the campaign section instead, where "free
 * shipping over $100" is a reason rather than furniture. `seed-demo-store.ts`
 * places it there now; this is what moves the stores built before it.
 *
 * Idempotent — a strip that already sits below the campaign block is left alone —
 * and dry until `--yes`, like the other homepage scripts, because this is the one
 * page every visitor sees.
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

/**
 * The block the strip belongs under, in order of preference.
 *
 * `deal` is what the seeded homepage carries — the day's offer plus its
 * promotional panels — and it is the point the page has finished making its
 * pitch. A store without one falls back to whichever campaign block it does
 * have; a store with none of them is left alone rather than guessed at.
 */
const ANCHORS = ['deal', 'promo_trio', 'flash_sale'];

/** The old home of the strip, before it became its own type. */
const isBenefits = (row: SectionRow): boolean =>
  row.type === 'benefits' || (row.type === 'text' && row.config?.variant === 'benefits');

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
  let moved = 0;

  try {
    const { rows } = await pool.query<SectionRow>(
      `select id, type, title, config, sort_order, is_enabled
         from homepage_sections
        order by sort_order`,
    );

    console.log('Homepage as it stands:');
    for (const row of rows) {
      console.log(
        `  ${String(row.sort_order).padStart(4)}  ${row.type.padEnd(18)}` +
          ` ${(row.title ?? '—').padEnd(26)}${row.is_enabled ? '' : '  (off)'}`,
      );
    }

    const strip = rows.find(isBenefits);
    if (!strip) {
      console.log('\nNothing to do — this homepage has no trust strip.');
      return;
    }

    const anchor = ANCHORS.map((type) => rows.find((row) => row.type === type)).find(Boolean);
    if (!anchor) {
      console.log(`\nNothing to do — no ${ANCHORS.join('/')} block to put the strip under.`);
      return;
    }

    if (strip.sort_order > anchor.sort_order) {
      console.log(`\nNothing to do — the strip already sits below the ${anchor.type} block.`);
      return;
    }

    /*
     * Directly below the anchor, in the gap the seeded orders leave.
     *
     * Two rows cannot share a sort order — the order between them would be
     * undefined and the homepage would shuffle that pair on every read — so if
     * the slot is taken the strip goes half a step further down instead. The
     * next block after the anchor is what bounds that: landing past it would put
     * the strip under something this run never named.
     */
    const next = rows.find((row) => row.sort_order > anchor.sort_order && row.id !== strip.id);
    const gap = next ? next.sort_order - anchor.sort_order : 10;
    if (gap <= 1) {
      console.log(`\nNo room under the ${anchor.type} block (${anchor.sort_order} → ${next!.sort_order}).`);
      console.log('Reorder the homepage from the panel, or run distribute-category-blocks.ts first.');
      return;
    }

    const target = anchor.sort_order + Math.floor(gap / 2);

    console.log(
      `\nWould move: trust strip from ${strip.sort_order} to ${target}, under "${anchor.title ?? anchor.type}".`,
    );

    if (!GO) {
      console.log('\nDry run — nothing changed.');
      return;
    }

    await pool.query(`update homepage_sections set sort_order = $1, updated_at = now() where id = $2`, [
      target,
      strip.id,
    ]);
    moved = 1;
    console.log('\nMoved.');
  } finally {
    await pool.end().catch(() => undefined);
  }

  /*
   * Written straight to the table, so no `invalidateStorefrontOnWrite` hook ran.
   * Without this the shop keeps serving the old homepage for the length of the
   * Redis TTL — and the edge copy for its own two minutes on top, which nothing
   * here can purge.
   */
  if (moved > 0) {
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

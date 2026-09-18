/**
 * Spreads the category-and-products blocks through a store's homepage, one
 * department each, and removes the whole-catalogue block they replace.
 *
 *   npx tsx scripts/distribute-category-blocks.ts --slug e-comarch         # dry run
 *   npx tsx scripts/distribute-category-blocks.ts --slug e-comarch --yes   # do it
 *   npx tsx scripts/distribute-category-blocks.ts --max 4 --yes            # four departments
 *   npx tsx scripts/distribute-category-blocks.ts --keep-feed --yes        # leave "All Products"
 *
 * One block drawing six departments put the whole shop in one place: six panels
 * stacked between two banners, which reads as a catalogue dump rather than a
 * homepage and buries everything under it. Spread instead — a department, then a
 * promo, then a rail of recommendations, then the next department — every product
 * on the page arrives beside something unlike it, which is the arrangement a
 * large shop uses.
 *
 * Each block it writes is `category_grid` carrying `{ showProducts: true, limit:
 * 1, offset: n }`. The **offset** is what keeps two of them from drawing the same
 * department, and it is an offset rather than a category id on purpose: these
 * blocks are seeded into a store on the day it has no categories at all, so an
 * id would have to be filled in by hand later while an offset fills itself in as
 * the owner builds the shop.
 *
 * It also removes the `product_grid` + `feed` block — "All Products", the whole
 * catalogue behind a Load more button. With a department every few sections the
 * shop is walkable without it, and it was the longest thing on the page.
 * `--keep-feed` leaves it where it is.
 *
 * **Every block's `sort_order` is rewritten** as 10, 20, 30 … in the order the
 * page ends up in — the only way to insert between two blocks whose orders are
 * already adjacent. Nothing else about the other blocks is touched, and running
 * it twice is running it once: the departments it would add are already there, so
 * the second run only re-numbers what is already in that order.
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
const KEEP_FEED = process.argv.includes('--keep-feed');
const MAX = Math.min(Math.max(Number(arg('max') ?? 6) || 6, 1), 12);

if (!SLUG) {
  console.error('No store. Pass --slug <store-slug>, or set DEV_STORE_SLUG in .env.');
  process.exit(1);
}

/**
 * The foot of the page, and the hero at the top of it.
 *
 * A department block dropped after the Instagram strip is
 * below the point where a visitor has stopped reading, so those are not offered
 * as places to insert one. The hero stays first for the same reason in reverse.
 */
const NOT_AN_ANCHOR = new Set(['hero', 'social_gallery', 'recently_viewed']);

interface SectionRow {
  id: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  config: Record<string, unknown> | null;
  sort_order: number;
  is_enabled: boolean;
}

interface Placed {
  /** An existing row, or `null` for a block this script is inserting. */
  row: SectionRow | null;
  label: string;
  offset?: number;
}

const isShowcase = (row: SectionRow) => row.config?.showProducts === true;
const isFeed = (row: SectionRow) => row.config?.feed === true;

/**
 * Headings the seed wrote, which a spread block no longer wants.
 *
 * One block drawing every department needed a heading above it; a block drawing
 * *one* has the department's own name, picture and link in its panel header, and
 * a section heading above that is the same fact twice — and only above the first
 * panel, since the others were never given one. Anything an owner typed
 * themselves is theirs and is left exactly where it is.
 */
const SEEDED_HEADINGS = new Set([
  'Browse Every Category',
  'Every department, aisle by aisle',
  'Every department, and everything inside it',
  'Shop by Category',
]);

const seededOnly = (text: string | null) => text === null || SEEDED_HEADINGS.has(text);

async function main(): Promise<void> {
  console.log(`\nStore: ${SLUG}${GO ? '' : '   (dry run — pass --yes to apply)'}\n`);

  const pool = await openTenantPoolForSlug(SLUG!);
  let wrote = false;

  try {
    const { rows } = await pool.query<SectionRow>(
      `select id, type, title, subtitle, config, sort_order, is_enabled
         from homepage_sections
        order by sort_order`,
    );

    /*
     * How many departments there are to feature, counted the way the storefront
     * counts them: a top-level category with at least one published product
     * somewhere beneath it. A block pointed at an empty department renders
     * nothing at all, so writing more of them than this would leave invisible
     * blocks in the record for somebody to wonder about later.
     */
    const { rows: departments } = await pool.query<{ id: string; name: string; total: string }>(
      `select c.id, c.name,
              (select count(*) from products p
                where p.status = 'active'
                  and (p.category_id = c.id
                       or p.category_id in (select id from categories where parent_id = c.id)
                       or p.category_id in (
                            select id from categories
                             where parent_id in (select id from categories where parent_id = c.id))))
              as total
         from categories c
        where c.parent_id is null and c.is_active
        order by c.sort_order, c.name`,
    );

    const stocked = departments.filter((department) => Number(department.total) > 0);
    const wanted = Math.min(MAX, stocked.length);

    console.log(`Departments with products: ${stocked.length} — featuring ${wanted}.`);
    if (stocked.length > wanted) {
      console.log(
        `  (not featured: ${stocked.slice(wanted).map((d) => d.name).join(', ')} —` +
          ` reachable from the category rail and /categories)`,
      );
    }

    console.log('\nHomepage as it stands:');
    for (const row of rows) {
      const mark = isShowcase(row)
        ? '  ← a department block'
        : isFeed(row)
          ? '  ← the whole catalogue'
          : '';
      console.log(
        `  ${String(row.sort_order).padStart(4)}  ${row.type.padEnd(18)}` +
          ` ${(row.title ?? '—').padEnd(24)}${mark}${row.is_enabled ? '' : '  (off)'}`,
      );
    }

    if (wanted === 0) {
      console.log('\nNothing to do — this store has no department with products in it yet.');
      return;
    }

    const existing = rows.filter(isShowcase);
    const dropped = KEEP_FEED ? [] : rows.filter(isFeed);
    const others = rows.filter((row) => !isShowcase(row) && !dropped.includes(row));

    /*
     * The existing department blocks are re-used rather than deleted and
     * re-created: an owner may have edited a heading on one, and a delete would
     * take that with it. Whichever are left over are removed; whichever are
     * missing are inserted.
     */
    const anchors = others.filter((row) => !NOT_AN_ANCHOR.has(row.type));

    /*
     * Evenly spaced, and deliberately not on a fixed list of block types: the
     * homepage this runs against is whatever the owner has built. `+ 0.7` biases
     * the first one early — a shopper should meet a department before the page
     * has spent its attention on three promos.
     */
    const positions = Array.from({ length: wanted }, (_, index) =>
      Math.min(Math.round((index + 0.7) * (anchors.length / wanted)), Math.max(anchors.length - 1, 0)),
    );

    const page: Placed[] = [];
    let placed = 0;
    let anchorIndex = 0;

    for (const row of others) {
      page.push({ row, label: `${row.type} ${row.title ?? ''}`.trim() });

      const isAnchor = !NOT_AN_ANCHOR.has(row.type);
      if (!isAnchor) continue;

      // Every position that lands on this anchor, so two department blocks never
      // collapse onto one another when a homepage has fewer blocks than
      // departments.
      while (placed < wanted && positions[placed] === anchorIndex) {
        const reused = existing[placed] ?? null;
        page.push({
          row: reused,
          label: `${stocked[placed]!.name} (offset ${placed})`,
          offset: placed,
        });
        placed += 1;
      }

      anchorIndex += 1;
    }

    // A homepage with no anchors at all still gets its departments, at the end.
    while (placed < wanted) {
      page.push({
        row: existing[placed] ?? null,
        label: `${stocked[placed]!.name} (offset ${placed})`,
        offset: placed,
      });
      placed += 1;
    }

    const surplus = existing.slice(wanted);

    console.log('\nHomepage as it would be:');
    page.forEach((entry, index) => {
      const order = (index + 1) * 10;
      const kind =
        entry.offset === undefined
          ? ''
          : entry.row
            ? seededOnly(entry.row.title) && seededOnly(entry.row.subtitle)
              ? '  (kept, re-pointed, seeded heading dropped)'
              : '  (kept, re-pointed)'
            : '  (new)';
      console.log(`  ${String(order).padStart(4)}  ${entry.label}${kind}`);
    });
    for (const row of dropped) console.log(`  removed: ${row.type} "${row.title ?? '—'}"`);
    for (const row of surplus) console.log(`  removed: surplus department block "${row.title ?? '—'}"`);

    if (!GO) {
      console.log('\nDry run — nothing changed.');
      return;
    }

    for (const row of [...dropped, ...surplus]) {
      await pool.query(`delete from homepage_sections where id = $1`, [row.id]);
    }

    for (const [index, entry] of page.entries()) {
      const order = (index + 1) * 10;

      if (entry.offset === undefined) {
        await pool.query(`update homepage_sections set sort_order = $1, updated_at = now() where id = $2`, [
          order,
          entry.row!.id,
        ]);
        continue;
      }

      /*
       * `limit: 1` and an offset, and the other keys left to the storefront's
       * defaults — a number written here is a number that can drift from the one
       * the renderer would have used.
       */
      const blockConfig = { ...(entry.row?.config ?? {}), showProducts: true, limit: 1, offset: entry.offset };
      delete blockConfig.showSubcategories;

      if (entry.row) {
        // The heading goes only if the seed wrote it — see `SEEDED_HEADINGS`.
        const clear = seededOnly(entry.row.title) && seededOnly(entry.row.subtitle);

        await pool.query(
          `update homepage_sections
              set config = $1::jsonb, sort_order = $2,
                  title = $3, subtitle = $4, updated_at = now()
            where id = $5`,
          [
            JSON.stringify(blockConfig),
            order,
            clear ? null : entry.row.title,
            clear ? null : entry.row.subtitle,
            entry.row.id,
          ],
        );
      } else {
        await pool.query(
          `insert into homepage_sections (type, title, subtitle, config, is_enabled, sort_order)
           values ('category_grid', null, null, $1::jsonb, true, $2)`,
          [JSON.stringify(blockConfig), order],
        );
      }
    }

    wrote = true;
    console.log(`\nDone — ${wanted} department blocks, ${dropped.length + surplus.length} removed.`);
  } finally {
    await pool.end().catch(() => undefined);
  }

  /*
   * Written straight to the table, so no `invalidateStorefrontOnWrite` hook ran.
   * Without this the shop keeps serving the old homepage for the length of the
   * Redis TTL — and the edge copy for its own two minutes on top, which nothing
   * here can purge.
   */
  if (wrote) {
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

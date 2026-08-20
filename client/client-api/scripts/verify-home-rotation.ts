/**
 * Proves the homepage works through the catalogue rather than sampling it.
 *
 *   npx tsx scripts/verify-home-rotation.ts [--slug e-comarch]
 *
 * The claim being checked is the whole point of the rotation: **a full lap shows
 * every published product, exactly once each.** Nothing outside the API can
 * check that — a lap is the better part of a day and a caller cannot move the
 * clock — so this imports `resolveSource` and `resolveShowcase` and steps the
 * rotation itself, which is why those two and `rotationIndex` are exported.
 *
 * Both rotations are covered, because they are the same claim made twice: the
 * homepage's product blocks walk the catalogue, and the category showcase walks
 * a department's aisles and each aisle's own products.
 *
 * Read-only. It resolves ids and counts rows; it writes nothing and invalidates
 * nothing, so it is safe to run against the live store. The one cache it touches
 * is the category tree, which `resolveShowcase` reads the same way the API does —
 * under a reference of this script's own, so it neither reads nor disturbs the
 * entry a live store is being served from.
 */
import { and, eq, gte, inArray, sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../src/config/index';
import * as schema from '../src/db/schema/index';
import { openTenantPoolForSlug, type TenantDb } from '../src/db/tenant-manager';
import { closeRedis } from '../src/lib/redis';
import {
  ROTATION_POOL,
  resolveSource,
  withResolvedProducts,
} from '../src/modules/storefront/home.routes';
import { MAX_AISLES, resolveShowcase } from '../src/modules/storefront/taxonomy.routes';
import {
  descendantIds,
  loadCategoryTree,
  PUBLISHED_PRODUCT,
  ROTATION_SECONDS,
  rotationIndex,
} from '../src/modules/storefront/service';

type Source = Parameters<typeof resolveSource>[1];

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const SLUG = arg('slug') ?? config.devStoreSlug ?? 'e-comarch';

/** The width of a block, and of one step of the window. */
const LIMIT = 12;

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

function skip(name: string, why: string): void {
  console.log(`  SKIP  ${name} — ${why}`);
}

/**
 * Every window of one lap.
 *
 * `ceil(eligible / limit)` windows is a lap by definition: the offsets are
 * 0, limit, 2·limit … and the last one is the only that runs off the end of the
 * set and wraps, so between them they cover it once.
 */
async function lap(db: TenantDb, source: Source, eligible: number): Promise<string[][]> {
  const windows: string[][] = [];
  for (let turn = 0; turn < Math.ceil(eligible / LIMIT); turn += 1) {
    windows.push(await resolveSource(db, source, LIMIT, turn));
  }
  return windows;
}

async function countPublished(db: TenantDb, extra?: SQL): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(schema.products)
    .where(extra ? and(PUBLISHED_PRODUCT, extra) : PUBLISHED_PRODUCT);

  return row?.total ?? 0;
}

/** How far into the window a store's rotation turns over. */
function flipSecond(tenantRef: string, base: number): number {
  const start = rotationIndex(tenantRef, base);
  for (let second = 1; second <= ROTATION_SECONDS; second += 1) {
    if (rotationIndex(tenantRef, base + second * 1000) !== start) return second;
  }
  return -1;
}

async function main(): Promise<void> {
  const pool = await openTenantPoolForSlug(SLUG);
  const db: TenantDb = drizzle(pool, { schema, casing: 'snake_case' });

  try {
    console.log(`\nStore: ${SLUG}\n`);

    // ------------------------------------------------------------- clock ----
    console.log('The rotation clock');

    const ref = 'tnt_example';
    const base = 1_700_000_000_000;

    check('holds still inside its window', rotationIndex(ref, base) === rotationIndex(ref, base + 1000));
    check(
      'advances exactly once per window',
      rotationIndex(ref, base + ROTATION_SECONDS * 1000) === rotationIndex(ref, base) + 1,
    );
    check('is the same answer twice for one store', rotationIndex(ref, base) === rotationIndex(ref, base));

    const flips = ['tnt_one', 'tnt_two', 'tnt_three'].map((each) => flipSecond(each, base));
    check(
      'is phased per store, so the platform does not turn over on one stroke',
      new Set(flips).size > 1,
      { flips },
    );

    // ---------------------------------------------------------- discover ----
    console.log('\n`discover` — the whole catalogue, in turn');

    const published = await countPublished(db);
    console.log(`  (${published} published products, ${LIMIT} to a window)`);

    if (published <= LIMIT) {
      skip('a lap covers every published product', `only ${published} of them — one window shows the shop`);
    } else {
      const windows = await lap(db, 'discover', published);
      const seen = windows.flat();

      check('every window is full', windows.every((ids) => ids.length === LIMIT), {
        short: windows.filter((ids) => ids.length !== LIMIT).map((ids) => ids.length),
      });
      check(
        'no window shows the same product twice',
        windows.every((ids) => new Set(ids).size === ids.length),
      );
      check('a lap covers every published product', new Set(seen).size === published, {
        covered: new Set(seen).size,
        published,
      });
      /*
       * The last window of a lap is the short one, and is filled from the top of
       * the catalogue rather than left ragged — so the repeats a lap contains
       * are exactly that filling, and never a product shown twice while another
       * waits for its turn.
       */
      check(
        'the only repeats are the wrap completing its last window',
        seen.length - new Set(seen).size === seen.length - published,
        { repeats: seen.length - new Set(seen).size, expected: seen.length - published },
      );
      check(
        'the window moves between one hour and the next',
        windows[0]!.join() !== windows[1]!.join(),
      );
      check(
        'the same hour resolves to the same window',
        (await resolveSource(db, 'discover', LIMIT, 0)).join() === windows[0]!.join(),
      );
    }

    // ------------------------------------------------------------ claims ----
    console.log('\nWhat each source is allowed to claim');

    check('`new_arrivals` is pooled at zero', ROTATION_POOL.new_arrivals === 0);
    check(
      '`new_arrivals` does not rotate — it means the latest, not the thirteenth latest',
      (await resolveSource(db, 'new_arrivals', LIMIT, 0)).join() ===
        (await resolveSource(db, 'new_arrivals', LIMIT, 7)).join(),
    );

    /*
     * The deal block is the one that must not move: its heading is a
     * superlative about a single product, and the second-deepest discount under
     * it is not a fresher deal but a wrong one. Resolved through the section
     * rather than the source, because the thing that could regress is the
     * `PINNED` at that one call site.
     */
    const dealAt = async (rotation: number): Promise<unknown> =>
      (
        await withResolvedProducts(
          db,
          { id: 'deal', type: 'deal', title: 'Deal of the Day', subtitle: null, config: { source: 'sale' } },
          rotation,
        )
      ).config.productId;

    const deal = await dealAt(0);
    check('the deal of the day does not rotate', deal === (await dealAt(9)));
    check(
      'the deal of the day is the deepest discount in the shop',
      deal === (await resolveSource(db, 'sale', 1, null))[0],
      { deal },
    );

    const bestPool = Math.min(published, ROTATION_POOL.best_selling);
    const bestSeen = new Set((await lap(db, 'best_selling', bestPool)).flat());
    check('`best_selling` rotates no further than its pool', bestSeen.size <= ROTATION_POOL.best_selling, {
      reached: bestSeen.size,
      pool: ROTATION_POOL.best_selling,
    });
    check(
      '`best_selling` still opens on the top seller',
      (await resolveSource(db, 'best_selling', LIMIT, 0))[0] ===
        (await resolveSource(db, 'best_selling', 1, null))[0],
    );

    const featured = await countPublished(db, eq(schema.products.isFeatured, true));
    if (featured === 0) {
      skip('`featured` covers every featured product', 'this store features none');
    } else {
      const covered = new Set((await lap(db, 'featured', featured)).flat());
      check('`featured` covers every featured product', covered.size === featured, {
        covered: covered.size,
        eligible: featured,
      });
    }

    const reviewed = await countPublished(db, gte(schema.products.ratingCount, 5));
    if (reviewed === 0) {
      skip('`recommended` covers every well-reviewed product', 'nothing here has enough reviews');
    } else {
      const covered = new Set((await lap(db, 'recommended', reviewed)).flat());
      check('`recommended` covers every well-reviewed product', covered.size === reviewed, {
        covered: covered.size,
        eligible: reviewed,
      });
    }

    // --------------------------------------------------------- showcase ----
    console.log('\nThe category showcase — every aisle, and every product in one');

    /*
     * A tenant reference of this script's own. `resolveShowcase` reads the
     * category tree through the same five-minute cache the API does, and a
     * verification must not be answered from an entry it did not fetch — nor
     * leave its own behind under the key a live store is served from.
     */
    const showcaseStore = { tenantRef: `verify-rotation-${SLUG}`, db };

    /** The shape a seeded homepage asks for — see `SHOWCASE_DEFAULTS`. */
    const ROWS = 3;
    const PER_ROW = 8;
    const showcaseQuery = { ids: undefined, offset: 0, categories: 1, rows: ROWS, perRow: PER_ROW };

    const tree = await loadCategoryTree(showcaseStore);
    const department = tree.find((node) => node.parentId === null);

    /*
     * The candidates the resolver itself would consider, and how much is
     * actually filed under each — the truth this checks the panel against.
     */
    const candidates = department
      ? tree.filter((node) => node.parentId === department.id).slice(0, MAX_AISLES)
      : [];

    const stocked: { id: string; name: string; held: number }[] = [];
    for (const aisle of candidates) {
      const held = await countPublished(
        db,
        inArray(schema.products.categoryId, descendantIds(tree, aisle.id)),
      );
      if (held > 0) stocked.push({ id: aisle.id, name: aisle.name, held });
    }

    if (!department) {
      skip('a lap previews every stocked aisle', 'this store has no categories');
    } else if (stocked.length <= ROWS) {
      skip(
        'a lap previews every stocked aisle',
        `${department.name} has ${stocked.length} stocked aisle(s) — one panel already shows them all`,
      );
    } else {
      console.log(`  (${department.name}: ${stocked.length} stocked aisles, ${ROWS} to a panel)`);

      const turns = Math.ceil(stocked.length / ROWS);
      const drawn = new Set<string>();
      const panels: string[] = [];

      for (let turn = 0; turn < turns; turn += 1) {
        const rows = (await resolveShowcase(showcaseStore, showcaseQuery, turn))[0]?.rows ?? [];
        panels.push(rows.map((row) => row.categoryId).join());
        for (const row of rows) drawn.add(row.categoryId);
      }

      check(
        'a lap previews every stocked aisle',
        stocked.every((aisle) => drawn.has(aisle.id)),
        { drawn: drawn.size, stocked: stocked.length },
      );
      check(
        'no panel draws the same aisle twice',
        panels.every((panel) => new Set(panel.split(',')).size === panel.split(',').length),
      );
      check('the aisles change between one hour and the next', panels[0] !== panels[1], { panels });
      check(
        'the same hour draws the same aisles',
        ((await resolveShowcase(showcaseStore, showcaseQuery, 0))[0]?.rows ?? [])
          .map((row) => row.categoryId)
          .join() === panels[0],
      );
    }

    /*
     * The second half of the claim, and the one the aisle rotation cannot make
     * on its own: an aisle that comes round every few hours has to be showing
     * *different* products when it does. The two clocks would resonate if the
     * products turned by the hour — see where the buckets are built — so this
     * walks long enough for the slower one to come all the way round.
     */
    const deepest = [...stocked].sort((a, b) => b.held - a.held)[0];
    const productLap = Math.max(1, Math.ceil(candidates.length / ROWS));
    const needed = deepest ? productLap * Math.ceil(deepest.held / PER_ROW) : 0;

    if (!deepest || deepest.held <= PER_ROW) {
      skip(
        'a lap shows every product in an aisle',
        deepest
          ? `the deepest aisle here holds ${deepest.held}, which one row shows`
          : 'no aisle here has anything in it',
      );
    } else if (needed > 96) {
      // Never silently: a bounded walk that reported a pass would be claiming
      // coverage it had not looked for.
      skip('a lap shows every product in an aisle', `it would take ${needed} turns to prove here`);
    } else {
      const seen = new Set<string>();
      for (let turn = 0; turn < needed; turn += 1) {
        const rows = (await resolveShowcase(showcaseStore, showcaseQuery, turn))[0]?.rows ?? [];
        for (const id of rows.find((row) => row.categoryId === deepest.id)?.productIds ?? []) {
          seen.add(id);
        }
      }

      check(`a lap shows every product in ${deepest.name}`, seen.size === deepest.held, {
        seen: seen.size,
        held: deepest.held,
        turns: needed,
      });
    }
  } finally {
    await pool.end().catch(() => undefined);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis().catch(() => undefined);
  });

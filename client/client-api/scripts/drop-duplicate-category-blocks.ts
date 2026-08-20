/**
 * Removes the homepage category blocks that are the top rail drawn again.
 *
 *   npx tsx scripts/drop-duplicate-category-blocks.ts --slug e-comarch        # dry run
 *   npx tsx scripts/drop-duplicate-category-blocks.ts --slug e-comarch --yes  # do it
 *
 * A `category_circle` block near the top of the page answers "which departments
 * does this shop have". On these templates `category_grid` renders as the same
 * circular rail, so a second one further down the page is that answer given
 * twice — which a visitor reads as having accidentally scrolled back up. The
 * demo seed shipped two of them; the seed no longer does, and this is what
 * clears the stores it already built.
 *
 * **It only ever removes a grid when a circle block survives it.** A shop whose
 * only category block is a `category_grid` keeps it — removing that would leave
 * the homepage with no way into the catalogue at all, which is a different and
 * much worse problem than showing one twice.
 *
 * Dry by default, like `delete-tenant.ts`: it prints the whole homepage and what
 * it would remove, and changes nothing without `--yes`. Blocks are deleted
 * rather than disabled because the homepage builder re-adds one in a few
 * seconds, and a disabled row is a thing the owner has to keep scrolling past.
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

/**
 * The one `category_grid` that is not the rail again.
 *
 * A grid carrying `showProducts` draws each department as a panel of its aisles,
 * every aisle a rail of its own products; one carrying `showSubcategories`
 * prints the same aisles as a tree of links. Either is a different answer from
 * "which departments are there", not a second copy of it — and new stores are
 * seeded with the first below the rail, so a script that removed every grid
 * would delete a block the seed had just placed.
 */
function isDirectory(row: SectionRow): boolean {
  return row.config?.showSubcategories === true || row.config?.showProducts === true;
}

async function main(): Promise<void> {
  console.log(`\nStore: ${SLUG}${GO ? '' : '   (dry run — pass --yes to apply)'}\n`);

  const pool = await openTenantPoolForSlug(SLUG!);
  let removed = 0;

  try {
    const { rows } = await pool.query<SectionRow>(
      `select id, type, title, config, sort_order, is_enabled
         from homepage_sections
        order by sort_order`,
    );

    const circles = rows.filter((row) => row.type === 'category_circle');
    const grids = rows.filter((row) => row.type === 'category_grid' && !isDirectory(row));

    console.log('Homepage as it stands:');
    for (const row of rows) {
      const category = row.type === 'category_circle' || row.type === 'category_grid';
      const mark = !category
        ? ''
        : row.type === 'category_circle'
          ? ' ← the rail'
          : isDirectory(row)
            ? ' ← the shop by department, kept'
            : ' ← duplicate';
      console.log(
        `  ${String(row.sort_order).padStart(4)}  ${row.type.padEnd(18)} ${row.title ?? '—'}${mark}`,
      );
    }

    if (grids.length === 0) {
      console.log('\nNothing to do — this homepage has no category grid.');
      return;
    }

    if (circles.length === 0) {
      console.log(
        `\n${grids.length} category grid(s), but no circular rail above them.\n` +
          'Leaving them alone: they are the only way into the catalogue from this homepage.',
      );
      return;
    }

    console.log(`\n${grids.length} grid(s) to remove; the rail at ${circles[0]!.sort_order} stays.`);
    if (!GO) {
      console.log('Dry run — nothing changed.');
      return;
    }

    const { rowCount } = await pool.query(`delete from homepage_sections where id = any($1::uuid[])`, [
      grids.map((row) => row.id),
    ]);
    removed = rowCount ?? 0;
    console.log(`Removed ${removed}.`);
  } finally {
    await pool.end().catch(() => undefined);
  }

  /*
   * Written straight to the table, so no `invalidateStorefrontOnWrite` hook ran.
   * Without this the shop keeps serving the old homepage for the length of the
   * Redis TTL — and the edge copy for its own 60 seconds on top, which nothing
   * here can purge.
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

/*
 * Closed here rather than at the end of `main`, because the dry run and the
 * two nothing-to-do paths all return early — and an open Redis handle keeps the
 * process alive after it has finished printing, which reads as a hang.
 */
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis().catch(() => undefined);
  });

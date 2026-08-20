/**
 * Turns a store's category directory block into the one that shows products.
 *
 *   npx tsx scripts/show-products-under-categories.ts --slug e-comarch        # dry run
 *   npx tsx scripts/show-products-under-categories.ts --slug e-comarch --yes  # do it
 *
 * The directory printed every department with its aisles written underneath,
 * which tells a visitor how the shop is filed and nothing about what is in it.
 * The block draws each department as a panel of its aisles now, every aisle a
 * rail of its own products — `config.showProducts` instead of
 * `config.showSubcategories`. New stores are seeded that way; this is what
 * changes the stores built before it.
 *
 * It rewrites the two keys and nothing else, so a hand-edited `categoryIds`,
 * `limit`, `rows` or `perRow` survives. The subtitle moves only if it is still
 * the seeded sentence, because a subtitle somebody wrote themselves is theirs.
 *
 * Idempotent: a block already showing products is left alone, so running this
 * twice is running it once. Dry by default, because a homepage is the one page
 * every visitor sees. Reversible — flip the keys back with the panel's
 * "How it lists" control, or with `drop-duplicate-category-blocks.ts` for the
 * rail that shares its screen.
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

/** The sentence the seed wrote. Anything else was written by the owner. */
const SEEDED_SUBTITLE = 'Every department, and everything inside it';
const NEW_SUBTITLE = 'Every department, aisle by aisle';

interface SectionRow {
  id: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  config: Record<string, unknown> | null;
  sort_order: number;
  is_enabled: boolean;
}

async function main(): Promise<void> {
  console.log(`\nStore: ${SLUG}${GO ? '' : '   (dry run — pass --yes to apply)'}\n`);

  const pool = await openTenantPoolForSlug(SLUG!);
  let changed = 0;

  try {
    const { rows } = await pool.query<SectionRow>(
      `select id, type, title, subtitle, config, sort_order, is_enabled
         from homepage_sections
        where type in ('category_grid', 'category_circle')
        order by sort_order`,
    );

    console.log('Category blocks as they stand:');
    for (const row of rows) {
      const mode = row.config?.showProducts === true
        ? 'products'
        : row.config?.showSubcategories === true
          ? 'directory'
          : 'tiles';
      console.log(
        `  ${String(row.sort_order).padStart(4)}  ${row.type.padEnd(16)}` +
          ` ${(row.title ?? '—').padEnd(26)} ${mode}${row.is_enabled ? '' : '  (off)'}`,
      );
    }

    const targets = rows.filter((row) => row.config?.showSubcategories === true);

    if (targets.length === 0) {
      const already = rows.some((row) => row.config?.showProducts === true);
      console.log(
        already
          ? '\nNothing to do — this homepage already shows products under each category.'
          : '\nNothing to do — no directory block here. Add one from the panel, then run this.',
      );
      return;
    }

    for (const row of targets) {
      const next = { ...(row.config ?? {}) };
      delete next.showSubcategories;
      next.showProducts = true;

      const subtitle = row.subtitle === SEEDED_SUBTITLE ? NEW_SUBTITLE : row.subtitle;

      console.log(
        `\nWould change: ${row.type} "${row.title ?? '—'}" at ${row.sort_order}` +
          ` → products under each subcategory` +
          `${subtitle === row.subtitle ? '' : `, subtitle → "${subtitle}"`}`,
      );

      if (!GO) continue;

      await pool.query(
        `update homepage_sections set config = $1::jsonb, subtitle = $2, updated_at = now() where id = $3`,
        [JSON.stringify(next), subtitle, row.id],
      );
      changed += 1;
    }

    console.log(GO ? `\nChanged ${changed}.` : '\nDry run — nothing changed.');
  } finally {
    await pool.end().catch(() => undefined);
  }

  /*
   * Written straight to the table, so no `invalidateStorefrontOnWrite` hook ran.
   * Without this the shop keeps serving the old homepage for the length of the
   * Redis TTL — and the edge copy for its own two minutes on top, which nothing
   * here can purge.
   */
  if (changed > 0) {
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

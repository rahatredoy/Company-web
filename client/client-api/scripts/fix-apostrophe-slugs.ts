/**
 * Repairs the category, brand and product slugs that an apostrophe broke.
 *
 *   npx tsx scripts/fix-apostrophe-slugs.ts --slug e-comarch        # dry run
 *   npx tsx scripts/fix-apostrophe-slugs.ts --slug e-comarch --yes  # do it
 *
 * `slugify` used to treat every non-alphanumeric character as a word boundary,
 * so "Men's Clothing" was filed at `men-s-clothing` — a live storefront address
 * carrying a stray one-letter segment. The rule drops apostrophes now; this is
 * what moves the rows written under the old one.
 *
 * **It only touches a row the old rule explains.** A slug is rewritten when it
 * is exactly what the old rule produced from the row's own name *and* the new
 * rule produces something different — so a slug an owner typed by hand, or one
 * carrying a `-2` clash suffix, is left exactly where it is. A new slug already
 * taken by another row is reported and skipped rather than resolved, because
 * two names competing for one address is a decision, not a repair.
 *
 * Moving a slug moves a public URL, which is why this is a script and not a
 * migration: nothing in the catalogue does it silently. Two things travel with
 * it — the storefront's per-category glyph, which
 * `storefront_settings.header_configuration.categoryIcons` keys by **slug**
 * rather than by id, and any navigation item pointing at the old address. Both
 * would otherwise be left behind, the first as a missing icon and the second as
 * a dead menu link.
 */
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { STOREFRONT_CACHE_SCOPE, invalidateTenantCache } from '../src/lib/cache';
import { fetchTenantBySlug } from '../src/lib/company-client';
import { slugify } from '../src/lib/utils';
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

/** The rule as it stood before apostrophes were dropped. */
function legacySlugify(input: string, maxLength: number): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/** `catalog/service.ts#uniqueSlug` builds every one of these at 150. */
const MAX = 150;

const TABLES = ['categories', 'brands', 'products'] as const;

interface Row {
  id: string;
  name: string;
  slug: string;
}

interface Move {
  table: string;
  id: string;
  name: string;
  from: string;
  to: string;
}

async function main(): Promise<void> {
  console.log(`\nStore: ${SLUG}${GO ? '' : '   (dry run — pass --yes to apply)'}\n`);

  const pool = await openTenantPoolForSlug(SLUG!);
  const moves: Move[] = [];
  let changed = false;

  try {
    for (const table of TABLES) {
      const { rows } = await pool.query<Row>(`select id, name, slug from ${table}`);
      const taken = new Set(rows.map((row) => row.slug));

      for (const row of rows) {
        const next = slugify(row.name, MAX);
        if (!next || next === row.slug) continue;
        // Only a row the old rule explains. Anything else was chosen, not derived.
        if (legacySlugify(row.name, MAX) !== row.slug) continue;

        if (taken.has(next)) {
          console.log(`  ${table}: "${row.name}" → ${next} is already taken; left at ${row.slug}.`);
          continue;
        }

        taken.delete(row.slug);
        taken.add(next);
        moves.push({ table, id: row.id, name: row.name, from: row.slug, to: next });
      }
    }

    if (moves.length === 0) {
      console.log('Nothing to do — no slug on this store was broken by an apostrophe.\n');
      return;
    }

    console.log('Slugs to move:');
    for (const move of moves) {
      console.log(`  ${move.table.padEnd(11)} ${move.name.padEnd(24)} ${move.from}  →  ${move.to}`);
    }

    const categoryMoves = moves.filter((move) => move.table === 'categories');

    // The glyph map is keyed by slug, so it has to travel with the category.
    const { rows: designRows } = await pool.query<{
      id: string;
      header_configuration: Record<string, unknown> | null;
    }>(`select id, header_configuration from storefront_settings limit 1`);
    const design = designRows[0];
    const icons = (design?.header_configuration?.categoryIcons ?? {}) as Record<string, string>;
    const iconMoves = categoryMoves.filter((move) => move.from in icons);
    for (const move of iconMoves) {
      console.log(`  header icon "${icons[move.from]}" follows ${move.from} → ${move.to}`);
    }

    /*
     * A menu link typed as a plain address would otherwise 404. Only those:
     * an item whose `target_type` is `category` stores the category **id** and
     * is resolved to a slug at read time (`storefront-config.ts#hrefFor`), so
     * it follows the rename on its own.
     */
    const hrefs = categoryMoves.map((move) => `/category/${move.from}`);
    const { rows: navRows } = await pool.query<{ id: string; label: string; href: string }>(
      `select id, label, target_value as href
         from navigation_items
        where target_type = 'url' and target_value = any($1::text[])`,
      [hrefs],
    );
    for (const nav of navRows) {
      const move = categoryMoves.find((entry) => `/category/${entry.from}` === nav.href)!;
      console.log(`  menu link "${nav.label}" follows ${nav.href} → /category/${move.to}`);
    }

    if (!GO) {
      console.log('\nDry run — nothing changed.\n');
      return;
    }

    await pool.query('begin');
    try {
      for (const move of moves) {
        await pool.query(`update ${move.table} set slug = $1, updated_at = now() where id = $2`, [
          move.to,
          move.id,
        ]);
      }

      if (design && iconMoves.length > 0) {
        const next = { ...icons };
        for (const move of iconMoves) {
          next[move.to] = next[move.from]!;
          delete next[move.from];
        }
        await pool.query(
          `update storefront_settings
              set header_configuration = jsonb_set(
                    coalesce(header_configuration, '{}'::jsonb),
                    '{categoryIcons}',
                    $1::jsonb,
                    true
                  ),
                  updated_at = now()
            where id = $2`,
          [JSON.stringify(next), design.id],
        );
      }

      for (const nav of navRows) {
        const move = categoryMoves.find((entry) => `/category/${entry.from}` === nav.href)!;
        await pool.query(`update navigation_items set target_value = $1 where id = $2`, [
          `/category/${move.to}`,
          nav.id,
        ]);
      }

      await pool.query('commit');
    } catch (error) {
      await pool.query('rollback');
      throw error;
    }

    changed = true;
    console.log(`\nMoved ${moves.length} slug${moves.length === 1 ? '' : 's'}.`);
  } finally {
    await pool.end().catch(() => undefined);
  }

  /*
   * Written straight to the tables, so no `invalidateStorefrontOnWrite` hook
   * ran. Without this the shop keeps serving the old addresses for the length
   * of the Redis TTL — and the edge copy for its own two minutes on top, which
   * nothing here can purge.
   */
  if (changed) {
    const tenant = await fetchTenantBySlug(SLUG!).catch(() => null);
    if (tenant) {
      await invalidateTenantCache(tenant.tenantRef, STOREFRONT_CACHE_SCOPE);
      console.log('Storefront cache dropped. The edge copy expires within two minutes.');
    } else {
      console.log(
        'Could not reach company-api to drop the cache; it expires on its own within two minutes.',
      );
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

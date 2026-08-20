/**
 * Points a store's banners at the category each one already names in its URL.
 *
 *   npx tsx scripts/link-banners-to-categories.ts --slug e-comarch        # dry run
 *   npx tsx scripts/link-banners-to-categories.ts --slug e-comarch --yes  # do it
 *
 * `banners.link_url` was how the demo store's campaigns named their
 * destination: the literal string `/category/electronics`. `banners.category_id`
 * is what the panel writes now, and `home.routes.ts#resolveBanners` prefers it —
 * it rebuilds the path from the category's **current** slug and drops the link
 * entirely when the category has been switched off. A typed string does neither:
 * rename the category and every banner pointing at it quietly starts 404ing.
 *
 * So this converts one into the other. A banner is matched on the slug in its
 * own URL, which is why it works for a subcategory as readily as a top-level
 * one — the two are one table, and `/category/<slug>` is the same shape for
 * both. Anything that is not a category path (`/sale`, `/shop`, a landing page)
 * is left exactly as it is: those are destinations the schema deliberately still
 * allows, not banners that failed to be converted.
 *
 * Idempotent and dry by default, like `drop-duplicate-category-blocks.ts`.
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

interface BannerRow {
  id: string;
  title: string | null;
  position: string;
  link_url: string | null;
  category_id: string | null;
}

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  parent_id: string | null;
  is_active: boolean;
}

/** `/category/smartphones`, `/category/smartphones/`, `/category/smartphones?x=1` → `smartphones`. */
function slugInPath(linkUrl: string | null): string | null {
  if (!linkUrl) return null;
  const match = /^\/category\/([^/?#]+)/.exec(linkUrl.trim());
  return match ? decodeURIComponent(match[1]!) : null;
}

async function main(): Promise<void> {
  console.log(`\nStore: ${SLUG}${GO ? '' : '   (dry run — pass --yes to apply)'}\n`);

  const pool = await openTenantPoolForSlug(SLUG!);
  let linked = 0;

  try {
    const { rows: banners } = await pool.query<BannerRow>(
      `select id, title, position, link_url, category_id from banners order by position, sort_order`,
    );
    const { rows: categories } = await pool.query<CategoryRow>(
      `select id, slug, name, parent_id, is_active from categories`,
    );
    const bySlug = new Map(categories.map((row) => [row.slug, row]));

    const work: { banner: BannerRow; category: CategoryRow }[] = [];

    for (const banner of banners) {
      const label = `${banner.position.padEnd(13)} ${(banner.title ?? '—').slice(0, 26).padEnd(28)}`;

      if (banner.category_id) {
        const current = categories.find((row) => row.id === banner.category_id);
        console.log(`  ${label} already linked → ${current?.slug ?? 'a missing category'}`);
        continue;
      }

      const slug = slugInPath(banner.link_url);
      if (!slug) {
        console.log(`  ${label} left alone      → ${banner.link_url ?? 'no destination'}`);
        continue;
      }

      const category = bySlug.get(slug);
      if (!category) {
        // Worth saying out loud: this banner is already pointing at a 404.
        console.log(`  ${label} NO SUCH CATEGORY → ${banner.link_url}`);
        continue;
      }

      const kind = category.parent_id ? 'subcategory' : 'category';
      const off = category.is_active ? '' : ' (inactive — the banner will render unlinked)';
      console.log(`  ${label} link ${kind} → ${category.name}${off}`);
      work.push({ banner, category });
    }

    if (work.length === 0) {
      console.log('\nNothing to link.');
      return;
    }

    if (!GO) {
      console.log(`\n${work.length} banner(s) to link. Dry run — nothing changed.`);
      return;
    }

    for (const { banner, category } of work) {
      await pool.query(`update banners set category_id = $1, updated_at = now() where id = $2`, [
        category.id,
        banner.id,
      ]);
      linked += 1;
    }
    console.log(`\nLinked ${linked}.`);
  } finally {
    await pool.end().catch(() => undefined);
  }

  /* Written straight to the table, so no `invalidateStorefrontOnWrite` hook ran. */
  if (linked > 0) {
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

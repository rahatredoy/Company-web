import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDb } from '../../db/tenant-manager';
import { homepageSections, products } from '../../db/schema/index';
import { CACHE_TTL, cached, tenantKey } from '../../lib/cache';
import { ok } from '../../lib/http';
import { storeOf } from '../../plugins/tenant';
import { PUBLISHED_PRODUCT } from './service';
import type { HomepageSectionKind, HomepageSectionView } from './types';

/** Section kinds that show a list of products. */
const PRODUCT_LIST_SECTIONS = new Set<HomepageSectionKind>([
  'product_grid',
  'product_carousel',
  'flash_sale',
]);

const SOURCES = ['featured', 'new_arrivals', 'best_selling', 'sale'] as const;
type ProductSource = (typeof SOURCES)[number];

/**
 * Which products a dynamic section shows.
 *
 * The storefront resolves a product section from an explicit `productIds` list
 * and has no notion of "the newest eight" — which is right for a section the
 * owner curated by hand, and useless for the homepage a store is given on its
 * first day: a hardcoded list cannot contain a product that does not exist yet,
 * so the shop would stay empty however many products were added.
 *
 * Resolving the list here keeps that seam intact. The section still travels to
 * the storefront as `productIds`, so nothing downstream learns a second way to
 * read the catalogue — and "which products are published" stays a question only
 * this API answers.
 */
async function resolveSource(db: TenantDb, source: ProductSource, limit: number): Promise<string[]> {
  const order =
    source === 'featured'
      ? [desc(products.isFeatured), desc(products.soldCount)]
      : source === 'best_selling'
        ? [desc(products.soldCount)]
        : source === 'sale'
          ? [desc(products.updatedAt)]
          : [desc(sql`coalesce(${products.publishedAt}, ${products.createdAt})`)];

  const where =
    source === 'featured'
      ? and(PUBLISHED_PRODUCT, eq(products.isFeatured, true))
      : source === 'sale'
        ? and(
            PUBLISHED_PRODUCT,
            isNotNull(products.salePriceFrom),
            sql`${products.salePriceFrom} < ${products.priceFrom}`,
          )
        : PUBLISHED_PRODUCT;

  const rows = await db
    .select({ id: products.id })
    .from(products)
    .where(where)
    .orderBy(...order)
    .limit(limit);

  return rows.map((row) => row.id);
}

function readSource(value: unknown): ProductSource | null {
  return typeof value === 'string' && (SOURCES as readonly string[]).includes(value)
    ? (value as ProductSource)
    : null;
}

/**
 * Fills a dynamic section's product list in, leaving a curated one alone.
 *
 * A section that names its products explicitly — `productIds`, or per-tab lists —
 * is the owner's arrangement and is never second-guessed.
 */
async function withResolvedProducts(
  db: TenantDb,
  section: HomepageSectionView,
): Promise<HomepageSectionView> {
  const config = section.config;
  const source = readSource(config.source);
  if (!source) return section;

  const limit = Number.isFinite(Number(config.limit))
    ? Math.min(Math.max(Number(config.limit), 1), 24)
    : 8;

  if (PRODUCT_LIST_SECTIONS.has(section.type)) {
    if (Array.isArray(config.productIds) || Array.isArray(config.tabs)) return section;
    return { ...section, config: { ...config, productIds: await resolveSource(db, source, limit) } };
  }

  // A `deal` block features exactly one product.
  if (section.type === 'deal') {
    if (typeof config.productId === 'string') return section;
    const [first] = await resolveSource(db, source, 1);
    return first ? { ...section, config: { ...config, productId: first } } : section;
  }

  return section;
}

/**
 * The homepage, as the owner arranged it.
 *
 * This returns the *layout*: which blocks, in which order, configured how. The
 * products inside a block are fetched by the storefront through the ordinary
 * listing endpoint, so a homepage never becomes a second, differently-filtered
 * way to read the catalogue — one that would need its own "is this published"
 * check to get right.
 */
export default async function homeRoutes(app: FastifyInstance) {
  app.get('/home', async (request, reply) => {
    const store = storeOf(request);

    const sections = await cached(
      tenantKey(store.tenantRef, 'storefront', 'home'),
      CACHE_TTL.homepage,
      async () => {
        const rows = await store.db
          .select({
            id: homepageSections.id,
            type: homepageSections.type,
            title: homepageSections.title,
            subtitle: homepageSections.subtitle,
            config: homepageSections.config,
          })
          .from(homepageSections)
          .where(eq(homepageSections.isEnabled, true))
          .orderBy(asc(homepageSections.sortOrder));

        const views = rows.map(
          (row) =>
            ({
              id: row.id,
              type: row.type as HomepageSectionKind,
              title: row.title,
              subtitle: row.subtitle,
              // Free-form by design — the renderer validates per type and skips
              // what it does not recognise, so a section saved by a newer admin
              // build degrades to nothing rather than to a crash.
              config: row.config ?? {},
            }) satisfies HomepageSectionView,
        );

        return Promise.all(views.map((section) => withResolvedProducts(store.db, section)));
      },
    );

    return ok(reply, sections);
  });
}

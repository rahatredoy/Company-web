import { and, asc, desc, eq, gt, gte, isNotNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDb } from '../../db/tenant-manager';
import {
  banners,
  collectionProducts,
  collections,
  flashSaleProducts,
  flashSales,
  homepageSections,
  products,
} from '../../db/schema/index';
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

const SOURCES = ['featured', 'new_arrivals', 'best_selling', 'sale', 'recommended'] as const;
type ProductSource = (typeof SOURCES)[number];

/**
 * How many reviews a product needs before its rating can rank it.
 *
 * `recommended` orders by rating, and a rating is only as trustworthy as the
 * number of people behind it. Without a floor a single five-star review outranks
 * a 4.8 with two hundred, which is exactly the product nobody has bought yet.
 */
const RECOMMENDED_MIN_REVIEWS = 5;

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
  /*
   * `sale` ranks by how deep the discount is, not by when the row was last
   * touched. A "Deal of the Day" block asks this source for a single product, so
   * ordering by `updatedAt` made the day's deal mean "whichever sale product was
   * saved most recently" — which put a 20%-off dash cam in front of 25%-off
   * headphones. Depth is the thing the block is actually claiming; `updatedAt`
   * stays as the tie-breaker so equal discounts still favour the fresher campaign.
   */
  const discountDepth = sql`(${products.priceFrom} - ${products.salePriceFrom}) / nullif(${products.priceFrom}, 0)`;

  const order =
    source === 'featured'
      ? [desc(products.isFeatured), desc(products.soldCount)]
      : source === 'best_selling'
        ? [desc(products.soldCount)]
        : source === 'sale'
          ? [desc(discountDepth), desc(products.updatedAt)]
          : source === 'recommended'
            ? [desc(products.ratingAverage), desc(products.ratingCount)]
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
        : source === 'recommended'
          ? and(PUBLISHED_PRODUCT, gte(products.ratingCount, RECOMMENDED_MIN_REVIEWS))
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

/** Section limits are clamped: a homepage block is never a way to dump the catalogue. */
function readLimit(value: unknown, fallback = 8): number {
  const limit = Number(value);
  return Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 24) : fallback;
}

/**
 * The flash sale that is running right now, if one is.
 *
 * A countdown is a promise about the clock, so the deadline has to come from the
 * campaign rather than from the section: `config.endsInHours` made every render
 * a fresh 24 hours, a timer that never reaches zero and never meant anything.
 * A window that has closed resolves to nothing and the block disappears — which
 * is the honest outcome, and the reason this returns null rather than the most
 * recent sale.
 *
 * Prices come from `flash_sale_products.sale_price`, not from the product, so a
 * campaign can discount without disturbing the catalogue it borrows from.
 */
async function resolveFlashSale(
  db: TenantDb,
  limit: number,
): Promise<{ endsAt: string; productIds: string[]; salePrices: Record<string, string> } | null> {
  const now = new Date();

  const [sale] = await db
    .select({ id: flashSales.id, endsAt: flashSales.endsAt })
    .from(flashSales)
    .where(and(eq(flashSales.isActive, true), lte(flashSales.startsAt, now), gt(flashSales.endsAt, now)))
    .orderBy(asc(flashSales.endsAt))
    .limit(1);

  if (!sale) return null;

  const rows = await db
    .select({ id: products.id, salePrice: flashSaleProducts.salePrice })
    .from(flashSaleProducts)
    .innerJoin(products, eq(products.id, flashSaleProducts.productId))
    .where(and(eq(flashSaleProducts.flashSaleId, sale.id), PUBLISHED_PRODUCT))
    .orderBy(asc(flashSaleProducts.sortOrder))
    .limit(limit);

  if (rows.length === 0) return null;

  return {
    endsAt: sale.endsAt.toISOString(),
    productIds: rows.map((row) => row.id),
    salePrices: Object.fromEntries(rows.map((row) => [row.id, row.salePrice])),
  };
}

/** A curated collection and the published products in it, in the owner's order. */
async function resolveCollection(
  db: TenantDb,
  slug: string,
  limit: number,
): Promise<{ name: string; description: string | null; imageUrl: string | null; productIds: string[] } | null> {
  const [collection] = await db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      imageUrl: collections.imageUrl,
    })
    .from(collections)
    .where(and(eq(collections.slug, slug), eq(collections.isActive, true)))
    .limit(1);

  if (!collection) return null;

  const rows = await db
    .select({ id: products.id })
    .from(collectionProducts)
    .innerJoin(products, eq(products.id, collectionProducts.productId))
    .where(and(eq(collectionProducts.collectionId, collection.id), PUBLISHED_PRODUCT))
    .orderBy(asc(collectionProducts.sortOrder))
    .limit(limit);

  if (rows.length === 0) return null;

  return {
    name: collection.name,
    description: collection.description,
    imageUrl: collection.imageUrl,
    productIds: rows.map((row) => row.id),
  };
}

/**
 * Banners for one placement, from the table the admin panel writes.
 *
 * `/banners` in the admin panel has always written this table and nothing has
 * ever read it — homepage banners were embedded in section config instead, so
 * the manager edited rows that reached no shopfront. A section naming a
 * `bannerPosition` reads them; one carrying its own `config.banners` is
 * untouched, so both authoring routes keep working.
 */
async function resolveBanners(
  db: TenantDb,
  position: 'home_hero' | 'home_promo' | 'category_top' | 'sidebar' | 'popup',
  limit: number,
): Promise<Record<string, unknown>[]> {
  const now = new Date();

  const rows = await db
    .select({
      id: banners.id,
      title: banners.title,
      subtitle: banners.subtitle,
      imageUrl: banners.imageUrl,
      mobileImageUrl: banners.mobileImageUrl,
      linkUrl: banners.linkUrl,
      buttonLabel: banners.buttonLabel,
    })
    .from(banners)
    .where(
      and(
        eq(banners.position, position),
        eq(banners.isActive, true),
        // A null bound means "no bound", so an always-on banner needs neither.
        or(sql`${banners.startsAt} is null`, lte(banners.startsAt, now)),
        or(sql`${banners.endsAt} is null`, gt(banners.endsAt, now)),
      ),
    )
    .orderBy(asc(banners.sortOrder))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    imageUrl: row.imageUrl,
    mobileImageUrl: row.mobileImageUrl,
    linkUrl: row.linkUrl,
    buttonLabel: row.buttonLabel,
  }));
}

const BANNER_POSITIONS = ['home_hero', 'home_promo', 'category_top', 'sidebar', 'popup'] as const;

function readBannerPosition(value: unknown): (typeof BANNER_POSITIONS)[number] | null {
  return typeof value === 'string' && (BANNER_POSITIONS as readonly string[]).includes(value)
    ? (value as (typeof BANNER_POSITIONS)[number])
    : null;
}

/**
 * Fills a dynamic section's product list in, leaving a curated one alone.
 *
 * A section that names its products explicitly — `productIds`, or a tab that
 * carries its own list — is the owner's arrangement and is never second-guessed.
 *
 * Tabs resolve individually, because that is the whole point of the block: a
 * "Featured · New Arrivals · Best Sellers · On Sale" bar is four *different*
 * questions about the catalogue, and one list shared between them would answer
 * none of them. Without this a tabbed section could only ever hold frozen ids —
 * the same dead-list problem `resolveSource` exists to avoid.
 */
async function withResolvedProducts(
  db: TenantDb,
  section: HomepageSectionView,
): Promise<HomepageSectionView> {
  const config = section.config;

  /*
   * A live campaign outranks whatever the section was saved with. The other
   * branches fill a gap and leave a curated list alone; this one replaces, and
   * has to — the deadline and the sale prices are facts about the running
   * campaign, and a section holding its own copy of them would go stale the
   * moment the campaign was edited.
   */
  if (section.type === 'flash_sale' && !Array.isArray(config.productIds)) {
    const sale = await resolveFlashSale(db, readLimit(config.limit, 12));
    if (!sale) return section;

    return {
      ...section,
      config: {
        ...config,
        endsAt: sale.endsAt,
        productIds: sale.productIds,
        salePrices: sale.salePrices,
      },
    };
  }

  if (section.type === 'collection' && typeof config.collectionSlug === 'string') {
    const collection = await resolveCollection(db, config.collectionSlug, readLimit(config.limit, 8));
    if (!collection) return section;

    return { ...section, config: { ...config, collection } };
  }

  if ((section.type === 'banner' || section.type === 'promo_trio') && !Array.isArray(config.banners)) {
    const position = readBannerPosition(config.bannerPosition);
    if (!position) return section;

    const rows = await resolveBanners(db, position, section.type === 'promo_trio' ? 3 : 4);
    return rows.length > 0 ? { ...section, config: { ...config, banners: rows } } : section;
  }

  if (PRODUCT_LIST_SECTIONS.has(section.type) && Array.isArray(config.tabs)) {
    const tabs = await Promise.all(
      config.tabs.map(async (entry) => {
        const tab = (entry ?? {}) as Record<string, unknown>;
        if (Array.isArray(tab.productIds)) return tab;

        const tabSource = readSource(tab.source);
        if (!tabSource) return tab;

        const limit = readLimit(tab.limit ?? config.limit);
        return { ...tab, productIds: await resolveSource(db, tabSource, limit) };
      }),
    );

    return { ...section, config: { ...config, tabs } };
  }

  const source = readSource(config.source);
  if (!source) return section;

  const limit = readLimit(config.limit);

  if (PRODUCT_LIST_SECTIONS.has(section.type)) {
    if (Array.isArray(config.productIds)) return section;
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

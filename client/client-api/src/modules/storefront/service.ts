import { and, asc, desc, eq, gte, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { TenantDb } from '../../db/tenant-manager';
import {
  attributeValues,
  attributes,
  brands,
  categories,
  productAttributeValues,
  productMedia,
  productSpecifications,
  products,
  storeSettings,
} from '../../db/schema/index';
import { CACHE_TTL, cached, tenantKey } from '../../lib/cache';
import type { FilterGroup, ProductImage, ProductSummary, SortValue } from './types';

/**
 * The one rule this module exists to keep: **the storefront sees published rows
 * only.** The admin panel reads drafts, inactive categories and unapproved
 * reviews because that is its job; every query below is filtered so the public
 * surface cannot, no matter which route reaches it.
 */
export const PUBLISHED_PRODUCT = eq(products.status, 'active');

/**
 * How many units sold earns the "Best Seller" flash.
 *
 * A fixed number rather than a ranking, because a percentile makes the badge
 * relative to whatever else the store happens to sell — on a shop with four
 * products the worst seller of the four would still wear it. Ten is low enough
 * that a real store reaches it and high enough that one sale does not.
 */
const BEST_SELLER_MIN_SOLD = 10;

/** Below this many units a variant is "Only N left" rather than in stock. */
const DEFAULT_LOW_STOCK_THRESHOLD = 5;

// --------------------------------------------------------------- currency ----

/**
 * The currency this store quotes prices in.
 *
 * Every storefront read accepts a `?currency=` parameter — it is part of the
 * Next.js cache key, so a shared cache entry can never serve one visitor's
 * currency to the next — but the value is **not** honoured here, and that is
 * deliberate rather than unfinished. Converting would mean holding exchange
 * rates and deciding when they are stale, and a price is what the customer is
 * charged; quoting one at yesterday's rate is a pricing bug, not a display one.
 *
 * `store_settings.preferences.currencies` therefore seeds with the single
 * currency the store trades in, the storefront draws no selector when there is
 * only one, and the parameter is inert until there is a rate source to make it
 * mean something.
 */
export async function loadStoreCurrency(store: {
  tenantRef: string;
  currency: string;
  db: TenantDb;
}): Promise<string> {
  return cached(tenantKey(store.tenantRef, 'storefront', 'currency'), CACHE_TTL.storefrontConfig, async () => {
    const [row] = await store.db.select({ currency: storeSettings.currency }).from(storeSettings).limit(1);
    // The control plane's value is the fallback: it is what provisioning wrote
    // into `store_settings` in the first place.
    return row?.currency ?? store.currency;
  });
}

// ------------------------------------------------------------------ money ----

/**
 * The price a customer actually pays, given a sale window.
 *
 * A sale price with a window that has not opened or has already closed is not a
 * sale — the column keeps its value so the owner can schedule one without
 * retyping it, which means the dates have to be honoured on read.
 */
export function effectiveSale(
  salePrice: string | null,
  startsAt: Date | null,
  endsAt: Date | null,
  now = new Date(),
): string | null {
  if (salePrice === null) return null;
  if (startsAt && startsAt > now) return null;
  if (endsAt && endsAt < now) return null;
  return salePrice;
}

/**
 * Computed here rather than in the browser, so the badge and the price can never
 * disagree — they are derived from the same two numbers in the same place.
 */
export function discountPercent(price: string | null, salePrice: string | null): number | null {
  if (!price || !salePrice) return null;

  const full = Number(price);
  const sale = Number(salePrice);
  if (!Number.isFinite(full) || !Number.isFinite(sale) || full <= 0 || sale >= full) return null;

  return Math.round(((full - sale) / full) * 100);
}

// --------------------------------------------------------------- category ----

export interface CategoryNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
}

/** Every active category, as a flat list. Small enough to walk in memory. */
export async function loadCategoryTree(db: TenantDb): Promise<CategoryNode[]> {
  return db
    .select({
      id: categories.id,
      parentId: categories.parentId,
      name: categories.name,
      slug: categories.slug,
    })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(asc(categories.sortOrder), asc(categories.name));
}

/**
 * A category and everything beneath it.
 *
 * A listing for "Men" must include "Men → Shirts", so the filter is a subtree
 * rather than a single id. `parent_id` carries no foreign key, so a row whose
 * parent was deleted would loop a naive walk — `seen` is what stops that being a
 * hung request rather than an odd-looking page.
 */
export function descendantIds(tree: CategoryNode[], rootId: string): string[] {
  const byParent = new Map<string, CategoryNode[]>();
  for (const node of tree) {
    if (!node.parentId) continue;
    const siblings = byParent.get(node.parentId);
    if (siblings) siblings.push(node);
    else byParent.set(node.parentId, [node]);
  }

  const seen = new Set<string>([rootId]);
  const queue = [rootId];

  while (queue.length > 0) {
    for (const child of byParent.get(queue.shift()!) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      queue.push(child.id);
    }
  }

  return [...seen];
}

/** Root-to-node trail for the breadcrumb, ordered outermost first. */
export function breadcrumbFor(tree: CategoryNode[], categoryId: string): { name: string; slug: string }[] {
  const byId = new Map(tree.map((node) => [node.id, node]));
  const trail: { name: string; slug: string }[] = [];
  const seen = new Set<string>();

  let current = byId.get(categoryId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    trail.unshift({ name: current.name, slug: current.slug });
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  return trail;
}

// ------------------------------------------------------------------ query ----

export interface ListingFilters {
  q?: string;
  categoryIds?: string[];
  brandSlugs?: string[];
  minPrice?: number;
  maxPrice?: number;
  rating?: number;
  inStock?: boolean;
  sale?: boolean;
  /** attribute slug → attribute value slugs. */
  attributes?: Record<string, string[]>;
}

/** What a customer pays, as SQL — the sale price when there is one. */
const effectivePriceSql = sql<string>`coalesce(${products.salePriceFrom}, ${products.priceFrom}, 0)`;

/**
 * True when the product has no stock records at all, or has some available.
 *
 * The first half matters more than it looks: a store that has never opened the
 * inventory screens has no `inventory_levels` rows, and reading that as "zero
 * available" would hide every product in the shop behind an Out of Stock badge.
 * Absent records mean stock is not being tracked, which is not the same as none.
 */
const inStockSql = sql`(
  not exists (
    select 1 from inventory_levels il
    join product_variants pv on pv.id = il.variant_id
    where pv.product_id = ${products.id}
  )
  or exists (
    select 1 from inventory_levels il
    join product_variants pv on pv.id = il.variant_id
    where pv.product_id = ${products.id} and pv.is_active and il.available > 0
  )
)`;

/**
 * Matches a descriptive attribute value *or* a variant-defining one.
 *
 * Colour is stored on the variant and Material on the product, but a shopper
 * ticking "Black" in the filter panel does not know or care which — one filter
 * has to reach both tables or half the facets silently return nothing.
 */
function attributeCondition(attributeSlug: string, valueSlugs: string[]): SQL {
  return sql`exists (
    select 1 from attribute_values av
    join attributes a on a.id = av.attribute_id
    where a.slug = ${attributeSlug}
      and av.slug in (${sql.join(valueSlugs.map((v) => sql`${v}`), sql`, `)})
      and (
        exists (
          select 1 from product_attribute_values pav
          where pav.product_id = ${products.id} and pav.attribute_value_id = av.id
        )
        or exists (
          select 1 from product_variant_values pvv
          join product_variants pv on pv.id = pvv.variant_id
          where pv.product_id = ${products.id} and pvv.attribute_value_id = av.id
        )
      )
  )`;
}

/**
 * Builds the WHERE for a listing.
 *
 * `exclude` leaves one dimension out so a facet can be counted as if its own
 * filter were not applied — otherwise ticking one brand collapses the brand list
 * to that single brand and there is no way back to the others.
 */
export function listingConditions(filters: ListingFilters, exclude?: string): SQL[] {
  const conditions: SQL[] = [PUBLISHED_PRODUCT];

  if (filters.q) {
    const term = `%${filters.q}%`;
    conditions.push(
      or(
        sql`${products.name} ilike ${term}`,
        sql`${products.shortDescription} ilike ${term}`,
      )!,
    );
  }

  if (filters.categoryIds?.length) {
    conditions.push(inArray(products.categoryId, filters.categoryIds));
  }

  if (exclude !== 'brand' && filters.brandSlugs?.length) {
    conditions.push(
      sql`exists (select 1 from brands b where b.id = ${products.brandId} and b.slug in (${sql.join(
        filters.brandSlugs.map((s) => sql`${s}`),
        sql`, `,
      )}))`,
    );
  }

  if (exclude !== 'price') {
    if (filters.minPrice !== undefined) conditions.push(sql`${effectivePriceSql} >= ${filters.minPrice}`);
    if (filters.maxPrice !== undefined) conditions.push(sql`${effectivePriceSql} <= ${filters.maxPrice}`);
  }

  if (exclude !== 'rating' && filters.rating !== undefined) {
    conditions.push(gte(products.ratingAverage, String(filters.rating)));
  }

  if (filters.inStock) conditions.push(inStockSql);

  if (filters.sale) {
    conditions.push(
      sql`${products.salePriceFrom} is not null and ${products.salePriceFrom} < ${products.priceFrom}`,
    );
  }

  for (const [slug, values] of Object.entries(filters.attributes ?? {})) {
    if (values.length === 0 || exclude === `attr.${slug}`) continue;
    conditions.push(attributeCondition(slug, values));
  }

  return conditions;
}

/** The six sorts the storefront offers, and nothing a caller can invent. */
export function orderFor(sort: SortValue): SQL[] {
  switch (sort) {
    case 'newest':
      return [desc(sql`coalesce(${products.publishedAt}, ${products.createdAt})`)];
    case 'price_asc':
      return [asc(effectivePriceSql)];
    case 'price_desc':
      return [desc(effectivePriceSql)];
    case 'best_selling':
      return [desc(products.soldCount)];
    case 'rating':
      return [desc(products.ratingAverage), desc(products.ratingCount)];
    case 'relevance':
    default:
      // Featured first is the owner's own thumb on the scale, which is what
      // "Recommended" means on a shop this size; sales break the tie.
      return [desc(products.isFeatured), desc(products.soldCount), desc(products.createdAt)];
  }
}

// ------------------------------------------------------------- decoration ----

export interface ProductBaseRow {
  id: string;
  slug: string;
  name: string;
  type: 'simple' | 'variable';
  priceFrom: string | null;
  salePriceFrom: string | null;
  ratingAverage: string;
  ratingCount: number;
  isNewArrival: boolean;
  soldCount: number;
  brandId: string | null;
  brandName: string | null;
  brandSlug: string | null;
}

/** The columns every listing selects. Kept in one place so they cannot drift. */
export const productBaseColumns = {
  id: products.id,
  slug: products.slug,
  name: products.name,
  type: products.type,
  priceFrom: products.priceFrom,
  salePriceFrom: products.salePriceFrom,
  ratingAverage: products.ratingAverage,
  ratingCount: products.ratingCount,
  isNewArrival: products.isNewArrival,
  soldCount: products.soldCount,
  brandId: brands.id,
  brandName: brands.name,
  brandSlug: brands.slug,
} as const;

/**
 * Raw-SQL rows come back untyped, so the shape is asserted here.
 *
 * The index signature is what `db.execute` requires of its type argument; the
 * named fields are what the code actually reads.
 */
interface StockRow extends Record<string, unknown> {
  productId: string;
  trackedRows: number;
  available: number;
  threshold: number;
}

/**
 * Turns product rows into what a card needs, in three batched reads.
 *
 * Images, stock and key specs are fetched per page rather than per product: a
 * 24-product grid was otherwise 72 round trips, and the joined alternative
 * multiplies the product row by its image count and has to be de-duplicated
 * afterwards anyway.
 */
export async function decorateSummaries(
  db: TenantDb,
  rows: ProductBaseRow[],
  currency: string,
): Promise<ProductSummary[]> {
  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);

  const [mediaRows, stockRows, specRows] = await Promise.all([
    db
      .select({
        productId: productMedia.productId,
        url: productMedia.url,
        altText: productMedia.altText,
        width: productMedia.width,
        height: productMedia.height,
      })
      .from(productMedia)
      .where(and(inArray(productMedia.productId, ids), eq(productMedia.type, 'image')))
      .orderBy(desc(productMedia.isPrimary), asc(productMedia.sortOrder)),

    db.execute<StockRow>(sql`
      select pv.product_id                                   as "productId",
             count(il.id)::int                               as "trackedRows",
             coalesce(sum(il.available), 0)::int             as "available",
             coalesce(min(il.low_stock_threshold), ${DEFAULT_LOW_STOCK_THRESHOLD})::int as "threshold"
      from product_variants pv
      left join inventory_levels il on il.variant_id = pv.id
      where pv.product_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
        and pv.is_active
      group by pv.product_id
    `),

    db
      .select({
        productId: productSpecifications.productId,
        value: productSpecifications.value,
      })
      .from(productSpecifications)
      .where(and(inArray(productSpecifications.productId, ids), eq(productSpecifications.isKeySpec, true)))
      .orderBy(asc(productSpecifications.sortOrder)),
  ]);

  const imagesBy = new Map<string, ProductImage[]>();
  for (const media of mediaRows) {
    const list = imagesBy.get(media.productId) ?? [];
    list.push({ url: media.url, altText: media.altText, width: media.width, height: media.height });
    imagesBy.set(media.productId, list);
  }

  const stockBy = new Map<string, StockRow>();
  for (const row of stockRows.rows ?? []) stockBy.set(row.productId, row);

  const specBy = new Map<string, string>();
  for (const spec of specRows) if (!specBy.has(spec.productId)) specBy.set(spec.productId, spec.value);

  return rows.map((row) => {
    const images = imagesBy.get(row.id) ?? [];
    const stock = stockBy.get(row.id);

    // No rows at all means stock is not tracked for this product, which reads as
    // available. See `inStockSql` — the two must agree or a product would be
    // listed by the filter and then contradicted by its own badge.
    const tracked = (stock?.trackedRows ?? 0) > 0;
    const available = stock?.available ?? 0;

    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      brand:
        row.brandId && row.brandName && row.brandSlug
          ? { id: row.brandId, name: row.brandName, slug: row.brandSlug }
          : null,
      primaryImage: images[0] ?? null,
      secondaryImage: images[1] ?? null,
      price: row.priceFrom ?? '0',
      salePrice: row.salePriceFrom,
      discountPercent: discountPercent(row.priceFrom, row.salePriceFrom),
      currency,
      ratingAverage: Number(row.ratingAverage) || 0,
      ratingCount: row.ratingCount,
      inStock: !tracked || available > 0,
      lowStock: tracked && available > 0 && available <= (stock?.threshold ?? DEFAULT_LOW_STOCK_THRESHOLD),
      isNewArrival: row.isNewArrival,
      isBestSeller: row.soldCount >= BEST_SELLER_MIN_SOLD,
      keySpec: specBy.get(row.id) ?? null,
      hasVariants: row.type === 'variable',
    } satisfies ProductSummary;
  });
}

// ----------------------------------------------------------------- facets ----

/**
 * The filter panel, counted against this result set.
 *
 * Every group is counted with its own filter lifted (`exclude`), so the options a
 * shopper has *not* chosen still show how many products they would return. A
 * group with fewer than two options is dropped: a filter that cannot change the
 * result is a control that does nothing.
 */
export async function buildFacets(db: TenantDb, filters: ListingFilters): Promise<FilterGroup[]> {
  const [brandRows, priceRow, attributeRows] = await Promise.all([
    db
      .select({
        value: brands.slug,
        label: brands.name,
        count: sql<number>`count(*)::int`,
      })
      .from(products)
      .innerJoin(brands, eq(brands.id, products.brandId))
      .where(and(...listingConditions(filters, 'brand'), eq(brands.isActive, true)))
      .groupBy(brands.slug, brands.name)
      .orderBy(asc(brands.name)),

    db
      .select({
        min: sql<string>`coalesce(min(${effectivePriceSql}), 0)`,
        max: sql<string>`coalesce(max(${effectivePriceSql}), 0)`,
      })
      .from(products)
      .where(and(...listingConditions(filters, 'price'))),

    db
      .select({
        attributeSlug: attributes.slug,
        attributeName: attributes.name,
        inputType: attributes.inputType,
        value: attributeValues.slug,
        label: attributeValues.value,
        colorHex: attributeValues.colorHex,
        count: sql<number>`count(distinct ${products.id})::int`,
      })
      .from(products)
      .innerJoin(
        productAttributeValues,
        eq(productAttributeValues.productId, products.id),
      )
      .innerJoin(attributeValues, eq(attributeValues.id, productAttributeValues.attributeValueId))
      .innerJoin(attributes, eq(attributes.id, attributeValues.attributeId))
      .where(and(...listingConditions(filters), eq(attributes.isFilterable, true)))
      // Both sort columns have to be grouped as well as ordered by: Postgres
      // refuses an ORDER BY over a column that is neither aggregated nor in the
      // GROUP BY, and they are what keeps the panel in the owner's chosen order.
      .groupBy(
        attributes.slug,
        attributes.name,
        attributes.inputType,
        attributes.sortOrder,
        attributeValues.slug,
        attributeValues.value,
        attributeValues.colorHex,
        attributeValues.sortOrder,
      )
      .orderBy(asc(attributes.sortOrder), asc(attributeValues.sortOrder)),
  ]);

  const groups: FilterGroup[] = [];

  if (brandRows.length > 1) {
    groups.push({
      key: 'brand',
      label: 'Brand',
      type: 'checkbox',
      options: brandRows.map((row) => ({ value: row.value, label: row.label, count: row.count })),
    });
  }

  const min = Math.floor(Number(priceRow[0]?.min ?? 0));
  const max = Math.ceil(Number(priceRow[0]?.max ?? 0));
  if (max > min) {
    groups.push({ key: 'price', label: 'Price', type: 'range', options: [], min, max });
  }

  const byAttribute = new Map<string, FilterGroup>();
  for (const row of attributeRows) {
    const group = byAttribute.get(row.attributeSlug) ?? {
      key: row.attributeSlug,
      label: row.attributeName,
      type: row.inputType === 'color' ? ('color' as const) : ('checkbox' as const),
      options: [],
    };
    group.options.push({
      value: row.value,
      label: row.label,
      count: row.count,
      ...(row.colorHex ? { colorHex: row.colorHex } : {}),
    });
    byAttribute.set(row.attributeSlug, group);
  }

  for (const group of byAttribute.values()) {
    if (group.options.length > 1) groups.push(group);
  }

  return groups;
}

// ------------------------------------------------------------------ misc ----

/** Reflects the filters back so the UI can render "clear" chips it did not parse. */
export function appliedFiltersOf(filters: ListingFilters, categorySlug?: string): Record<string, string[]> {
  const applied: Record<string, string[]> = {};

  if (categorySlug) applied.category = [categorySlug];
  if (filters.brandSlugs?.length) applied.brand = filters.brandSlugs;
  if (filters.rating !== undefined) applied.rating = [String(filters.rating)];
  if (filters.inStock) applied.inStock = ['true'];
  if (filters.sale) applied.sale = ['true'];
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    applied.price = [String(filters.minPrice ?? 0), String(filters.maxPrice ?? 0)];
  }
  for (const [slug, values] of Object.entries(filters.attributes ?? {})) {
    if (values.length > 0) applied[slug] = values;
  }

  return applied;
}

/**
 * Stock for one variant, as the coarse band the storefront is allowed to know.
 *
 * A precise count is competitive intelligence and an invitation to scrape, so
 * "Only 3 left" is surfaced only inside the low-stock band, where it is
 * information a shopper acts on rather than a live inventory feed.
 */
export function stockBandFor(
  tracked: boolean,
  available: number,
  threshold: number,
): { inStock: boolean; lowStock: boolean; stockLabel: 'in_stock' | 'low_stock' | 'out_of_stock'; remainingHint: number | null } {
  if (!tracked) return { inStock: true, lowStock: false, stockLabel: 'in_stock', remainingHint: null };
  if (available <= 0) return { inStock: false, lowStock: false, stockLabel: 'out_of_stock', remainingHint: null };
  if (available <= threshold) {
    return { inStock: true, lowStock: true, stockLabel: 'low_stock', remainingHint: available };
  }
  return { inStock: true, lowStock: false, stockLabel: 'in_stock', remainingHint: null };
}

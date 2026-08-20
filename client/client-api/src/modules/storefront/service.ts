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
  productVariants,
  products,
  storeSettings,
} from '../../db/schema/index';
import { CACHE_TTL, cached, tenantKey } from '../../lib/cache';
import {
  normaliseMeasureOptions,
  resolveMeasureConfig,
  type MeasureOption,
} from '../../lib/measure';
import type { FilterGroup, ProductImage, ProductSummary, SortValue } from './types';

/**
 * The one rule this module exists to keep: **the storefront sees published rows
 * only.** The admin panel reads drafts, inactive categories and unapproved
 * reviews because that is its job; every query below is filtered so the public
 * surface cannot, no matter which route reaches it.
 */
export const PUBLISHED_PRODUCT = eq(products.status, 'active');

/**
 * How long the storefront keeps the same window on the catalogue before it moves
 * on.
 *
 * A shop with two hundred products and half a dozen blocks on its front page
 * shows about forty of them, and always the same forty: "best sellers" is the
 * same twelve every day by definition, and a product nobody has bought or
 * reviewed yet is in none of the blocks at all. So most of the catalogue can
 * only be reached by searching for something the visitor has not seen and does
 * not know to ask for. Moving the window is what puts the rest of the shop in
 * front of them.
 *
 * An hour, and it cannot usefully be much less: these responses are held two
 * minutes in Redis, two minutes at the edge and two minutes by the storefront's
 * own ISR, so a rotation near those numbers would mostly turn inside a cache
 * nobody can see. It is also long enough not to reshuffle the page under a
 * shopper who is still reading it — a homepage that has changed on the way back
 * from a product page reads as a fault rather than as variety.
 *
 * It lives here rather than beside either of its callers because **both the
 * homepage's product blocks and the category showcase's aisles turn on the same
 * stroke.** Two clocks would mean a panel of aisles flipping at one moment and
 * the rails above it at another, which a visitor reads as the page rebuilding
 * itself twice.
 */
export const ROTATION_SECONDS = 60 * 60;

/**
 * Which rotation this store is in.
 *
 * Phased per store rather than aligned to the wall clock: every homepage on the
 * platform turning over on the same stroke of the hour is a stampede onto the
 * databases at the top of every hour, and one hash of the tenant reference
 * spreads them across it. The reference is fixed for the life of the store, so
 * a store's rotation never jumps sideways on a restart or a deploy.
 *
 * `now` is a parameter, and this is exported alongside the two resolvers that
 * read it, for one reason: `scripts/verify-home-rotation.ts` walks a whole lap
 * and asserts the coverage this platform claims. There is no way to prove that
 * from outside — a caller cannot move the clock, and a lap is a day long.
 */
export function rotationIndex(tenantRef: string, now = Date.now()): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < tenantRef.length; index += 1) {
    hash = Math.imul(hash ^ tenantRef.charCodeAt(index), 0x01000193) >>> 0;
  }

  return Math.floor((Math.floor(now / 1000) + (hash % ROTATION_SECONDS)) / ROTATION_SECONDS);
}

/**
 * The window a rotation is looking at, wrapped around the end of the list.
 *
 * The window advances by **its own width** each turn, so a lap works through the
 * list rather than sampling it: everything in it is shown, and nothing is shown
 * twice before the rest have had their turn. A list that already fits is
 * returned as it is — a block showing everything it has stays where it is, which
 * is also what guarantees the wrap cannot put one entry in the same window
 * twice.
 *
 * This is the in-memory twin of what `resolveSource` does with `OFFSET`, used
 * where the list is already in hand: the aisles of one department, after the
 * empty ones have been dropped.
 */
export function rotateWindow<T>(list: T[], size: number, rotation: number): T[] {
  if (list.length <= size) return list;

  const start = (rotation * size) % list.length;
  return [...list.slice(start), ...list.slice(0, start)].slice(0, size);
}

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
  /*
   * Held in this process for a few seconds as well as in Redis.
   *
   * Every catalogue read needs the currency before it can do anything else — it
   * is part of the cache key, so it cannot be fetched alongside the listing it
   * keys — which made it a serial round trip to a Redis that is not local, on
   * the front of every product page in the platform. It is also the most
   * immutable value the store has: `settings` refuses to change it once an order
   * has been taken, because prices carry no currency of their own and switching
   * the code would re-label every past total. Seconds of staleness on a field
   * that is frozen for the life of a trading store is not a real risk, and it
   * takes a network hop off the critical path of every request.
   */
  const memo = currencyMemo.get(store.tenantRef);
  if (memo && memo.expiresAt > Date.now()) return memo.currency;

  const currency = await cached(
    tenantKey(store.tenantRef, 'storefront', 'currency'),
    CACHE_TTL.storefrontConfig,
    async () => {
      const [row] = await store.db.select({ currency: storeSettings.currency }).from(storeSettings).limit(1);
      // The control plane's value is the fallback: it is what provisioning wrote
      // into `store_settings` in the first place.
      return row?.currency ?? store.currency;
    },
  );

  currencyMemo.set(store.tenantRef, { currency, expiresAt: Date.now() + CURRENCY_MEMO_MS });
  return currency;
}

const currencyMemo = new Map<string, { currency: string; expiresAt: number }>();
const CURRENCY_MEMO_MS = 5_000;

/**
 * The store's default measure picker — the 1kg/500gm/250gm/100gm list.
 *
 * Read on every listing that contains a product sold by measure, for the same
 * reason the currency is: a product whose own `measure_options` is null defers to
 * this, so it is needed before a card can be described and cannot be fetched
 * alongside the listing that it helps render. Cached the same way and for the
 * same span, and it is a display list rather than a price, so a few seconds of
 * staleness costs a shopper one stale dropdown at worst.
 *
 * Absent is a real answer and is cached as one: a shop that has never touched
 * this gets `DEFAULT_MEASURE_OPTIONS` from `resolveMeasureConfig`, and an empty
 * array here must not be mistaken for a cache miss and re-read per card.
 */
export async function loadMeasureDefaults(store: { tenantRef: string; db: TenantDb }): Promise<MeasureOption[]> {
  const memo = measureMemo.get(store.tenantRef);
  if (memo && memo.expiresAt > Date.now()) return memo.options;

  const options = await cached(
    tenantKey(store.tenantRef, 'storefront', 'measure-defaults'),
    CACHE_TTL.storefrontConfig,
    async () => {
      const [row] = await store.db
        .select({ preferences: storeSettings.preferences })
        .from(storeSettings)
        .limit(1);
      return normaliseMeasureOptions(row?.preferences?.measureOptions ?? []);
    },
  );

  measureMemo.set(store.tenantRef, { options, expiresAt: Date.now() + CURRENCY_MEMO_MS });
  return options;
}

const measureMemo = new Map<string, { options: MeasureOption[]; expiresAt: number }>();

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

/**
 * Every active category, as a flat list. Small enough to walk in memory.
 *
 * Cached, because this is not one read per page — it is the read behind
 * `?category=` on every listing *and* the breadcrumb on every product page, so
 * on a busy store it is one of the most repeated queries in the API and its
 * answer changes only when the owner edits the menu. An admin write drops the
 * key immediately (`invalidateStorefrontOnWrite`), so the TTL is a ceiling
 * rather than the latency of a change.
 */
export async function loadCategoryTree(store: {
  tenantRef: string;
  db: TenantDb;
}): Promise<CategoryNode[]> {
  return cached(
    tenantKey(store.tenantRef, 'storefront', 'category-tree'),
    CACHE_TTL.categoryTree,
    () =>
      store.db
        .select({
          id: categories.id,
          parentId: categories.parentId,
          name: categories.name,
          slug: categories.slug,
        })
        .from(categories)
        .where(eq(categories.isActive, true))
        .orderBy(asc(categories.sortOrder), asc(categories.name)),
  );
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

/**
 * The sale price a shopper can actually get **right now**, or null.
 *
 * `products.sale_price_from` is denormalised from the variants and carries no
 * window, so on its own it advertises a sale that has not started and one that
 * ended last month. The window lives on the variant — `sale_starts_at` /
 * `sale_ends_at` — and `effectiveSale` has always applied it on the product
 * page and at checkout. Everything *else* read the flat column, so a listing
 * card could offer a price the product page then refused; now that the admin
 * panel can set a window, that gap became reachable.
 *
 * `min` over the live ones rather than the cheapest variant's sale price: this
 * is a "from" price, and the lowest sale a shopper can currently get is the
 * honest answer to it. A null bound means "no bound", so a sale with neither
 * behaves exactly as it did before.
 */
export const liveSalePriceSql = sql<string | null>`(
  select min(v.sale_price)
    from ${productVariants} v
   where v.product_id = ${products.id}
     and v.is_active
     and v.sale_price is not null
     and (v.sale_starts_at is null or v.sale_starts_at <= now())
     and (v.sale_ends_at is null or v.sale_ends_at >= now())
)`;

/**
 * Whether any variant is on sale right now — the filter's half of the above.
 *
 * A semi-join rather than a comparison against `liveSalePriceSql`, because
 * `exists` stops at the first matching variant and can be answered straight from
 * `product_variants_product_idx`, while the aggregate has to read them all. It
 * is asked over every candidate row in the catalogue, not just the page.
 */
export const liveSaleExistsSql = sql`exists (
  select 1
    from ${productVariants} v
   where v.product_id = ${products.id}
     and v.is_active
     and v.sale_price is not null
     and v.sale_price < v.price
     and (v.sale_starts_at is null or v.sale_starts_at <= now())
     and (v.sale_ends_at is null or v.sale_ends_at >= now())
)`;

/** What a customer pays, as SQL — the live sale price when there is one. */
const effectivePriceSql = sql<string>`coalesce(${liveSalePriceSql}, ${products.priceFrom}, 0)`;

/**
 * True when stock is not allowed to refuse the sale, or there is some available.
 *
 * Three clauses, and only the last is about a count. `track_inventory` off is
 * the owner's decision that this line always sells — made to order, digital,
 * restocked faster than the panel is opened. No `inventory_levels` rows at all
 * is a shop that has never opened the inventory screens, and reading that
 * absence as "zero available" would hide the entire catalogue behind an Out of
 * Stock badge. Absent records are not the same as none, and neither is a
 * deliberate refusal to count.
 *
 * `stockBandFor` and the mapper below must agree with this exactly, or a product
 * would be returned by the filter and then contradicted by its own badge.
 */
const inStockSql = sql`(
  ${products.trackInventory} = false
  or not exists (
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

  if (exclude !== 'inStock' && filters.inStock) conditions.push(inStockSql);

  // "On sale" means on sale *now*. Reading the denormalised column instead
  // would list a product whose window has closed and then show it at full price.
  if (filters.sale) conditions.push(liveSaleExistsSql);

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
  trackInventory: boolean;
  defaultVariantId: string | null;
  minOrderQuantity: number;
  maxOrderQuantity: number | null;
  sellBy: 'unit' | 'measure';
  measureUnit: string | null;
  pricingMeasure: number | null;
  pricingLabel: string | null;
  minMeasure: number | null;
  measureOptions: { label: string; measure: number }[] | null;
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
  /*
   * The live sale, not the flat column — every listing, card and search result
   * reads this, and a price shown beside a product must be the one it sells for.
   */
  salePriceFrom: liveSalePriceSql,
  ratingAverage: products.ratingAverage,
  ratingCount: products.ratingCount,
  isNewArrival: products.isNewArrival,
  soldCount: products.soldCount,
  /** Not shown anywhere; it is what decides whether the stock badge counts. */
  trackInventory: products.trackInventory,
  /*
   * The variant a card adds to the basket.
   *
   * A basket line is a *variant*, never a product — that is what carries the
   * price and the stock a checkout reserves — so a card with an Add button had
   * no way to answer what it was adding without fetching the product first. A
   * `simple` product owns exactly one variant, so for the products this
   * actually serves the answer is already decided; a `variable` one sends the
   * default it opens on, and the card asks for the rest only when a shopper
   * opens the picker.
   *
   * A correlated subquery rather than a join: a join to the default variant
   * would multiply the row set of every listing query that reads these columns,
   * and the index on `(product_id)` makes this a probe per row.
   */
  defaultVariantId: sql<string | null>`(
    select v.id from product_variants v
     where v.product_id = ${products.id} and v.is_active = true
     order by v.is_default desc, v.sort_order asc
     limit 1
  )`,
  /*
   * Quantity bounds, so a one-click add obeys the same limits the product page
   * does. `min` is what the button adds — a product sold in threes must not
   * reach the basket as one — and `max` is what caps the line once it is there.
   */
  minOrderQuantity: products.minOrderQuantity,
  maxOrderQuantity: products.maxOrderQuantity,
  /*
   * How a quantity is read on this product — a count, or an amount weighed out.
   *
   * On the card rather than behind a second request, because the whole point of
   * the picker is that a shopper fills a basket from the listing: fetching the
   * measure list per card would be a request per product on a page of forty.
   */
  sellBy: products.sellBy,
  measureUnit: products.measureUnit,
  pricingMeasure: products.pricingMeasure,
  pricingLabel: products.pricingLabel,
  minMeasure: products.minMeasure,
  measureOptions: products.measureOptions,
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
  measureDefaults: MeasureOption[] = [],
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

    // Untracked reads as available, whether that is the owner's choice or simply
    // a shop that has never recorded a level. See `inStockSql` — the two must
    // agree or a product would be listed by the filter and then contradicted by
    // its own badge.
    const tracked = row.trackInventory && (stock?.trackedRows ?? 0) > 0;
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
      defaultVariantId: row.defaultVariantId,
      minOrderQuantity: row.minOrderQuantity,
      maxOrderQuantity: row.maxOrderQuantity,
      measure: resolveMeasureConfig(row, measureDefaults),
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
/** The rating thresholds offered as facets, highest first. */
const RATING_STEPS = [4, 3, 2] as const;

export async function buildFacets(db: TenantDb, filters: ListingFilters): Promise<FilterGroup[]> {
  const [brandRows, priceRow, ratingRow, stockRow, attributeRows] = await Promise.all([
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

    /*
     * One row of running totals rather than a query per threshold: "3 and up"
     * includes everything "4 and up" does, so the counts are cumulative and a
     * single pass answers all of them.
     */
    db
      .select({
        four: sql<number>`count(*) filter (where ${products.ratingAverage} >= 4)::int`,
        three: sql<number>`count(*) filter (where ${products.ratingAverage} >= 3)::int`,
        two: sql<number>`count(*) filter (where ${products.ratingAverage} >= 2)::int`,
        /*
         * Counted with the rating filter lifted, like the options themselves.
         * Comparing against a total that still had the filter applied made every
         * threshold equal the total the moment one was ticked, so the group
         * deleted itself and left no way to untick it from the sidebar.
         */
        total: sql<number>`count(*)::int`,
      })
      .from(products)
      .where(and(...listingConditions(filters, 'rating'))),

    db
      .select({
        inStock: sql<number>`count(*) filter (where ${inStockSql})::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(products)
      .where(and(...listingConditions(filters, 'inStock'))),

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

  /*
   * Rating and availability were filterable long before they were offerable: the
   * query has honoured `?rating=` and `?inStock=` from the start, `exclude`
   * counts them, and the storefront already draws stars for a `rating` group —
   * but nothing ever published the groups, so no shopper could reach either
   * filter. These two blocks are the missing half.
   */
  const ratingTotal = ratingRow[0]?.total ?? 0;
  const ratingCounts: Record<number, number> = {
    4: ratingRow[0]?.four ?? 0,
    3: ratingRow[0]?.three ?? 0,
    2: ratingRow[0]?.two ?? 0,
  };
  /*
   * A threshold every product already meets is dropped, by the same rule the
   * brand and attribute groups follow: on a catalogue where nothing scores below
   * three, "3 & up" and "2 & up" both read as the whole shop and only "4 & up"
   * is a choice.
   */
  const ratingOptions = RATING_STEPS.filter(
    (step) => (ratingCounts[step] ?? 0) > 0 && (ratingCounts[step] ?? 0) < ratingTotal,
  ).map((step) => ({
    value: String(step),
    label: `${step} & up`,
    count: ratingCounts[step] ?? 0,
  }));
  if (ratingOptions.length > 0) {
    groups.push({ key: 'rating', label: 'Rating', type: 'rating', options: ratingOptions });
  }

  const inStockCount = stockRow[0]?.inStock ?? 0;
  // Offered only when it would actually hide something — on a fully stocked shop
  // "In stock (31 of 31)" is a control that cannot change the result. Both sides
  // are counted with the availability filter lifted, for the reason above.
  if (inStockCount > 0 && inStockCount < (stockRow[0]?.total ?? 0)) {
    groups.push({
      key: 'inStock',
      label: 'Availability',
      type: 'checkbox',
      options: [{ value: 'true', label: 'In stock', count: inStockCount }],
    });
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

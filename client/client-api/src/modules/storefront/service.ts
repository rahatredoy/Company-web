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

  measureMemo.set(store.tenantRef, { options, expiresAt: Date.now() + MEASURE_MEMO_MS });
  return options;
}

const measureMemo = new Map<string, { options: MeasureOption[]; expiresAt: number }>();
/** The same span `lib/store-currency.ts` holds the currency for, and for the same reason. */
const MEASURE_MEMO_MS = 5_000;

// ------------------------------------------------------------------ money ----

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
  /**
   * The scope the page itself is in — everything under `?category=`.
   *
   * Kept apart from `subCategoryIds` rather than merged into one list, because
   * the sidebar's Category group has to be counted as if its **own** filter were
   * not applied (`exclude: 'sub'`) while the page's own scope stays on. A single
   * merged list cannot have half of itself lifted, and a facet counted with the
   * whole thing lifted would offer departments this page is not showing.
   */
  categoryIds?: string[];
  /** The categories ticked in the sidebar (`?sub=`), each as a whole subtree. */
  subCategoryIds?: string[];
  brandSlugs?: string[];
  minPrice?: number;
  maxPrice?: number;
  /**
   * The price buckets ticked in the sidebar. Unioned, never intersected — two
   * ticked bands mean "either", exactly as two ticked brands do.
   */
  priceBands?: PriceBand[];
  rating?: number;
  inStock?: boolean;
  sale?: boolean;
  /** The offer badges ticked in the sidebar (`?offer=`). Unioned, as above. */
  offers?: OfferKey[];
  /** attribute slug → attribute value slugs. */
  attributes?: Record<string, string[]>;
}

/**
 * The lowest sale price across a product's active variants, or null.
 *
 * Read from the variants rather than `products.sale_price_from`, so a variant
 * that has been switched off cannot advertise a price nobody can buy.
 */
export const liveSalePriceSql = sql<string | null>`(
  select min(v.sale_price)
    from ${productVariants} v
   where v.product_id = ${products.id}
     and v.is_active
     and v.sale_price is not null
)`;

/**
 * Whether any active variant is on sale — the filter's half of the above.
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
)`;

/** What a customer pays, as SQL — the sale price when there is one. */
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

// ----------------------------------------------------------------- offers ----

/**
 * How much off counts as "Discounted" rather than as a price that moved.
 *
 * The three discount offers are one ladder, not three mechanisms — any live
 * sale, a real cut, and the deep end — so each is a strict subset of the one
 * above it. That is what makes Clearance a narrowing of On Sale rather than a
 * second, competing claim about the same product.
 */
const DISCOUNTED_MIN_PERCENT = 10;

/** And where the deep end starts. */
const CLEARANCE_MIN_PERCENT = 40;

/** A rating high enough to be a recommendation rather than an absence of one. */
const TOP_RATED_MIN_AVERAGE = '4.5';

/**
 * How far back "Trending" looks.
 *
 * It is measured in **orders**, not views: `products.view_count` and
 * `product_daily_metrics` are both declared and neither is written by anything
 * in this API, so a filter built on either would return an empty list for ever
 * and read as a broken shop rather than as an unwired counter. What people
 * actually bought this month is a fact the order pipeline keeps current on its
 * own.
 */
const TRENDING_DAYS = 30;

/** Some active variant is on sale, at least `percent` below its list price. */
function saleAtLeast(percent: number): SQL {
  const ceiling = ((100 - percent) / 100).toFixed(4);

  return sql`exists (
    select 1
      from ${productVariants} v
     where v.product_id = ${products.id}
       and v.is_active
       and v.sale_price is not null
       and v.price > 0
       and v.sale_price <= v.price * ${ceiling}::numeric
  )`;
}

/** The offer badges a shopper may filter by. This order is the drawing order. */
export const OFFER_KEYS = [
  'on_sale',
  'discounted',
  'flash_deal',
  'clearance',
  'coupon',
  'best_seller',
  'trending',
  'top_rated',
] as const;

export type OfferKey = (typeof OFFER_KEYS)[number];

/**
 * What each badge is actually made of.
 *
 * **Every one is a fact some other part of the platform already acts on** — a
 * campaign the homepage is counting down, a coupon checkout would really
 * accept, the flash the card already prints — rather than a label an owner ticks on a form. A filter that
 * promises a deal the till does not honour is worse than no filter at all.
 *
 * That is also why "Coupon Available" reads a discount's product rules: the
 * discount engine enforces them at the till, so a code for one category is an
 * offer on that category's products and on nothing else.
 */
const OFFERS: { key: OfferKey; label: string; condition: SQL }[] = [
  { key: 'on_sale', label: 'On Sale', condition: liveSaleExistsSql },
  { key: 'discounted', label: 'Discounted', condition: saleAtLeast(DISCOUNTED_MIN_PERCENT) },
  {
    /*
     * A running `flash_sales` campaign — the same rows the homepage's countdown
     * reads, so the filter and the block cannot disagree about what is in it.
     * Membership rather than depth: a flash deal is a deal that ends, and the
     * ending is what is being filtered for.
     */
    key: 'flash_deal',
    label: 'Flash Deal',
    condition: sql`exists (
      select 1
        from flash_sale_products fsp
        join flash_sales fs on fs.id = fsp.flash_sale_id
       where fsp.product_id = ${products.id}
         and fs.is_active
         and fs.starts_at <= now()
         and fs.ends_at > now()
    )`,
  },
  { key: 'clearance', label: 'Clearance', condition: saleAtLeast(CLEARANCE_MIN_PERCENT) },
  {
    /*
     * A public code this product could actually be bought with today: live, not
     * used up, carrying a minimum spend the product's own price already clears —
     * a "spend 5000, save 10%" code is not an offer on a 300-taka bar of soap —
     * and applying to this product at all, read from the same product rules the
     * discount engine enforces at the till. A voucher is somebody's own and a
     * named-customer code is nobody else's, so neither makes a product "coupon
     * available" to the shopper reading the filter.
     */
    key: 'coupon',
    label: 'Coupon Available',
    condition: sql`exists (
      select 1
        from discounts d
       where d.archived_at is null
         and d.status = 'active'
         and d.code is not null
         and d.kind in ('coupon', 'bank_offer', 'payment_offer')
         and coalesce(d.customer_rules->>'segment', 'all') <> 'selected'
         and (d.starts_at is null or d.starts_at <= now())
         and (d.ends_at is null or d.ends_at > now())
         and (d.usage_limit is null or d.used_count < d.usage_limit)
         and (d.min_order_amount is null or d.min_order_amount <= ${effectivePriceSql})
         and (
           coalesce(d.product_rules->>'appliesTo', 'all') = 'all'
           or coalesce(d.product_rules->'productIds', '[]'::jsonb) ? ${products.id}::text
           or coalesce(d.product_rules->'brandIds', '[]'::jsonb) ? ${products.brandId}::text
           or exists (
             select 1
               from categories c0
               left join categories c1 on c1.id = c0.parent_id
               left join categories c2 on c2.id = c1.parent_id
              where c0.id = ${products.categoryId}
                and coalesce(d.product_rules->'categoryIds', '[]'::jsonb)
                    ?| array_remove(array[c0.id::text, c1.id::text, c2.id::text], null)
           )
           or exists (
             select 1 from collection_products cp
              where cp.product_id = ${products.id}
                and coalesce(d.product_rules->'collectionIds', '[]'::jsonb) ? cp.collection_id::text
           )
           or exists (
             select 1 from product_variants pv
              where pv.product_id = ${products.id}
                and pv.is_active
                and coalesce(d.product_rules->'variantIds', '[]'::jsonb) ? pv.id::text
           )
         )
         and not coalesce(d.product_rules->'excludeProductIds', '[]'::jsonb) ? ${products.id}::text
         and not (${products.brandId} is not null and coalesce(d.product_rules->'excludeBrandIds', '[]'::jsonb) ? ${products.brandId}::text)
         and not exists (
           select 1
             from categories c0
             left join categories c1 on c1.id = c0.parent_id
             left join categories c2 on c2.id = c1.parent_id
            where c0.id = ${products.categoryId}
              and coalesce(d.product_rules->'excludeCategoryIds', '[]'::jsonb)
                  ?| array_remove(array[c0.id::text, c1.id::text, c2.id::text], null)
         )
         and not (coalesce((d.product_rules->>'excludeSaleItems')::boolean, false) and ${liveSaleExistsSql})
    )`,
  },
  {
    // The threshold the card's own "Best seller" flash uses, so a filtered grid
    // is the badged products and nothing else.
    key: 'best_seller',
    label: 'Best Seller',
    condition: sql`${products.soldCount} >= ${BEST_SELLER_MIN_SOLD}`,
  },
  {
    key: 'trending',
    label: 'Trending',
    condition: sql`exists (
      select 1
        from order_items oi
        join orders o on o.id = oi.order_id
       where oi.product_id = ${products.id}
         and coalesce(o.placed_at, o.created_at) >= now() - make_interval(days => ${TRENDING_DAYS})
         and o.status not in ('cancelled', 'returned', 'refunded', 'failed')
    )`,
  },
  {
    // A rating with nobody behind it is a default, not a recommendation, so the
    // count has to be there as well as the average.
    key: 'top_rated',
    label: 'Top Rated',
    condition: sql`(${products.ratingAverage} >= ${TOP_RATED_MIN_AVERAGE} and ${products.ratingCount} > 0)`,
  },
];

const OFFER_BY_KEY = new Map(OFFERS.map((offer) => [offer.key, offer]));

/** Whitelists `?offer=` against the badges above; anything invented is dropped. */
export function parseOfferKeys(values: string[] | undefined): OfferKey[] | undefined {
  if (!values?.length) return undefined;

  const keys = [...new Set(values.map((value) => value.trim().toLowerCase()))].filter(
    (value): value is OfferKey => OFFER_BY_KEY.has(value as OfferKey),
  );

  return keys.length > 0 ? keys : undefined;
}

// ------------------------------------------------------------ price bands ----

export interface PriceBand {
  min: number;
  /** Null is the open-ended top band. */
  max: number | null;
}

/**
 * The price buckets the sidebar offers, in the store's own currency.
 *
 * A ladder rather than two number boxes, because a shopper filtering by price is
 * choosing a bracket rather than measuring one — the boxes asked them to type
 * two numbers to discover the shop sells nothing between them. The bounds are
 * half-open (`[min, max)`), so nothing can be counted in two bands at once, and
 * a band the shop has nothing in is dropped rather than drawn as a dead end.
 *
 * Fixed thresholds rather than quantiles of the current result set: a bracket
 * that moves as the listing is filtered is one a shopper cannot learn, and
 * "Under 200" meaning one thing in Electronics and another in Grocery is how a
 * filter stops being trusted.
 */
const PRICE_BANDS: PriceBand[] = [
  { min: 0, max: 200 },
  { min: 200, max: 500 },
  { min: 500, max: 1000 },
  { min: 1000, max: null },
];

/** The wire form of a band: `200-500`, and `1000-` for the open-ended one. */
export function priceBandValue(band: PriceBand): string {
  return `${band.min}-${band.max ?? ''}`;
}

/**
 * Whitelists `?price=` against the published bands.
 *
 * Only a band the facet actually offered is accepted — a hand-edited
 * `?price=137-999` is dropped rather than honoured, so the panel and the query
 * can never mean two different things. `minPrice`/`maxPrice` stay accepted
 * alongside it for a caller that wants an arbitrary range, so the endpoint's
 * contract did not narrow.
 */
export function parsePriceBands(values: string[] | undefined): PriceBand[] | undefined {
  if (!values?.length) return undefined;

  const wanted = new Set(values.map((value) => value.trim()));
  const bands = PRICE_BANDS.filter((band) => wanted.has(priceBandValue(band)));

  return bands.length > 0 ? bands : undefined;
}

function priceBandCondition(band: PriceBand): SQL {
  const floor = sql`${effectivePriceSql} >= ${band.min}`;
  return band.max === null ? floor : sql`(${floor} and ${effectivePriceSql} < ${band.max})`;
}

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
    // The name only. It also matched the short description until that column
    // was dropped; the full description is not searched, because an ilike over
    // unindexed long text is a scan of the whole catalogue on every keystroke.
    conditions.push(sql`${products.name} ilike ${`%${filters.q}%`}`);
  }

  /*
   * The page's scope and the sidebar's Category ticks are two filters, not one.
   *
   * Ticked categories are always a subtree of the page's own, so applying them
   * alone is the same set as applying both — and it is what lets `exclude: 'sub'`
   * count the group as though nothing in it were ticked, while a category page
   * still counts only its own department.
   */
  if (exclude !== 'sub' && filters.subCategoryIds?.length) {
    conditions.push(inArray(products.categoryId, filters.subCategoryIds));
  } else if (filters.categoryIds?.length) {
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
    // Bands are alternatives to each other, so they are one OR'd condition
    // rather than one condition each — pushed separately they would intersect
    // to nothing the moment a second box was ticked.
    if (filters.priceBands?.length) {
      conditions.push(or(...filters.priceBands.map(priceBandCondition))!);
    }
  }

  if (exclude !== 'rating' && filters.rating !== undefined) {
    conditions.push(gte(products.ratingAverage, String(filters.rating)));
  }

  if (exclude !== 'inStock' && filters.inStock) conditions.push(inStockSql);

  // Asked of the active variants rather than the denormalised column.
  if (filters.sale) conditions.push(liveSaleExistsSql);

  // Ticked offers are alternatives, like the price bands: "On Sale or Free
  // Delivery" is what a row of offer boxes reads as, and intersecting them would
  // empty the grid on the second click.
  if (exclude !== 'offer' && filters.offers?.length) {
    const offers = filters.offers
      .map((key) => OFFER_BY_KEY.get(key)?.condition)
      .filter((condition): condition is SQL => condition !== undefined);
    if (offers.length > 0) conditions.push(or(...offers)!);
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
 * What a category facet needs that the filters alone cannot say.
 *
 * The tree is already loaded and cached by the route that resolves `?category=`,
 * so it is handed down rather than read again here.
 */
export interface FacetContext {
  /** Every active category, so a subtree's products can roll up to its head. */
  tree: CategoryNode[];
  /**
   * Whose children the Category group lists: the category this page is scoped
   * to, or null on `/shop` and `/search`, where the departments are the answer.
   */
  parentId: string | null;
}

/** A band's fallback label. The storefront redraws it in the store's currency. */
function priceBandLabel(band: PriceBand): string {
  if (band.max === null) return `${band.min}+`;
  return band.min === 0 ? `Under ${band.max}` : `${band.min} – ${band.max}`;
}

/**
 * The filter panel, counted against this result set.
 *
 * Every group is counted with its own filter lifted (`exclude`), so the options a
 * shopper has *not* chosen still show how many products they would return. An
 * option that would return nothing is dropped, and so is one that would return
 * everything: a filter that cannot change the result is a control that does
 * nothing, and a count equal to the total is exactly that.
 *
 * The push order is the order the sidebar draws in, and it runs from the question
 * a shopper answers first to the one they answer last — which aisle, which offer,
 * what price, whose, in stock, and only then the descriptive attributes that vary
 * from shop to shop.
 */
export async function buildFacets(
  db: TenantDb,
  filters: ListingFilters,
  context: FacetContext,
): Promise<FilterGroup[]> {
  const [categoryRows, offerRow, priceRow, brandRows, stockRow, attributeRows] = await Promise.all([
    /*
     * Counted per category and rolled up in memory.
     *
     * A department's count is its whole subtree — "Electronics (36)" has to
     * include the phones filed two levels beneath it — and asking that as one
     * query per candidate is six scans of the catalogue for one panel. One
     * grouped scan plus a walk of a tree that is already cached is the same
     * answer for the cheaper half of the cost.
     */
    db
      .select({ categoryId: products.categoryId, tally: sql<number>`count(*)::int` })
      .from(products)
      .where(and(...listingConditions(filters, 'sub')))
      .groupBy(products.categoryId),

    /*
     * Nine filtered aggregates in one pass rather than nine queries.
     *
     * Each offer is a correlated `exists`, so what costs is the scan rather than
     * the predicates, and running them together reads the catalogue once for the
     * whole group. It is also why the panel is cached apart from the page
     * (`CACHE_TTL.facets`): every page of one filter combination reuses this.
     */
    db
      .select(
        OFFERS.reduce<Record<string, SQL<number>>>((select, offer) => {
          select[offer.key] = sql<number>`count(*) filter (where ${offer.condition})::int`;
          return select;
        }, {}),
      )
      .from(products)
      .where(and(...listingConditions(filters, 'offer'))),

    /*
     * Keyed `b0…b3` rather than by the band's own `0-200` form, because these
     * keys become SQL aliases and a digit-led one has to be quoted to survive.
     * The order is `PRICE_BANDS`', which is what the index below reads back.
     */
    db
      .select(
        PRICE_BANDS.reduce<Record<string, SQL<number>>>(
          (select, band, index) => {
            select[`b${index}`] = sql<number>`count(*) filter (where ${priceBandCondition(band)})::int`;
            return select;
          },
          { total: sql<number>`count(*)::int` },
        ),
      )
      .from(products)
      .where(and(...listingConditions(filters, 'price'))),

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
        attributeValues.sortOrder,
      )
      .orderBy(asc(attributes.sortOrder), asc(attributeValues.sortOrder)),
  ]);

  const groups: FilterGroup[] = [];

  /*
   * Which aisle — the first question a shopper asks, and the one this panel had
   * no answer to at all. On a category page it lists that department's own
   * children; on `/shop` and `/search` it lists the departments themselves.
   *
   * A single option is kept here, unlike everywhere else: a lone child category
   * is a genuine narrowing, because a department can hold products of its own
   * that are filed under no child at all.
   */
  const categoryCounts = new Map<string, number>();
  for (const row of categoryRows) {
    if (row.categoryId) categoryCounts.set(row.categoryId, Number(row.tally));
  }

  const categoryOptions = context.tree
    .filter((node) => (node.parentId ?? null) === context.parentId)
    .map((node) => ({
      value: node.slug,
      label: node.name,
      count: descendantIds(context.tree, node.id).reduce(
        (total, id) => total + (categoryCounts.get(id) ?? 0),
        0,
      ),
    }))
    .filter((option) => option.count > 0);

  if (categoryOptions.length > 0) {
    groups.push({ key: 'sub', label: 'Category', type: 'checkbox', options: categoryOptions });
  }

  /*
   * The offers, in the order `OFFERS` declares them — fixed rather than sorted
   * by count, so the row a shopper learned last week is where they left it.
   *
   * Only an offer that matches **nothing** is dropped, and that is a deliberate
   * departure from the rule the availability group follows. Availability is one
   * box, so one that cannot narrow is pure noise; here the count beside a name
   * is itself the answer — "Top Rated 241" out of 241 tells a shopper something
   * about the whole shop, which is worth more than the click it saves them.
   * Zero is the one count that says nothing and costs something: it is a box
   * whose only outcome is an empty grid.
   */
  const offerOptions = OFFERS.map((offer) => ({
    value: offer.key,
    label: offer.label,
    count: Number(offerRow[0]?.[offer.key] ?? 0),
  })).filter((option) => option.count > 0);

  if (offerOptions.length > 0) {
    groups.push({ key: 'offer', label: 'Offers', type: 'checkbox', options: offerOptions });
  }

  /*
   * The price ladder. `min`/`max` travel beside the label because the storefront
   * is what formats money — it holds the store's currency and the visitor's
   * locale, and "৳" beats "BDT" by half the width of a card. The label is the
   * bare-number fallback for any other reader of this contract.
   */
  const priceTotal = Number(priceRow[0]?.total ?? 0);
  const priceOptions = PRICE_BANDS.map((band, index) => ({
    value: priceBandValue(band),
    label: priceBandLabel(band),
    count: Number(priceRow[0]?.[`b${index}`] ?? 0),
    min: band.min,
    max: band.max,
  })).filter((option) => option.count > 0 && option.count < priceTotal);

  if (priceOptions.length > 1) {
    groups.push({ key: 'price', label: 'Price', type: 'price', options: priceOptions });
  }

  if (brandRows.length > 1) {
    groups.push({
      key: 'brand',
      label: 'Brand',
      type: 'checkbox',
      options: brandRows.map((row) => ({ value: row.value, label: row.label, count: row.count })),
    });
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
    /*
     * Colour is chosen on the product, not in the sidebar.
     *
     * A swatch attribute is what picks a *variant* — the thing that carries the
     * price and the stock a checkout reserves — so the place to choose one is
     * the product page's selector, where the shopper can see which combinations
     * exist and which are in stock. In the panel it was a list of names beside
     * counts, taking the height of six departments to answer a question nobody
     * asks before they have chosen the product.
     */
    if (row.inputType === 'color') continue;

    const group = byAttribute.get(row.attributeSlug) ?? {
      key: row.attributeSlug,
      label: row.attributeName,
      type: 'checkbox' as const,
      options: [],
    };
    group.options.push({ value: row.value, label: row.label, count: row.count });
    byAttribute.set(row.attributeSlug, group);
  }

  for (const group of byAttribute.values()) {
    if (group.options.length > 1) groups.push(group);
  }

  return groups;
}


// ------------------------------------------------------------------ misc ----

/** Reflects the filters back so the UI can render "clear" chips it did not parse. */
export function appliedFiltersOf(
  filters: ListingFilters,
  categorySlug?: string,
  subSlugs?: string[],
): Record<string, string[]> {
  const applied: Record<string, string[]> = {};

  if (categorySlug) applied.category = [categorySlug];
  // Reflected as the slugs that were asked for, not as the subtree they resolved
  // to: the panel ticks a box by the value it sent, and ids mean nothing to it.
  if (subSlugs?.length) applied.sub = subSlugs;
  if (filters.brandSlugs?.length) applied.brand = filters.brandSlugs;
  if (filters.rating !== undefined) applied.rating = [String(filters.rating)];
  if (filters.inStock) applied.inStock = ['true'];
  if (filters.sale) applied.sale = ['true'];
  if (filters.offers?.length) applied.offer = [...filters.offers];
  if (filters.priceBands?.length) applied.price = filters.priceBands.map(priceBandValue);
  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    applied.minPrice = [String(filters.minPrice ?? 0)];
    applied.maxPrice = [String(filters.maxPrice ?? 0)];
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

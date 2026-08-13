import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  attributeValues,
  attributes,
  brands,
  productBundles,
  productMedia,
  productSpecifications,
  productVariantValues,
  productVariants,
  products,
} from '../../db/schema/index';
import { CACHE_TTL, cached, tenantKey } from '../../lib/cache';
import { notFound } from '../../lib/errors';
import { buildMeta, ok, parseParams, parseQuery } from '../../lib/http';
import { storeOf, type StoreContext } from '../../plugins/tenant';
import {
  appliedFiltersOf,
  breadcrumbFor,
  buildFacets,
  decorateSummaries,
  descendantIds,
  discountPercent,
  effectiveSale,
  listingConditions,
  loadCategoryTree,
  loadStoreCurrency,
  orderFor,
  productBaseColumns,
  PUBLISHED_PRODUCT,
  stockBandFor,
  type ListingFilters,
} from './service';
import type {
  ProductDetail,
  ProductListResult,
  ProductVariantView,
  SortValue,
  VariantOption,
} from './types';

const SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'best_selling', 'rating'] as const;

/** Repeated params arrive either as `?brand=a&brand=b` or as `?brand=a,b`. */
const listValue = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    const parts = (Array.isArray(value) ? value : value.split(',')).map((v) => v.trim()).filter(Boolean);
    return parts.length > 0 ? parts : undefined;
  });

/**
 * A flag that is only ever switched on.
 *
 * Not `z.coerce.boolean()`: that is `Boolean(value)`, and the string `"false"`
 * is truthy — so `?inStock=false` would have applied an in-stock filter. The
 * storefront omits these params rather than sending false, so anything that is
 * not exactly `"true"` means no filter at all.
 */
const flagValue = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => ((Array.isArray(value) ? value[0] : value) === 'true' ? true : undefined));

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
  sort: z.enum(SORTS).default('relevance'),
  q: z.string().trim().max(120).optional(),
  category: z.string().trim().max(220).optional(),
  /** Child categories ticked from the chips; the page stays on the parent. */
  sub: listValue,
  brand: listValue,
  ids: listValue,
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  rating: z.coerce.number().min(0).max(5).optional(),
  inStock: flagValue,
  sale: flagValue,
  /** Accepted so it forms part of the cache key; see `loadStoreCurrency`. */
  currency: z.string().trim().max(3).optional(),
});

const slugParamSchema = z.object({ slug: z.string().trim().min(1).max(220) });
const idParamSchema = z.object({ id: z.string().uuid('Invalid identifier.') });

const relatedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).default(12),
  currency: z.string().trim().max(3).optional(),
});

/**
 * Facets travel as `attr.colour=black`, so the API can gain a filterable
 * attribute without this schema — or the storefront — learning its name.
 */
function attributeFiltersOf(query: unknown): Record<string, string[]> {
  const source = (query ?? {}) as Record<string, unknown>;
  const parsed: Record<string, string[]> = {};

  for (const [key, raw] of Object.entries(source)) {
    if (!key.startsWith('attr.')) continue;
    const slug = key.slice(5).trim().toLowerCase();
    if (!slug || slug.length > 90) continue;

    const values = (Array.isArray(raw) ? raw : String(raw ?? '').split(','))
      .map((v) => String(v).trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 24);

    if (values.length > 0) parsed[slug] = values;
  }

  return parsed;
}

/** Resolves `?category=` and `?sub=` into the set of category ids to match. */
async function resolveCategoryIds(
  store: StoreContext,
  categorySlug: string | undefined,
  subSlugs: string[] | undefined,
): Promise<string[] | undefined> {
  if (!categorySlug && !subSlugs?.length) return undefined;

  const tree = await loadCategoryTree(store.db);
  const bySlug = new Map(tree.map((node) => [node.slug, node]));

  // Chips narrow the page rather than replacing it, so when any are ticked they
  // are the filter — the parent's other children are what the shopper excluded.
  if (subSlugs?.length) {
    const ids = subSlugs.flatMap((slug) => {
      const node = bySlug.get(slug);
      return node ? descendantIds(tree, node.id) : [];
    });
    if (ids.length > 0) return [...new Set(ids)];
  }

  if (!categorySlug) return undefined;

  const root = bySlug.get(categorySlug);
  // An unknown or inactive category must return nothing rather than everything —
  // silently dropping the filter would answer a 404 page with the whole shop.
  return root ? descendantIds(tree, root.id) : ['00000000-0000-0000-0000-000000000000'];
}

export default async function storefrontProductRoutes(app: FastifyInstance) {
  /**
   * The one listing behind `/shop`, `/category`, `/brand`, `/search` and the
   * homepage's product blocks.
   *
   * Two response shapes on one path, because the storefront asks two different
   * questions of it. `?ids=` resolves a homepage section's named products and
   * wants just those, in no particular order; everything else is a browsable
   * page and needs its facets and its pagination alongside the items.
   */
  app.get('/products', async (request, reply) => {
    const store = storeOf(request);
    const query = parseQuery(listQuerySchema, request.query);
    const currency = await loadStoreCurrency(store);

    if (query.ids?.length) {
      const ids = query.ids.filter((id) => z.string().uuid().safeParse(id).success).slice(0, 60);
      if (ids.length === 0) return ok(reply, []);

      const rows = await store.db
        .select(productBaseColumns)
        .from(products)
        .leftJoin(brands, eq(brands.id, products.brandId))
        .where(and(PUBLISHED_PRODUCT, inArray(products.id, ids)));

      const summaries = await decorateSummaries(store.db, rows, currency);
      // Returned in the order the section named them, not the order the database
      // happened to scan — the owner's arrangement is the point of the section.
      const byId = new Map(summaries.map((item) => [item.id, item]));
      return ok(reply, ids.map((id) => byId.get(id)).filter((item) => item !== undefined));
    }

    const categoryIds = await resolveCategoryIds(store, query.category, query.sub);

    const filters: ListingFilters = {
      q: query.q,
      categoryIds,
      brandSlugs: query.brand,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      rating: query.rating,
      inStock: query.inStock,
      sale: query.sale,
      attributes: attributeFiltersOf(request.query),
    };

    const conditions = listingConditions(filters);
    const offset = (query.page - 1) * query.pageSize;

    const [rows, tally, facets] = await Promise.all([
      store.db
        .select(productBaseColumns)
        .from(products)
        .leftJoin(brands, eq(brands.id, products.brandId))
        .where(and(...conditions))
        .orderBy(...orderFor(query.sort as SortValue))
        .limit(query.pageSize)
        .offset(offset),
      store.db.select({ total: count() }).from(products).where(and(...conditions)),
      buildFacets(store.db, filters),
    ]);

    const total = Number(tally[0]?.total ?? 0);

    return ok(reply, {
      items: await decorateSummaries(store.db, rows, currency),
      meta: buildMeta(query.page, query.pageSize, total),
      filters: facets,
      appliedFilters: appliedFiltersOf(filters, query.category),
    } satisfies ProductListResult);
  });

  /** One product, with everything its page renders. */
  app.get('/products/:slug', async (request, reply) => {
    const store = storeOf(request);
    const { slug } = parseParams(slugParamSchema, request.params);
    const currency = await loadStoreCurrency(store);

    const detail = await cached(
      tenantKey(store.tenantRef, 'storefront', 'product', slug),
      CACHE_TTL.productDetail,
      () => loadProductDetail(store, slug, currency),
    );

    // A draft or deleted product is a missing product here. The panel can see it;
    // this surface must not confirm that it exists.
    if (!detail) throw notFound('This product does not exist.');

    return ok(reply, detail);
  });

  /**
   * More from the same category, then the same brand.
   *
   * Deliberately not "customers also bought": that needs order history this
   * slice does not read, and a related rail built from the catalogue is honest
   * about what it is rather than pretending to a personalisation it lacks.
   */
  app.get('/products/:id/related', async (request, reply) => {
    const store = storeOf(request);
    const { id } = parseParams(idParamSchema, request.params);
    const { limit } = parseQuery(relatedQuerySchema, request.query);
    const currency = await loadStoreCurrency(store);

    const [source] = await store.db
      .select({ categoryId: products.categoryId, brandId: products.brandId })
      .from(products)
      .where(and(PUBLISHED_PRODUCT, eq(products.id, id)))
      .limit(1);

    if (!source) return ok(reply, []);

    const rows = await store.db
      .select(productBaseColumns)
      .from(products)
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(
        and(
          PUBLISHED_PRODUCT,
          sql`${products.id} <> ${id}`,
          sql`(${products.categoryId} = ${source.categoryId ?? null} or ${products.brandId} = ${source.brandId ?? null})`,
        ),
      )
      .orderBy(
        // Same category first — a different brand in the same aisle is a closer
        // match than the same brand in a different one.
        sql`case when ${products.categoryId} = ${source.categoryId ?? null} then 0 else 1 end`,
        desc(products.soldCount),
      )
      .limit(limit);

    return ok(reply, await decorateSummaries(store.db, rows, currency));
  });

  /** The curated "frequently bought together" pairing, if the owner made one. */
  app.get('/products/:id/bundle', async (request, reply) => {
    const store = storeOf(request);
    const { id } = parseParams(idParamSchema, request.params);
    const currency = await loadStoreCurrency(store);

    const rows = await store.db
      .select(productBaseColumns)
      .from(productBundles)
      .innerJoin(products, eq(products.id, productBundles.relatedProductId))
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(and(eq(productBundles.productId, id), PUBLISHED_PRODUCT))
      .orderBy(asc(productBundles.sortOrder));

    // No pairing is the normal case, not an error — `allowNotFound` on the
    // storefront side turns this into "render no bundle block".
    if (rows.length === 0) throw notFound('No bundle for this product.');

    const [anchorRow] = await store.db
      .select(productBaseColumns)
      .from(products)
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(and(PUBLISHED_PRODUCT, eq(products.id, id)))
      .limit(1);

    if (!anchorRow) throw notFound('No bundle for this product.');

    const items = await decorateSummaries(store.db, [anchorRow, ...rows], currency);

    // Summed on the server so the figure the customer is shown and the figure
    // the cart would charge come from one calculation, not two.
    const bundlePrice = items
      .reduce((total, item) => total + Number(item.salePrice ?? item.price), 0)
      .toFixed(2);

    return ok(reply, { items, bundlePrice, currency });
  });
}

/**
 * The whole product page in one function.
 *
 * Kept out of the handler because it is also what the cache wrapper calls, and
 * because the shape it returns is the contract — a reader comparing it against
 * `ProductDetail` should not have to skip over routing to do it.
 */
async function loadProductDetail(
  store: StoreContext,
  slug: string,
  currency: string,
): Promise<ProductDetail | null> {
  const [row] = await store.db
    .select({
      ...productBaseColumns,
      shortDescription: products.shortDescription,
      description: products.description,
      categoryId: products.categoryId,
      isReturnable: products.isReturnable,
      minOrderQuantity: products.minOrderQuantity,
      maxOrderQuantity: products.maxOrderQuantity,
      seoTitle: products.seoTitle,
      seoDescription: products.seoDescription,
    })
    .from(products)
    .leftJoin(brands, eq(brands.id, products.brandId))
    .where(and(PUBLISHED_PRODUCT, eq(products.slug, slug)))
    .limit(1);

  if (!row) return null;

  const [summary] = await decorateSummaries(store.db, [row], currency);
  if (!summary) return null;

  const [mediaRows, specRows, variantRows, selectionRows, optionRows, tree] = await Promise.all([
    store.db
      .select({
        url: productMedia.url,
        altText: productMedia.altText,
        width: productMedia.width,
        height: productMedia.height,
        type: productMedia.type,
      })
      .from(productMedia)
      .where(eq(productMedia.productId, row.id))
      .orderBy(asc(productMedia.sortOrder)),

    store.db
      .select({
        groupName: productSpecifications.groupName,
        label: productSpecifications.label,
        value: productSpecifications.value,
        isKeySpec: productSpecifications.isKeySpec,
      })
      .from(productSpecifications)
      .where(eq(productSpecifications.productId, row.id))
      .orderBy(asc(productSpecifications.sortOrder)),

    store.db
      .select({
        id: productVariants.id,
        sku: productVariants.sku,
        title: productVariants.title,
        price: productVariants.price,
        salePrice: productVariants.salePrice,
        saleStartsAt: productVariants.saleStartsAt,
        saleEndsAt: productVariants.saleEndsAt,
        imageUrl: productVariants.imageUrl,
        isDefault: productVariants.isDefault,
        available: sql<number>`(
          select coalesce(sum(il.available), 0)::int from inventory_levels il
          where il.variant_id = ${productVariants.id}
        )`,
        trackedRows: sql<number>`(
          select count(*)::int from inventory_levels il
          where il.variant_id = ${productVariants.id}
        )`,
        threshold: sql<number>`(
          select coalesce(min(il.low_stock_threshold), 5)::int from inventory_levels il
          where il.variant_id = ${productVariants.id}
        )`,
      })
      .from(productVariants)
      .where(and(eq(productVariants.productId, row.id), eq(productVariants.isActive, true)))
      .orderBy(asc(productVariants.sortOrder)),

    store.db
      .select({
        variantId: productVariantValues.variantId,
        attributeId: productVariantValues.attributeId,
        attributeValueId: productVariantValues.attributeValueId,
      })
      .from(productVariantValues)
      .innerJoin(productVariants, eq(productVariants.id, productVariantValues.variantId))
      .where(eq(productVariants.productId, row.id)),

    store.db
      .select({
        attributeId: attributes.id,
        attributeName: attributes.name,
        attributeSlug: attributes.slug,
        inputType: attributes.inputType,
        valueId: attributeValues.id,
        value: attributeValues.value,
        valueSlug: attributeValues.slug,
        colorHex: attributeValues.colorHex,
      })
      .from(productVariantValues)
      .innerJoin(productVariants, eq(productVariants.id, productVariantValues.variantId))
      .innerJoin(attributeValues, eq(attributeValues.id, productVariantValues.attributeValueId))
      .innerJoin(attributes, eq(attributes.id, attributeValues.attributeId))
      .where(eq(productVariants.productId, row.id))
      .orderBy(asc(attributes.sortOrder), asc(attributeValues.sortOrder)),

    loadCategoryTree(store.db),
  ]);

  const selectionByVariant = new Map<string, Record<string, string>>();
  for (const link of selectionRows) {
    const selection = selectionByVariant.get(link.variantId) ?? {};
    selection[link.attributeId] = link.attributeValueId;
    selectionByVariant.set(link.variantId, selection);
  }

  const options = new Map<string, VariantOption>();
  for (const opt of optionRows) {
    const group = options.get(opt.attributeId) ?? {
      attributeId: opt.attributeId,
      attributeName: opt.attributeName,
      slug: opt.attributeSlug,
      inputType: opt.inputType,
      values: [],
    };
    if (!group.values.some((v) => v.id === opt.valueId)) {
      group.values.push({ id: opt.valueId, value: opt.value, slug: opt.valueSlug, colorHex: opt.colorHex });
    }
    options.set(opt.attributeId, group);
  }

  const variants: ProductVariantView[] = variantRows.map((variant) => {
    const sale = effectiveSale(variant.salePrice, variant.saleStartsAt, variant.saleEndsAt);
    const band = stockBandFor(Number(variant.trackedRows) > 0, Number(variant.available), Number(variant.threshold));

    return {
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      price: variant.price,
      salePrice: sale,
      discountPercent: discountPercent(variant.price, sale),
      imageUrl: variant.imageUrl,
      selection: selectionByVariant.get(variant.id) ?? {},
      ...band,
    };
  });

  const category = row.categoryId
    ? (tree.find((node) => node.id === row.categoryId) ?? null)
    : null;

  return {
    ...summary,
    shortDescription: row.shortDescription,
    description: row.description,
    images: mediaRows
      .filter((media) => media.type === 'image')
      .map((media) => ({ url: media.url, altText: media.altText, width: media.width, height: media.height })),
    videoUrl: mediaRows.find((media) => media.type === 'video')?.url ?? null,
    category: category ? { id: category.id, name: category.name, slug: category.slug } : null,
    breadcrumb: row.categoryId ? breadcrumbFor(tree, row.categoryId) : [],
    options: [...options.values()],
    variants,
    defaultVariantId:
      variantRows.find((variant) => variant.isDefault)?.id ?? variantRows[0]?.id ?? null,
    specifications: specRows,
    // Store-wide policy copy; the storefront renders the store's own pages for
    // the detail, so these stay null until a per-product override exists.
    shippingInfo: null,
    returnInfo: null,
    isReturnable: row.isReturnable,
    minOrderQuantity: row.minOrderQuantity,
    maxOrderQuantity: row.maxOrderQuantity,
    seo: { title: row.seoTitle, description: row.seoDescription },
  } satisfies ProductDetail;
}

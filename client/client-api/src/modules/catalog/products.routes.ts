import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  attributeValues,
  brands,
  categories,
  productAttributeValues,
  productBundles,
  productMedia,
  productSpecifications,
  productVariantValues,
  productVariants,
  products,
} from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { ERROR_CODES, conflict, notFound, unprocessable } from '../../lib/errors';
import { buildMeta, noContent, ok, paginated, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { storeOf } from '../../plugins/tenant';
import { settleSlug } from './service';
import type { TenantTx } from '../../db/tenant-manager';

/**
 * Keeps the product's picture in `product_media` alongside the variant's own
 * `image_url`.
 *
 * The form has one image field, and the two consumers of it read from different
 * places: a variant's `image_url` is what a basket line shows, while every
 * storefront listing, the product page gallery and the checkout summary read
 * `product_media`. Nothing wrote that table, so an owner could upload a picture,
 * see it in the panel, and have it appear nowhere on their shop.
 *
 * The row is replaced rather than appended to, because this field *is* the
 * product's one picture — a gallery would need its own endpoint, and until there
 * is one, editing the image must not leave the previous one behind as the
 * primary. Only rows this path owns are touched (`variant_id` set to the default
 * variant), so a real gallery added later is left alone.
 */
async function setPrimaryMedia(
  tx: TenantTx,
  productId: string,
  variantId: string,
  url: string | null | undefined,
  altText: string,
): Promise<void> {
  if (url === undefined) return;

  await tx
    .delete(productMedia)
    .where(and(eq(productMedia.productId, productId), eq(productMedia.variantId, variantId)));

  if (!url) return;

  await tx.insert(productMedia).values({
    productId,
    variantId,
    type: 'image',
    url,
    altText: altText.slice(0, 200),
    isPrimary: true,
    sortOrder: 0,
  });
}

const SORTABLE = {
  createdAt: products.createdAt,
  name: products.name,
  price: products.priceFrom,
  sold: products.soldCount,
} as const;

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.enum(['all', 'draft', 'active', 'inactive']).default('all'),
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  sort: z.enum(['createdAt', 'name', 'price', 'sold']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

/** Money arrives as a string so a float never rounds someone's price for them. */
const money = z
  .union([z.string().trim(), z.number()])
  .transform((value) => (typeof value === 'number' ? value.toFixed(2) : value))
  .refine((value) => /^\d{1,10}(\.\d{1,2})?$/.test(value), 'Use an amount like 19.99.');

const writeSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the product a name.').max(200),
    slug: z.string().trim().max(220).optional(),
    status: z.enum(['draft', 'active', 'inactive']).default('draft'),
    categoryId: z.string().uuid('Choose a category that exists.').nullable().default(null),
    brandId: z.string().uuid('Choose a brand that exists.').nullable().default(null),
    shortDescription: z.string().trim().max(500).nullable().default(null),
    description: z.string().trim().max(50_000).nullable().default(null),

    /** The one variant a `simple` product is sold as. */
    sku: z.string().trim().min(1, 'Give the product a SKU.').max(64),
    price: money,
    salePrice: money.nullable().default(null),
    costPrice: money.nullable().default(null),
    barcode: z.string().trim().max(64).nullable().default(null),
    weightGrams: z.coerce.number().int().min(0).max(10_000_000).nullable().default(null),
    imageUrl: z.string().trim().url('Use a full web address.').max(2000).nullable().default(null),

    isFeatured: z.boolean().default(false),
    isNewArrival: z.boolean().default(false),
    isReturnable: z.boolean().default(true),
    minOrderQuantity: z.coerce.number().int().min(1).max(10_000).default(1),
    maxOrderQuantity: z.coerce.number().int().min(1).max(10_000).nullable().default(null),
    seoTitle: z.string().trim().max(160).nullable().default(null),
    seoDescription: z.string().trim().max(300).nullable().default(null),
  })
  .refine((value) => value.salePrice === null || Number(value.salePrice) < Number(value.price), {
    message: 'The sale price has to be below the normal price.',
    path: ['salePrice'],
  })
  .refine(
    (value) => value.maxOrderQuantity === null || value.maxOrderQuantity >= value.minOrderQuantity,
    { message: 'The maximum cannot be below the minimum.', path: ['maxOrderQuantity'] },
  );

/**
 * `.partial()` is not available on a refined object, so the patch shape is
 * declared separately and the two cross-field rules are re-applied against the
 * merged row in the handler — where the values that were *not* sent are known.
 */
const patchSchema = z.object({
  name: z.string().trim().min(1, 'Give the product a name.').max(200).optional(),
  slug: z.string().trim().max(220).optional(),
  status: z.enum(['draft', 'active', 'inactive']).optional(),
  categoryId: z.string().uuid('Choose a category that exists.').nullable().optional(),
  brandId: z.string().uuid('Choose a brand that exists.').nullable().optional(),
  shortDescription: z.string().trim().max(500).nullable().optional(),
  description: z.string().trim().max(50_000).nullable().optional(),

  sku: z.string().trim().min(1, 'Give the product a SKU.').max(64).optional(),
  price: money.optional(),
  salePrice: money.nullable().optional(),
  costPrice: money.nullable().optional(),
  barcode: z.string().trim().max(64).nullable().optional(),
  weightGrams: z.coerce.number().int().min(0).max(10_000_000).nullable().optional(),
  imageUrl: z.string().trim().url('Use a full web address.').max(2000).nullable().optional(),

  isFeatured: z.boolean().optional(),
  isNewArrival: z.boolean().optional(),
  isReturnable: z.boolean().optional(),
  minOrderQuantity: z.coerce.number().int().min(1).max(10_000).optional(),
  maxOrderQuantity: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
  seoTitle: z.string().trim().max(160).nullable().optional(),
  seoDescription: z.string().trim().max(300).nullable().optional(),
});

/** The gallery, as a whole list. Twelve is a product page, not an album. */
const mediaListSchema = z.object({
  media: z
    .array(
      z.object({
        url: z.string().trim().url('Use a full web address.').max(2000),
        altText: z.string().trim().max(200).nullable().default(null),
        sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
      }),
    )
    .max(12)
    .default([]),
});

const specificationListSchema = z.object({
  specifications: z
    .array(
      z.object({
        groupName: z.string().trim().max(80).nullable().default(null),
        label: z.string().trim().min(1, 'Name the specification.').max(120),
        value: z.string().trim().min(1, 'Give it a value.').max(400),
        isKeySpec: z.boolean().default(false),
        sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
      }),
    )
    .max(100)
    .default([]),
});

const attributeValueListSchema = z.object({
  attributeValueIds: z.array(z.string().uuid('Choose values that exist.')).max(100).default([]),
});

/** Four is a bundle a shopper reads; more is a category listing. */
const bundleSchema = z.object({
  relatedProductIds: z.array(z.string().uuid('Choose products that exist.')).max(4).default([]),
});

/**
 * The full variant list for one product.
 *
 * `selection` maps an attribute to the value this variant is — `{ Size: M,
 * Colour: Black }` — and is what the storefront's option controls are built
 * from. A variant with no selection is legal and is what a simple product has.
 */
const variantListSchema = z.object({
  variants: z
    .array(
      z.object({
        sku: z.string().trim().min(1, 'Give the variant a SKU.').max(64),
        title: z.string().trim().max(200).nullable().default(null),
        price: money,
        salePrice: money.nullable().default(null),
        costPrice: money.nullable().default(null),
        barcode: z.string().trim().max(64).nullable().default(null),
        weightGrams: z.coerce.number().int().min(0).max(10_000_000).nullable().default(null),
        imageUrl: z.string().trim().url('Use a full web address.').max(2000).nullable().default(null),
        isDefault: z.boolean().default(false),
        isActive: z.boolean().default(true),
        sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
        /** attributeValueId list; each value's attribute is resolved server-side. */
        attributeValueIds: z.array(z.string().uuid()).max(6).default([]),
      }),
    )
    .min(1, 'A product needs at least one variant.')
    .max(100),
});

type StoreDb = ReturnType<typeof storeOf>['db'];

/** A category or brand named by a request must belong to *this* store, and exist. */
async function assertReferencesExist(
  db: StoreDb,
  refs: { categoryId?: string | null; brandId?: string | null },
): Promise<void> {
  if (refs.categoryId) {
    const found = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, refs.categoryId))
      .limit(1);
    if (!found.length) {
      throw unprocessable('That category no longer exists.', ERROR_CODES.VALIDATION_FAILED, {
        categoryId: ['Choose a category that exists.'],
      });
    }
  }

  if (refs.brandId) {
    const found = await db.select({ id: brands.id }).from(brands).where(eq(brands.id, refs.brandId)).limit(1);
    if (!found.length) {
      throw unprocessable('That brand no longer exists.', ERROR_CODES.VALIDATION_FAILED, {
        brandId: ['Choose a brand that exists.'],
      });
    }
  }
}

/** SKUs are unique store-wide — the index says so, and a duplicate is a mis-scan. */
async function assertSkuFree(db: StoreDb, sku: string, exceptVariantId?: string): Promise<void> {
  const clash = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(
      exceptVariantId
        ? and(eq(productVariants.sku, sku), ne(productVariants.id, exceptVariantId))
        : eq(productVariants.sku, sku),
    )
    .limit(1);

  if (clash.length) {
    throw conflict('Another product already uses that SKU.', ERROR_CODES.SKU_TAKEN);
  }
}

/**
 * Products.
 *
 * A product is what a customer browses; a **variant** is what they buy and what
 * stock is counted against. The schema is explicit that a `simple` product still
 * gets exactly one variant so that pricing, stock and order lines never need two
 * code paths — so this module writes that variant alongside the product and
 * keeps the two in step. A product without one would be unbuyable, and would
 * only reveal itself as broken once the cart existed.
 *
 * `price_from` on the product is denormalised from that variant so a listing
 * query stays one table.
 */
export default async function productRoutes(app: FastifyInstance) {
  app.get(
    '/products',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('products.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const query = parseQuery(listQuerySchema, request.query);

      const filters = [
        query.search
          ? or(ilike(products.name, `%${query.search}%`), ilike(products.slug, `%${query.search}%`))
          : undefined,
        query.status === 'all' ? undefined : eq(products.status, query.status),
        query.categoryId ? eq(products.categoryId, query.categoryId) : undefined,
        query.brandId ? eq(products.brandId, query.brandId) : undefined,
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;
      const column = SORTABLE[query.sort];

      const rows = await store.db
        .select({
          id: products.id,
          name: products.name,
          slug: products.slug,
          status: products.status,
          type: products.type,
          priceFrom: products.priceFrom,
          salePriceFrom: products.salePriceFrom,
          isFeatured: products.isFeatured,
          soldCount: products.soldCount,
          createdAt: products.createdAt,
          categoryId: products.categoryId,
          categoryName: categories.name,
          brandId: products.brandId,
          brandName: brands.name,
          sku: sql<string | null>`(
            select v.sku from ${productVariants} v
             where v.product_id = ${products.id}
             order by v.is_default desc, v.sort_order asc
             limit 1
          )`,
        })
        .from(products)
        .leftJoin(categories, eq(categories.id, products.categoryId))
        .leftJoin(brands, eq(brands.id, products.brandId))
        .where(where)
        .orderBy(query.order === 'asc' ? asc(column) : desc(column))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      const [totals] = await store.db.select({ total: count() }).from(products).where(where);

      return paginated(reply, rows, buildMeta(query.page, query.pageSize, totals?.total ?? 0));
    },
  );

  app.get(
    '/products/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('products.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const product = (await store.db.select().from(products).where(eq(products.id, id)).limit(1))[0];
      if (!product) throw notFound('That product no longer exists.');

      const variants = await store.db
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, id))
        .orderBy(desc(productVariants.isDefault), asc(productVariants.sortOrder));

      return ok(reply, { ...product, variants, defaultVariant: variants[0] ?? null });
    },
  );

  // ------------------------------------------------- product sub-resources ----
  //
  // Three tables the storefront has always read and nothing could write: the
  // gallery, the specification rows behind the product tab, and the descriptive
  // attribute values a listing filters on. Each is edited as a whole list rather
  // than row by row — that is how the panel presents them, it makes a re-save
  // idempotent, and it means a reorder is one request instead of N.

  app.put(
    '/products/:id/media',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('products.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(mediaListSchema, request.body);

      const product = (
        await store.db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(eq(products.id, id))
          .limit(1)
      )[0];
      if (!product) throw notFound('That product no longer exists.');

      await store.db.transaction(async (tx) => {
        /*
         * Only the gallery — rows with no `variant_id`.
         *
         * The single image on the product form is kept by `setPrimaryMedia` as a
         * row tied to the default variant, and it is the one flagged primary.
         * Clearing everything here would delete it on every gallery save and
         * leave the listings, which read `product_media`, with no picture.
         */
        await tx
          .delete(productMedia)
          .where(and(eq(productMedia.productId, id), isNull(productMedia.variantId)));

        if (body.media.length > 0) {
          await tx.insert(productMedia).values(
            body.media.map((item, index) => ({
              productId: id,
              variantId: null,
              type: 'image' as const,
              url: item.url,
              altText: item.altText ?? product.name,
              isPrimary: false,
              sortOrder: item.sortOrder ?? index * 10,
            })),
          );
        }
      });

      await audit(store.db, request, {
        action: 'product.media',
        module: 'catalog',
        entity: 'product',
        entityId: id,
        entityLabel: product.name,
        newValues: { galleryImages: body.media.length },
      });

      return ok(reply, { productId: id, count: body.media.length });
    },
  );

  app.put(
    '/products/:id/specifications',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('products.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(specificationListSchema, request.body);

      const product = (
        await store.db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(eq(products.id, id))
          .limit(1)
      )[0];
      if (!product) throw notFound('That product no longer exists.');

      await store.db.transaction(async (tx) => {
        await tx.delete(productSpecifications).where(eq(productSpecifications.productId, id));

        if (body.specifications.length > 0) {
          await tx.insert(productSpecifications).values(
            body.specifications.map((row, index) => ({
              productId: id,
              groupName: row.groupName,
              label: row.label,
              value: row.value,
              isKeySpec: row.isKeySpec,
              sortOrder: row.sortOrder ?? index * 10,
            })),
          );
        }
      });

      await audit(store.db, request, {
        action: 'product.specifications',
        module: 'catalog',
        entity: 'product',
        entityId: id,
        entityLabel: product.name,
        newValues: { rows: body.specifications.length },
      });

      return ok(reply, { productId: id, count: body.specifications.length });
    },
  );

  app.put(
    '/products/:id/attributes',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('products.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(attributeValueListSchema, request.body);

      const product = (
        await store.db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(eq(products.id, id))
          .limit(1)
      )[0];
      if (!product) throw notFound('That product no longer exists.');

      /*
       * Every value is resolved to its own attribute here rather than trusted
       * from the body: the pair is a composite key, and a caller that sent a
       * mismatched `attributeId` would file a colour under Size and make the
       * facet counts disagree with the products they list.
       */
      const rows =
        body.attributeValueIds.length > 0
          ? await store.db
              .select({ id: attributeValues.id, attributeId: attributeValues.attributeId })
              .from(attributeValues)
              .where(inArray(attributeValues.id, body.attributeValueIds))
          : [];

      if (rows.length !== body.attributeValueIds.length) {
        throw unprocessable('One of those attribute values does not exist.', ERROR_CODES.VALIDATION_FAILED, {
          attributeValueIds: ['Choose values that exist.'],
        });
      }

      await store.db.transaction(async (tx) => {
        await tx.delete(productAttributeValues).where(eq(productAttributeValues.productId, id));

        if (rows.length > 0) {
          await tx.insert(productAttributeValues).values(
            rows.map((row) => ({
              productId: id,
              attributeId: row.attributeId,
              attributeValueId: row.id,
            })),
          );
        }
      });

      await audit(store.db, request, {
        action: 'product.attributes',
        module: 'catalog',
        entity: 'product',
        entityId: id,
        entityLabel: product.name,
        newValues: { values: rows.length },
      });

      return ok(reply, { productId: id, count: rows.length });
    },
  );

  /**
   * The "frequently bought together" pairing.
   *
   * Curated rather than mined from order history: with a handful of orders the
   * mined version recommends whatever the last customer happened to buy, and
   * the storefront prices the bundle from these rows, so an owner needs to be
   * able to say what belongs in it.
   */
  app.put(
    '/products/:id/bundle',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('products.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(bundleSchema, request.body);

      const product = (
        await store.db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(eq(products.id, id))
          .limit(1)
      )[0];
      if (!product) throw notFound('That product no longer exists.');

      if (body.relatedProductIds.includes(id)) {
        throw unprocessable('A product cannot be bundled with itself.', ERROR_CODES.VALIDATION_FAILED, {
          relatedProductIds: ['Choose other products.'],
        });
      }

      const found = body.relatedProductIds.length
        ? await store.db
            .select({ id: products.id })
            .from(products)
            .where(inArray(products.id, body.relatedProductIds))
        : [];
      if (found.length !== body.relatedProductIds.length) {
        throw unprocessable('One of those products does not exist.', ERROR_CODES.VALIDATION_FAILED, {
          relatedProductIds: ['Choose products that exist.'],
        });
      }

      await store.db.transaction(async (tx) => {
        await tx.delete(productBundles).where(eq(productBundles.productId, id));
        if (body.relatedProductIds.length > 0) {
          await tx.insert(productBundles).values(
            body.relatedProductIds.map((relatedProductId, index) => ({
              productId: id,
              relatedProductId,
              sortOrder: index * 10,
            })),
          );
        }
      });

      await audit(store.db, request, {
        action: 'product.bundle',
        module: 'catalog',
        entity: 'product',
        entityId: id,
        entityLabel: product.name,
        newValues: { items: body.relatedProductIds.length },
      });

      return ok(reply, { productId: id, count: body.relatedProductIds.length });
    },
  );

  /**
   * Replaces a product's variants.
   *
   * Matched to what is already there **by SKU**, not wiped and re-inserted.
   * Everything hangs off a variant id by cascade — stock levels, the ledger,
   * baskets, wishlists — so re-inserting a variant that had simply been renamed
   * would silently empty its warehouse. A SKU is the one identifier that
   * survives an edit, which is why the unique index is on it.
   *
   * A variant that disappears from the list *is* deleted, and its stock goes
   * with it. Order history does not: `order_items.variant_id` is ON DELETE SET
   * NULL and the line keeps its own name and price snapshot.
   */
  app.put(
    '/products/:id/variants',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('products.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(variantListSchema, request.body);

      const product = (
        await store.db
          .select({ id: products.id, name: products.name })
          .from(products)
          .where(eq(products.id, id))
          .limit(1)
      )[0];
      if (!product) throw notFound('That product no longer exists.');

      const skus = body.variants.map((variant) => variant.sku);
      if (new Set(skus).size !== skus.length) {
        throw unprocessable('Two variants share a SKU.', ERROR_CODES.SKU_TAKEN, {
          variants: ['Every variant needs its own SKU.'],
        });
      }

      const existing = await store.db
        .select({ id: productVariants.id, sku: productVariants.sku })
        .from(productVariants)
        .where(eq(productVariants.productId, id));
      const bySku = new Map(existing.map((row) => [row.sku, row.id]));

      // A SKU already used by a *different* product is a mis-scan, not an edit.
      for (const variant of body.variants) {
        if (!bySku.has(variant.sku)) await assertSkuFree(store.db, variant.sku);
      }

      const valueIds = [...new Set(body.variants.flatMap((variant) => variant.attributeValueIds))];
      const valueRows = valueIds.length
        ? await store.db
            .select({ id: attributeValues.id, attributeId: attributeValues.attributeId })
            .from(attributeValues)
            .where(inArray(attributeValues.id, valueIds))
        : [];
      if (valueRows.length !== valueIds.length) {
        throw unprocessable('One of those option values does not exist.', ERROR_CODES.VALIDATION_FAILED, {
          attributeValueIds: ['Choose values that exist.'],
        });
      }
      const attributeOf = new Map(valueRows.map((row) => [row.id, row.attributeId]));

      // Exactly one default, so the product page always has a variant to open on.
      const defaultIndex = Math.max(
        body.variants.findIndex((variant) => variant.isDefault),
        0,
      );

      await store.db.transaction(async (tx) => {
        const keep = new Set<string>();

        for (const [index, variant] of body.variants.entries()) {
          const values = {
            productId: id,
            sku: variant.sku,
            title: variant.title,
            price: variant.price,
            salePrice: variant.salePrice,
            costPrice: variant.costPrice,
            barcode: variant.barcode,
            weightGrams: variant.weightGrams,
            imageUrl: variant.imageUrl,
            isDefault: index === defaultIndex,
            isActive: variant.isActive,
            sortOrder: variant.sortOrder ?? index * 10,
            updatedAt: new Date(),
          };

          const current = bySku.get(variant.sku);
          const variantId = current
            ? (await tx.update(productVariants).set(values).where(eq(productVariants.id, current)).returning({ id: productVariants.id }))[0]!.id
            : (await tx.insert(productVariants).values(values).returning({ id: productVariants.id }))[0]!.id;

          keep.add(variantId);

          await tx.delete(productVariantValues).where(eq(productVariantValues.variantId, variantId));
          if (variant.attributeValueIds.length > 0) {
            await tx.insert(productVariantValues).values(
              variant.attributeValueIds.map((attributeValueId) => ({
                variantId,
                attributeId: attributeOf.get(attributeValueId)!,
                attributeValueId,
              })),
            );
          }
        }

        const dropped = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);
        if (dropped.length > 0) {
          await tx.delete(productVariants).where(inArray(productVariants.id, dropped));
        }

        /*
         * `price_from` is what every listing, card and sort reads, so it has to
         * follow the variants rather than be set once at creation. Cheapest
         * active variant wins — that is what "from £x" means.
         */
        const active = body.variants.filter((variant) => variant.isActive);
        const cheapest = (active.length > 0 ? active : body.variants)
          .map((variant) => ({
            price: Number(variant.price),
            salePrice: variant.salePrice === null ? null : Number(variant.salePrice),
          }))
          .sort((a, b) => (a.salePrice ?? a.price) - (b.salePrice ?? b.price))[0]!;

        await tx
          .update(products)
          .set({
            type: body.variants.length > 1 ? 'variable' : 'simple',
            priceFrom: cheapest.price.toFixed(2),
            salePriceFrom: cheapest.salePrice === null ? null : cheapest.salePrice.toFixed(2),
            updatedAt: new Date(),
          })
          .where(eq(products.id, id));
      });

      await audit(store.db, request, {
        action: 'product.variants',
        module: 'catalog',
        entity: 'product',
        entityId: id,
        entityLabel: product.name,
        newValues: { variants: body.variants.length },
      });

      const saved = await store.db
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, id))
        .orderBy(desc(productVariants.isDefault), asc(productVariants.sortOrder));

      return ok(reply, { productId: id, variants: saved });
    },
  );

  app.post(
    '/products',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('products.create')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(writeSchema, request.body);

      await assertReferencesExist(store.db, body);
      await assertSkuFree(store.db, body.sku);

      const slug = await settleSlug({
        requested: body.slug,
        from: body.name,
        isTaken: async (candidate) =>
          (await store.db.select({ id: products.id }).from(products).where(eq(products.slug, candidate)).limit(1))
            .length > 0,
      });

      // One transaction, because a product whose variant failed to write is not
      // a half-saved product — it is one nobody can buy.
      const created = await store.db.transaction(async (tx) => {
        const [product] = await tx
          .insert(products)
          .values({
            name: body.name,
            slug,
            type: 'simple',
            status: body.status,
            categoryId: body.categoryId,
            brandId: body.brandId,
            shortDescription: body.shortDescription,
            description: body.description,
            priceFrom: body.price,
            salePriceFrom: body.salePrice,
            isFeatured: body.isFeatured,
            isNewArrival: body.isNewArrival,
            isReturnable: body.isReturnable,
            minOrderQuantity: body.minOrderQuantity,
            maxOrderQuantity: body.maxOrderQuantity,
            seoTitle: body.seoTitle,
            seoDescription: body.seoDescription,
            publishedAt: body.status === 'active' ? new Date() : null,
          })
          .returning();

        const [variant] = await tx
          .insert(productVariants)
          .values({
            productId: product!.id,
            sku: body.sku,
            barcode: body.barcode,
            price: body.price,
            salePrice: body.salePrice,
            costPrice: body.costPrice,
            weightGrams: body.weightGrams,
            imageUrl: body.imageUrl,
            isDefault: true,
            isActive: body.status !== 'inactive',
          })
          .returning();

        await setPrimaryMedia(tx, product!.id, variant!.id, body.imageUrl, body.name);

        return { ...product!, variants: [variant!], defaultVariant: variant! };
      });

      await audit(store.db, request, {
        action: 'product.create',
        module: 'catalog',
        entity: 'product',
        entityId: created.id,
        entityLabel: created.name,
        newValues: created,
      });

      return ok(reply, created, 201);
    },
  );

  app.patch(
    '/products/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('products.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(patchSchema, request.body);

      const existing = (await store.db.select().from(products).where(eq(products.id, id)).limit(1))[0];
      if (!existing) throw notFound('That product no longer exists.');

      const variant = (
        await store.db
          .select()
          .from(productVariants)
          .where(eq(productVariants.productId, id))
          .orderBy(desc(productVariants.isDefault), asc(productVariants.sortOrder))
          .limit(1)
      )[0];

      if (!variant) {
        // Only reachable for a row written before this module existed, or by a
        // direct database edit. Saying so beats a null-pointer further down.
        throw unprocessable(
          'This product has no sellable variant. Recreate it, or add one directly.',
          ERROR_CODES.VARIANT_REQUIRED,
        );
      }

      await assertReferencesExist(store.db, body);
      if (body.sku !== undefined) await assertSkuFree(store.db, body.sku, variant.id);

      // The cross-field rules run against the merged row, so sending only a sale
      // price is still checked against the price already stored.
      const price = body.price ?? variant.price;
      const salePrice = body.salePrice === undefined ? variant.salePrice : body.salePrice;
      if (salePrice !== null && Number(salePrice) >= Number(price)) {
        throw unprocessable('The sale price has to be below the normal price.', ERROR_CODES.VALIDATION_FAILED, {
          salePrice: ['The sale price has to be below the normal price.'],
        });
      }

      const minOrderQuantity = body.minOrderQuantity ?? existing.minOrderQuantity;
      const maxOrderQuantity =
        body.maxOrderQuantity === undefined ? existing.maxOrderQuantity : body.maxOrderQuantity;
      if (maxOrderQuantity !== null && maxOrderQuantity < minOrderQuantity) {
        throw unprocessable('The maximum cannot be below the minimum.', ERROR_CODES.VALIDATION_FAILED, {
          maxOrderQuantity: ['The maximum cannot be below the minimum.'],
        });
      }

      const slug =
        body.slug === undefined
          ? existing.slug
          : await settleSlug({
              requested: body.slug,
              from: body.name ?? existing.name,
              isTaken: async (candidate) =>
                (
                  await store.db
                    .select({ id: products.id })
                    .from(products)
                    .where(and(eq(products.slug, candidate), ne(products.id, id)))
                    .limit(1)
                ).length > 0,
            });

      const status = body.status ?? existing.status;

      const updated = await store.db.transaction(async (tx) => {
        const [product] = await tx
          .update(products)
          .set({
            name: body.name ?? existing.name,
            slug,
            status,
            categoryId: body.categoryId === undefined ? existing.categoryId : body.categoryId,
            brandId: body.brandId === undefined ? existing.brandId : body.brandId,
            shortDescription:
              body.shortDescription === undefined ? existing.shortDescription : body.shortDescription,
            description: body.description === undefined ? existing.description : body.description,
            priceFrom: price,
            salePriceFrom: salePrice,
            isFeatured: body.isFeatured ?? existing.isFeatured,
            isNewArrival: body.isNewArrival ?? existing.isNewArrival,
            isReturnable: body.isReturnable ?? existing.isReturnable,
            minOrderQuantity,
            maxOrderQuantity,
            seoTitle: body.seoTitle === undefined ? existing.seoTitle : body.seoTitle,
            seoDescription: body.seoDescription === undefined ? existing.seoDescription : body.seoDescription,
            // First publish is stamped; re-publishing later does not rewrite the
            // date the product originally went live.
            publishedAt: status === 'active' ? (existing.publishedAt ?? new Date()) : existing.publishedAt,
            updatedAt: new Date(),
          })
          .where(eq(products.id, id))
          .returning();

        const [nextVariant] = await tx
          .update(productVariants)
          .set({
            sku: body.sku ?? variant.sku,
            barcode: body.barcode === undefined ? variant.barcode : body.barcode,
            price,
            salePrice,
            costPrice: body.costPrice === undefined ? variant.costPrice : body.costPrice,
            weightGrams: body.weightGrams === undefined ? variant.weightGrams : body.weightGrams,
            imageUrl: body.imageUrl === undefined ? variant.imageUrl : body.imageUrl,
            isActive: status !== 'inactive',
            updatedAt: new Date(),
          })
          .where(eq(productVariants.id, variant.id))
          .returning();

        await setPrimaryMedia(tx, id, variant.id, body.imageUrl, product!.name);

        return { ...product!, variants: [nextVariant!], defaultVariant: nextVariant! };
      });

      await audit(store.db, request, {
        action: 'product.update',
        module: 'catalog',
        entity: 'product',
        entityId: id,
        entityLabel: updated.name,
        oldValues: { ...existing, defaultVariant: variant },
        newValues: updated,
      });

      return ok(reply, updated);
    },
  );

  app.delete(
    '/products/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('products.delete')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const existing = (await store.db.select().from(products).where(eq(products.id, id)).limit(1))[0];
      if (!existing) throw notFound('That product no longer exists.');

      // A product that has been bought is part of someone's order history.
      // Deleting it would leave those lines pointing at nothing, so it is
      // withdrawn from sale instead and the caller is told which happened.
      if (existing.soldCount > 0) {
        const [hidden] = await store.db
          .update(products)
          .set({ status: 'inactive', updatedAt: new Date() })
          .where(eq(products.id, id))
          .returning();

        await store.db
          .update(productVariants)
          .set({ isActive: false, updatedAt: new Date() })
          .where(eq(productVariants.productId, id));

        await audit(store.db, request, {
          action: 'product.archive',
          module: 'catalog',
          entity: 'product',
          entityId: id,
          entityLabel: existing.name,
          oldValues: existing,
          newValues: hidden,
        });

        return ok(reply, {
          deleted: false,
          product: hidden,
          message: 'This product has been ordered before, so it was hidden from the store instead of deleted.',
        });
      }

      // Variants, media and attribute rows all cascade from the product.
      await store.db.delete(products).where(eq(products.id, id));

      await audit(store.db, request, {
        action: 'product.delete',
        module: 'catalog',
        entity: 'product',
        entityId: id,
        entityLabel: existing.name,
        oldValues: existing,
      });

      return noContent(reply);
    },
  );
}

import { randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  attributeValues,
  brands,
  categories,
  inventoryLevels,
  inventoryTransactions,
  productAttributeValues,
  productBundles,
  productMedia,
  productSpecifications,
  productVariantValues,
  productVariants,
  products,
  reviews,
  warehouses,
} from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { ERROR_CODES, conflict, notFound, unprocessable } from '../../lib/errors';
import { translateFor } from '../../lib/i18n/index';
import {
  cursorField,
  listed,
  noContent,
  ok,
  parseBody,
  parseParams,
  parseQuery,
  uuidParamSchema,
} from '../../lib/http';
import { keyset } from '../../lib/keyset';
import {
  MAX_MEASURE_OPTIONS,
  measureOptionSchema,
  measureUnitSchema,
  normaliseMeasureOptions,
} from '../../lib/measure';
import { storeOf } from '../../plugins/tenant';
import { settleSlug } from './service';
import type { TenantTx } from '../../db/tenant-manager';
import { httpsUrl } from '../../lib/secure-url';

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

/*
 * `price_from` is nullable and the rest are not, so it is coalesced here rather
 * than at the call site: the keyset compares `sort_column < cursor_value`, and
 * `anything < NULL` is NULL — a nullable sort column would drop every unpriced
 * product from every batch after the first and never say so.
 */
const SORTABLE = {
  createdAt: products.createdAt,
  name: products.name,
  price: sql<string>`coalesce(${products.priceFrom}, 0)`,
  sold: products.soldCount,
  updatedAt: products.updatedAt,
} as const;

/** What each sort column reads as on a row, for the cursor. */
const CURSOR_VALUE: Record<keyof typeof SORTABLE | 'stock', (row: ProductListRow) => string | number | Date> = {
  createdAt: (row) => row.createdAt,
  name: (row) => row.name,
  price: (row) => row.priceFrom ?? '0',
  sold: (row) => row.soldCount,
  updatedAt: (row) => row.updatedAt,
  stock: (row) => row.stock,
};

interface ProductListRow {
  id: string;
  name: string;
  priceFrom: string | null;
  soldCount: number;
  stock: number;
  createdAt: Date;
  updatedAt: Date;
}

const listQuerySchema = z.object({
  ...cursorField,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.enum(['all', 'draft', 'active', 'inactive']).default('all'),
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  /**
   * The same four buckets the inventory screen uses, so a product counted as low
   * here is the one that screen offers to restock. `untracked` is its own answer
   * rather than being folded into `out`: nothing has ever been recorded for it,
   * which is a different problem from having sold the last one.
   */
  stock: z.enum(['all', 'in_stock', 'low', 'out', 'untracked']).default('all'),
  featured: z.enum(['all', 'yes', 'no']).default('all'),
  /** `pending` is the dashboard's "reviews waiting" link: products with a review to approve. */
  reviews: z.enum(['all', 'pending']).default('all'),
  sort: z.enum(['createdAt', 'name', 'price', 'sold', 'stock', 'updatedAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

/** Money arrives as a string so a float never rounds someone's price for them. */
const money = z
  .union([z.string().trim(), z.number()])
  .transform((value) => (typeof value === 'number' ? value.toFixed(2) : value))
  .refine((value) => /^\d{1,10}(\.\d{1,2})?$/.test(value), 'Use an amount like 19.99.');

/**
 * Every picture and clip on a product.
 *
 * `httpsUrl` rather than `z.string().url()`, which is not a scheme check: it
 * accepts `javascript:` and `data:text/html` as readily as `https:`, and these
 * values are rendered by the storefront as an `img src` and a video source. See
 * `lib/secure-url.ts`.
 */
const url = httpsUrl();

/**
 * One line of the create form's variant table.
 *
 * `stockQuantity` is an **opening balance**, not a stock movement: it is only
 * accepted here, where the variant is being brought into existence and there is
 * nothing to race against. Every change after this goes through
 * `/inventory/adjust`, which is a signed delta applied as a single conditional
 * `UPDATE`, because two people counting the same shelf must not overwrite each
 * other.
 */
const newVariantSchema = z.object({
  sku: z.string().trim().min(1, 'Give the variant a SKU.').max(64),
  title: z.string().trim().max(200).nullable().default(null),
  price: money,
  salePrice: money.nullable().default(null),
  costPrice: money.nullable().default(null),
  barcode: z.string().trim().max(64).nullable().default(null),
  weightGrams: z.coerce.number().int().min(0).max(10_000_000).nullable().default(null),
  imageUrl: url.nullable().default(null),
  stockQuantity: z.coerce.number().int().min(0).max(1_000_000).default(0),
  /** Which option values this variant *is*. The attribute of each is resolved server-side. */
  attributeValueIds: z.array(z.string().uuid('Choose values that exist.')).max(6).default([]),
});

/**
 * How a product is sold — one at a time, or weighed out.
 *
 * Every field is optional and the mode defaults to `unit`, so a caller that
 * knows nothing about this describes exactly the product it always did. The
 * cross-field rules are in `measureIssues` below, applied by both the create and
 * the patch handler against the merged row — the patch shape cannot refine
 * itself, because the fields it did not send are only known once the existing
 * row is read.
 */
const measureFields = {
  sellBy: z.enum(['unit', 'measure']).optional(),
  measureUnit: measureUnitSchema.nullable().optional(),
  pricingMeasure: z.coerce.number().int().min(1).max(10_000_000).nullable().optional(),
  pricingLabel: z.string().trim().max(24).nullable().optional(),
  minMeasure: z.coerce.number().int().min(1).max(10_000_000).nullable().optional(),
  /** Null defers to the store's default list; an empty array does too. */
  measureOptions: z.array(measureOptionSchema).max(MAX_MEASURE_OPTIONS).nullable().optional(),
};

/**
 * The rules a measure product has to satisfy, checked against the whole row.
 *
 * Reported per field so the panel can put each message under the control that
 * caused it, which is what `parseBody` does for a Zod issue and what these have
 * to match to be rendered the same way.
 */
function measureIssues(row: {
  sellBy: 'unit' | 'measure';
  measureUnit: string | null;
  pricingMeasure: number | null;
  minMeasure: number | null;
  measureOptions: { label: string; measure: number }[] | null;
}): { path: string; message: string }[] {
  if (row.sellBy !== 'measure') return [];

  const issues: { path: string; message: string }[] = [];

  if (!row.measureUnit) {
    issues.push({ path: 'measureUnit', message: 'Choose what this product is measured in.' });
  }
  if (!row.pricingMeasure || row.pricingMeasure < 1) {
    issues.push({ path: 'pricingMeasure', message: 'Say how much the price buys — 1000 for a per-kilo price.' });
  }

  const options = row.measureOptions ?? [];

  /*
   * A minimum above every option the shopper can pick is a product nobody can
   * buy, and the panel is the only place that can catch it: each option on its
   * own is legal, and the refusal only appears at checkout when a basket is
   * already full. The largest option has to be able to reach the floor by
   * itself — anything smaller can be bought in multiples.
   */
  if (row.minMeasure && options.length > 0) {
    const largest = Math.max(...options.map((option) => option.measure));
    if (largest < row.minMeasure) {
      issues.push({
        path: 'minMeasure',
        message: 'The minimum is larger than every size on offer, so nothing could be ordered.',
      });
    }
  }

  return issues;
}

const writeSchema = z
  .object({
    name: z.string().trim().min(1, 'Give the product a name.').max(200),
    slug: z.string().trim().max(220).optional(),
    status: z.enum(['draft', 'active', 'inactive']).default('draft'),
    categoryId: z.string().uuid('Choose a category that exists.').nullable().default(null),
    brandId: z.string().uuid('Choose a brand that exists.').nullable().default(null),
    description: z.string().trim().max(50_000).nullable().default(null),

    /**
     * The one variant a `simple` product is sold as.
     *
     * `price` is optional in the shape and required in the refinement below,
     * because a product created *with* a variant list has no single price of its
     * own. `sku` is optional outright: the panel keeps it under Advanced options,
     * and a product created without one is given one (`generateSku`) — a shop
     * that does not scan barcodes should not have to invent a code to list a
     * product. An empty string is read the same as an absent one.
     */
    sku: z.string().trim().max(64).optional(),
    price: money.optional(),
    salePrice: money.nullable().default(null),
    costPrice: money.nullable().default(null),
    barcode: z.string().trim().max(64).nullable().default(null),
    weightGrams: z.coerce.number().int().min(0).max(10_000_000).nullable().default(null),
    imageUrl: url.nullable().default(null),

    /** Opening balance for the single variant. Ignored when `variants` is sent. */
    stockQuantity: z.coerce.number().int().min(0).max(1_000_000).default(0),
    lowStockThreshold: z.coerce.number().int().min(0).max(100_000).default(5),
    trackInventory: z.boolean().default(true),

    videoUrl: url.nullable().default(null),
    /** The gallery, beside the main picture. Twelve is a product page, not an album. */
    galleryImages: z.array(url).max(12).default([]),

    /** When present, this *is* the product's variant list and `sku`/`price` are not read. */
    variants: z.array(newVariantSchema).max(50).optional(),

    isFeatured: z.boolean().default(false),
    isNewArrival: z.boolean().default(false),
    isReturnable: z.boolean().default(true),
    minOrderQuantity: z.coerce.number().int().min(1).max(10_000).default(1),
    maxOrderQuantity: z.coerce.number().int().min(1).max(10_000).nullable().default(null),
    seoTitle: z.string().trim().max(160).nullable().default(null),
    seoDescription: z.string().trim().max(300).nullable().default(null),

    ...measureFields,
  })
  .superRefine((value, ctx) => {
    const hasList = (value.variants?.length ?? 0) > 0;

    if (!hasList) {
      if (!value.price) {
        ctx.addIssue({ code: 'custom', path: ['price'], message: 'Give the product a price.' });
      }
      if (value.salePrice !== null && value.price && Number(value.salePrice) >= Number(value.price)) {
        ctx.addIssue({
          code: 'custom',
          path: ['salePrice'],
          message: 'The sale price has to be below the normal price.',
        });
      }
    }

    for (const [index, variant] of (value.variants ?? []).entries()) {
      if (variant.salePrice !== null && Number(variant.salePrice) >= Number(variant.price)) {
        ctx.addIssue({
          code: 'custom',
          path: ['variants', index, 'salePrice'],
          message: 'The sale price has to be below the normal price.',
        });
      }
    }

    const skus = (value.variants ?? []).map((variant) => variant.sku);
    if (new Set(skus).size !== skus.length) {
      ctx.addIssue({ code: 'custom', path: ['variants'], message: 'Every variant needs its own SKU.' });
    }

    if (value.maxOrderQuantity !== null && value.maxOrderQuantity < value.minOrderQuantity) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxOrderQuantity'],
        message: 'The maximum cannot be below the minimum.',
      });
    }

    for (const issue of measureIssues({
      sellBy: value.sellBy ?? 'unit',
      measureUnit: value.measureUnit ?? null,
      pricingMeasure: value.pricingMeasure ?? null,
      minMeasure: value.minMeasure ?? null,
      measureOptions: value.measureOptions ?? null,
    })) {
      ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.message });
    }

    /*
     * A measure product is one variant priced at a rate. A variant list would
     * mean two answers to "how much is a kilo" and two stock pools for one pile
     * of vegetables, so it is refused here rather than half-supported.
     */
    if (value.sellBy === 'measure' && (value.variants?.length ?? 0) > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['variants'],
        message: 'A product sold by weight or volume cannot also have a variant list.',
      });
    }
  });

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
  description: z.string().trim().max(50_000).nullable().optional(),

  sku: z.string().trim().min(1, 'Give the product a SKU.').max(64).optional(),
  price: money.optional(),
  salePrice: money.nullable().optional(),
  costPrice: money.nullable().optional(),
  barcode: z.string().trim().max(64).nullable().optional(),
  weightGrams: z.coerce.number().int().min(0).max(10_000_000).nullable().optional(),
  imageUrl: url.nullable().optional(),

  videoUrl: url.nullable().optional(),
  trackInventory: z.boolean().optional(),

  isFeatured: z.boolean().optional(),
  isNewArrival: z.boolean().optional(),
  isReturnable: z.boolean().optional(),
  minOrderQuantity: z.coerce.number().int().min(1).max(10_000).optional(),
  maxOrderQuantity: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
  seoTitle: z.string().trim().max(160).nullable().optional(),
  seoDescription: z.string().trim().max(300).nullable().optional(),

  ...measureFields,
});

/** The gallery, as a whole list. Twelve is a product page, not an album. */
const mediaListSchema = z.object({
  media: z
    .array(
      z.object({
        url: url,
        altText: z.string().trim().max(200).nullable().default(null),
        sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
      }),
    )
    .max(12)
    .default([]),
});

/** A private note: a few paragraphs at most, and null or blank to clear it. */
const ownerNoteSchema = z.object({
  note: z.string().max(5000, 'Keep the note under 5,000 characters.').nullable(),
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
        imageUrl: url.nullable().default(null),
        isDefault: z.boolean().default(false),
        isActive: z.boolean().default(true),
        sortOrder: z.coerce.number().int().min(0).max(100_000).optional(),
        /** attributeValueId list; each value's attribute is resolved server-side. */
        attributeValueIds: z.array(z.string().uuid()).max(6).default([]),
        /**
         * Opening stock, and only for a variant this call is *creating*.
         *
         * A shop that adds a 500 g line to a product it already sells by the
         * kilo used to get a variant with no `inventory_levels` row at all —
         * which reads as *never counted*, and therefore as sellable without
         * limit, for as long as nobody opened the Inventory screen. So a new
         * variant gets a level row here exactly as `POST /products` gives one to
         * every variant it writes, at zero if no number was given.
         *
         * It is ignored for a variant that already exists, and has to be: stock
         * only ever moves by a ledgered delta (`POST /inventory/adjust`), and a
         * number typed into a form that replaces a list would be a silent
         * absolute write with no movement behind it.
         */
        stockQuantity: z.coerce.number().int().min(0).max(1_000_000).optional(),
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

const ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/**
 * A SKU for a product created without one: up to three letters of its name and
 * six random characters, `PUM-4K9QZ2`.
 *
 * The letters are there so the code still reads as the product on a packing
 * slip; the random half is what makes it unique, and is checked rather than
 * assumed. Thirty-four characters to the sixth is a billion and a half codes,
 * so the retry is for correctness, not because a clash is expected. No I or O,
 * which a person copying the code off a label reads as 1 and 0.
 */
async function generateSku(db: StoreDb, name: string): Promise<string> {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || 'SKU';

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${letters}-${randomBytes(6)
      .reduce((code, byte) => code + ALPHABET[byte % ALPHABET.length], '')}`;
    const clash = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(eq(productVariants.sku, candidate))
      .limit(1);
    if (clash.length === 0) return candidate;
  }

  throw conflict('Could not find a free SKU. Type one under Advanced options.', ERROR_CODES.SKU_TAKEN);
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

      /*
       * Stock per product, in one grouped pass rather than a correlated subquery
       * per row: the list filters on it and can sort by it, and a subquery can be
       * neither. `levels` counts the `inventory_levels` rows behind the sum, which
       * is what separates "sold out" from "never stocked" — both read as zero
       * available, and only one of them is a mistake.
       */
      const stock = store.db
        .select({
          productId: productVariants.productId,
          available: sql<number>`coalesce(sum(${inventoryLevels.available}), 0)::int`.as('available'),
          /*
           * Reserved and incoming ride along in the pass that was already being
           * made. They are what turns a bare "12 left" into something an owner
           * can act on: twelve with eight spoken for is nearly gone, and twelve
           * with forty on the way is not worth reordering.
           */
          reserved: sql<number>`coalesce(sum(${inventoryLevels.reserved}), 0)::int`.as('reserved'),
          incoming: sql<number>`coalesce(sum(${inventoryLevels.incoming}), 0)::int`.as('incoming'),
          threshold: sql<number>`coalesce(max(${inventoryLevels.lowStockThreshold}), 0)::int`.as('threshold'),
          levels: sql<number>`count(${inventoryLevels.id})::int`.as('levels'),
          variantCount: sql<number>`count(distinct ${productVariants.id})::int`.as('variant_count'),
        })
        .from(productVariants)
        .leftJoin(inventoryLevels, eq(inventoryLevels.variantId, productVariants.id))
        .groupBy(productVariants.productId)
        .as('stock');

      const available = sql<number>`coalesce(${stock.available}, 0)`;
      const levels = sql<number>`coalesce(${stock.levels}, 0)`;

      const filters = [
        query.search
          ? or(
              ilike(products.name, `%${query.search}%`),
              ilike(products.slug, `%${query.search}%`),
              sql`exists (
                select 1 from ${productVariants} v
                 where v.product_id = ${products.id} and v.sku ilike ${`%${query.search}%`}
              )`,
            )
          : undefined,
        query.status === 'all' ? undefined : eq(products.status, query.status),
        query.categoryId ? eq(products.categoryId, query.categoryId) : undefined,
        query.brandId ? eq(products.brandId, query.brandId) : undefined,
        query.featured === 'all' ? undefined : eq(products.isFeatured, query.featured === 'yes'),
        query.reviews === 'pending'
          ? sql`exists (
              select 1 from ${reviews} r
               where r.product_id = ${products.id} and r.status = 'pending'
            )`
          : undefined,
        query.stock === 'untracked'
          ? sql`${levels} = 0`
          : query.stock === 'out'
            ? sql`${levels} > 0 and ${available} <= 0`
            : query.stock === 'low'
              ? sql`${available} > 0 and ${available} <= ${stock.threshold}`
              : query.stock === 'in_stock'
                ? sql`${available} > ${stock.threshold}`
                : undefined,
      ].filter(Boolean);

      const column = query.sort === 'stock' ? available : SORTABLE[query.sort];

      /*
       * The chosen column, then the id. The id is not decoration: two products
       * created in the same millisecond have no order between them, and without a
       * tiebreaker the cursor cannot name a position — one of them would arrive
       * in two batches and the other in none.
       */
      const page = keyset<ProductListRow>([
        { expr: column, order: query.order, of: CURSOR_VALUE[query.sort] },
        { expr: products.id, order: query.order, of: (row) => row.id },
      ]);

      const seek = page.after(query.cursor);
      const where = filters.length ? and(...filters) : undefined;
      const scan = seek ? and(seek, ...filters) : where;

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
          isNewArrival: products.isNewArrival,
          soldCount: products.soldCount,
          /** Free — they are columns on the row already being read. */
          ratingAverage: products.ratingAverage,
          ratingCount: products.ratingCount,
          /*
           * Every review, whatever its status, and the ones still waiting.
           * `rating_count` counts approved rows only, so it cannot say a product
           * has reviews to moderate. Correlated per returned row — at most a
           * batch of them — on `reviews_product_idx`.
           */
          reviewCount: sql<number>`(select count(*)::int from ${reviews} r where r.product_id = ${products.id})`,
          pendingReviewCount: sql<number>`(
            select count(*)::int from ${reviews} r
             where r.product_id = ${products.id} and r.status = 'pending'
          )`,
          trackInventory: products.trackInventory,
          createdAt: products.createdAt,
          updatedAt: products.updatedAt,
          categoryId: products.categoryId,
          categoryName: categories.name,
          brandId: products.brandId,
          brandName: brands.name,
          /*
           * The default variant's identifying and cost fields, so a row can show
           * what it scans as and what it makes. One lateral rather than three
           * correlated subqueries: the same index lookup answers all of them, and
           * a fourth would be a fourth walk of `product_variants_product_idx`.
           */
          sku: sql<string | null>`defaults.sku`,
          barcode: sql<string | null>`defaults.barcode`,
          costPrice: sql<string | null>`defaults.cost_price`,
          /*
           * The variant's own picture first, the gallery second. That is the order
           * the storefront resolves a thumbnail in, so the list shows what a
           * shopper would see rather than a second, more optimistic answer.
           */
          imageUrl: sql<string | null>`coalesce(
            (select v.image_url from ${productVariants} v
              where v.product_id = ${products.id} and v.image_url is not null
              order by v.is_default desc, v.sort_order asc
              limit 1),
            (select m.url from ${productMedia} m
              where m.product_id = ${products.id}
              order by m.is_primary desc, m.sort_order asc
              limit 1)
          )`,
          stock: sql<number>`${available}::int`,
          reserved: sql<number>`coalesce(${stock.reserved}, 0)::int`,
          incoming: sql<number>`coalesce(${stock.incoming}, 0)::int`,
          lowStockThreshold: sql<number>`coalesce(${stock.threshold}, 0)::int`,
          stockRecords: sql<number>`${levels}::int`,
          variantCount: sql<number>`coalesce(${stock.variantCount}, 0)::int`,
        })
        .from(products)
        .leftJoin(categories, eq(categories.id, products.categoryId))
        .leftJoin(brands, eq(brands.id, products.brandId))
        .leftJoin(stock, eq(stock.productId, products.id))
        .leftJoin(
          sql`lateral (
            select v.sku, v.barcode, v.cost_price
              from ${productVariants} v
             where v.product_id = ${products.id}
             order by v.is_default desc, v.sort_order asc
             limit 1
          ) as defaults`,
          sql`true`,
        )
        .where(scan)
        .orderBy(...page.orderBy)
        // One more than fits, which is what separates "there is another batch"
        // from "that was the last one" without a second query.
        .limit(query.pageSize + 1)
        .offset(query.cursor ? 0 : (query.page - 1) * query.pageSize);

      const batch = page.batch(rows, query.pageSize);

      // Counted on the first batch only — the scroll shows the figure once, and
      // the count is the half of a list read that cannot stop at `pageSize`.
      const total = query.cursor
        ? undefined
        : (
            await store.db
              .select({ total: count() })
              .from(products)
              .leftJoin(stock, eq(stock.productId, products.id))
              .where(where)
          )[0]?.total ?? 0;

      return listed(reply, batch.rows, {
        pageSize: query.pageSize,
        nextCursor: batch.nextCursor,
        hasMore: batch.hasMore,
        total,
      });
    },
  );

  /**
   * The four figures the list header shows, counted in the database rather than
   * over a page of rows — a tally derived from 20 rows would describe the page,
   * not the catalogue. One statement, so the numbers agree with each other.
   */
  app.get(
    '/products/stats',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('products.view')] },
    async (request, reply) => {
      const store = storeOf(request);

      const result = await store.db.execute<{
        total: number;
        active: number;
        draft: number;
        inactive: number;
        featured: number;
        added_this_month: number;
        out_of_stock: number;
        low_stock: number;
        untracked: number;
        units_in_stock: number;
      }>(sql`
        with stock as (
          select v.product_id,
                 coalesce(sum(l.available), 0)::int as available,
                 coalesce(max(l.low_stock_threshold), 0)::int as threshold,
                 count(l.id)::int as levels
            from ${productVariants} v
            left join ${inventoryLevels} l on l.variant_id = v.id
           group by v.product_id
        )
        select
          count(*)::int as total,
          count(*) filter (where p.status = 'active')::int as active,
          count(*) filter (where p.status = 'draft')::int as draft,
          count(*) filter (where p.status = 'inactive')::int as inactive,
          count(*) filter (where p.is_featured)::int as featured,
          count(*) filter (where p.created_at >= date_trunc('month', now()))::int as added_this_month,
          count(*) filter (where coalesce(s.levels, 0) > 0 and coalesce(s.available, 0) <= 0)::int as out_of_stock,
          count(*) filter (where coalesce(s.available, 0) > 0 and coalesce(s.available, 0) <= coalesce(s.threshold, 0))::int as low_stock,
          count(*) filter (where coalesce(s.levels, 0) = 0)::int as untracked,
          coalesce(sum(coalesce(s.available, 0)), 0)::int as units_in_stock
        from ${products} p
        left join stock s on s.product_id = p.id
      `);

      const row = result.rows?.[0];

      return ok(reply, {
        total: Number(row?.total ?? 0),
        active: Number(row?.active ?? 0),
        draft: Number(row?.draft ?? 0),
        inactive: Number(row?.inactive ?? 0),
        featured: Number(row?.featured ?? 0),
        addedThisMonth: Number(row?.added_this_month ?? 0),
        outOfStock: Number(row?.out_of_stock ?? 0),
        lowStock: Number(row?.low_stock ?? 0),
        untracked: Number(row?.untracked ?? 0),
        unitsInStock: Number(row?.units_in_stock ?? 0),
      });
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

      const variantRows = await store.db
        .select()
        .from(productVariants)
        .where(eq(productVariants.productId, id))
        .orderBy(desc(productVariants.isDefault), asc(productVariants.sortOrder));

      const variantIds = variantRows.map((row) => row.id);

      /*
       * The gallery, the specification rows, the descriptive attribute values and
       * the bundle come back with the product because each of their endpoints
       * replaces the whole list. An editor that could not read the current list
       * back would open empty and save that emptiness over what is stored — the
       * read is what makes a full-replace write safe to offer at all.
       *
       * Only the gallery is returned from `product_media`: the single image on the
       * product form lives in the same table tied to the default variant, and
       * mixing the two would show it twice and then delete it on the next save.
       */
      /*
       * What each variant has on the shelf, so the Variants tab can say it.
       *
       * `levels` is the part that carries meaning beyond the number: a variant
       * with no `inventory_levels` row at all has never been counted and is
       * therefore sellable without limit, which is a different state from one
       * counted down to zero. Both are zero available, and only one of them is a
       * mistake worth chasing — so the two are reported apart (`stock: null`
       * against `stock: 0`) rather than added together.
       */
      const stockRows =
        variantIds.length > 0
          ? await store.db
              .select({
                variantId: inventoryLevels.variantId,
                available: sql<number>`coalesce(sum(${inventoryLevels.available}), 0)::int`,
                reserved: sql<number>`coalesce(sum(${inventoryLevels.reserved}), 0)::int`,
              })
              .from(inventoryLevels)
              .where(inArray(inventoryLevels.variantId, variantIds))
              .groupBy(inventoryLevels.variantId)
          : [];

      const stockOf = new Map(stockRows.map((row) => [row.variantId, row]));

      const [gallery, specifications, attributeLinks, bundleRows, variantLinks] = await Promise.all([
        store.db
          .select()
          .from(productMedia)
          .where(and(eq(productMedia.productId, id), isNull(productMedia.variantId)))
          .orderBy(asc(productMedia.sortOrder)),
        store.db
          .select()
          .from(productSpecifications)
          .where(eq(productSpecifications.productId, id))
          .orderBy(asc(productSpecifications.sortOrder)),
        store.db
          .select({ attributeValueId: productAttributeValues.attributeValueId })
          .from(productAttributeValues)
          .where(eq(productAttributeValues.productId, id)),
        store.db
          .select({ relatedProductId: productBundles.relatedProductId })
          .from(productBundles)
          .where(eq(productBundles.productId, id))
          .orderBy(asc(productBundles.sortOrder)),
        variantIds.length > 0
          ? store.db
              .select({
                variantId: productVariantValues.variantId,
                attributeValueId: productVariantValues.attributeValueId,
              })
              .from(productVariantValues)
              .where(inArray(productVariantValues.variantId, variantIds))
          : Promise.resolve([] as { variantId: string; attributeValueId: string }[]),
      ]);

      const selectionOf = new Map<string, string[]>();
      for (const link of variantLinks) {
        const chosen = selectionOf.get(link.variantId);
        if (chosen) chosen.push(link.attributeValueId);
        else selectionOf.set(link.variantId, [link.attributeValueId]);
      }

      const variants = variantRows.map((row) => {
        const stock = stockOf.get(row.id);

        return {
          ...row,
          attributeValueIds: selectionOf.get(row.id) ?? [],
          stock: stock ? Number(stock.available) : null,
          reserved: stock ? Number(stock.reserved) : 0,
        };
      });

      return ok(reply, {
        ...product,
        variants,
        defaultVariant: variants[0] ?? null,
        media: gallery,
        specifications,
        attributeValueIds: attributeLinks.map((row) => row.attributeValueId),
        bundleProductIds: bundleRows.map((row) => row.relatedProductId),
      });
    },
  );

  /*
   * The owner's private note on a product.
   *
   * Its own endpoint rather than a field on `PATCH /products/:id`, because the
   * note is written from the View panel while the Details tab writes the rest —
   * two forms sharing one body would each have to send the other's field back
   * or clear it. It does not touch `updated_at`: "last edited" is about the
   * product a shopper sees, and jotting a reminder on it is not an edit to that.
   *
   * `storefrontUnaffected` keeps the module's write hook from dropping the
   * store's whole catalogue cache over a value no shopper can read.
   */
  app.put(
    '/products/:id/note',
    {
      preHandler: [app.requireStoreAdmin, app.requirePermission('products.update')],
      config: { storefrontUnaffected: true },
    },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(ownerNoteSchema, request.body);

      // Blank is no note, so an emptied box reads back as null rather than "".
      const note = body.note && body.note.trim() !== '' ? body.note.trim() : null;

      const updated = (
        await store.db
          .update(products)
          .set({ ownerNote: note })
          .where(eq(products.id, id))
          .returning({ id: products.id, name: products.name, ownerNote: products.ownerNote })
      )[0];
      if (!updated) throw notFound('That product no longer exists.');

      // The audit row says a note changed, never what it says — it is private.
      await audit(store.db, request, {
        action: 'product.note',
        module: 'catalog',
        entity: 'product',
        entityId: id,
        entityLabel: updated.name,
        newValues: { hasNote: note !== null, length: note?.length ?? 0 },
      });

      return ok(reply, { ownerNote: updated.ownerNote });
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

      /*
       * Where an opening balance lands. Read before the transaction because it
       * is the same answer for every variant in the list, and a shop with no
       * warehouse at all still gets its variants written — a missing shelf is
       * not a reason to refuse a catalogue edit.
       */
      const [warehouse] = await store.db
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.isActive, true))
        .orderBy(desc(warehouses.isDefault), asc(warehouses.name))
        .limit(1);

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

          /*
           * A brand-new variant is given a level row, at zero if the form named
           * no opening quantity — so it reads as *tracked and empty* rather than
           * as never counted, which is the difference between "sold out" and
           * "sellable without limit". An existing variant is left alone: its
           * count belongs to the ledger, and this endpoint replaces a list.
           */
          if (!current && warehouse) {
            const opening = variant.stockQuantity ?? 0;

            await tx
              .insert(inventoryLevels)
              .values({ variantId, warehouseId: warehouse.id, available: opening })
              .onConflictDoNothing();

            // `initial` is the one ledger type meaning "this is where the count
            // started"; everything after it is a signed delta, so the history
            // can be replayed from here.
            if (opening > 0) {
              await tx.insert(inventoryTransactions).values({
                variantId,
                warehouseId: warehouse.id,
                type: 'initial',
                quantity: opening,
                toBucket: 'available',
                availableAfter: opening,
                reservedAfter: 0,
                note: 'Opening stock, set when the variant was added.',
                adminId: request.storeAdmin!.adminId,
                adminLabel: request.storeAdmin!.email,
              });
            }
          }

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

      /*
       * One list either way.
       *
       * A `simple` product still owns exactly one variant — the schema says so,
       * which is what keeps pricing, stock and order lines on a single code
       * path. Normalising here means the rest of this handler never has to ask
       * which kind of product it is writing.
       */
      const lines =
        body.variants && body.variants.length > 0
          ? body.variants.map((variant) => ({
              ...variant,
              /*
               * The product's cost price stands in for a variant that names
               * none. A shop buying its sizes at different prices is rarer than
               * one confused by a fourth money field on every row, so the form
               * asks once — and without this the answer would be quietly
               * dropped the moment variants were switched on, leaving every
               * profit figure measured against a cost of zero.
               */
              costPrice: variant.costPrice ?? body.costPrice,
            }))
          : [
              {
                sku: body.sku || (await generateSku(store.db, body.name)),
                title: null,
                price: body.price!,
                salePrice: body.salePrice,
                costPrice: body.costPrice,
                barcode: body.barcode,
                weightGrams: body.weightGrams,
                imageUrl: body.imageUrl,
                stockQuantity: body.stockQuantity,
                attributeValueIds: [] as string[],
              },
            ];

      for (const line of lines) await assertSkuFree(store.db, line.sku);

      /*
       * Every option value resolved to its own attribute here rather than
       * trusted from the body: the pair is a composite key, and a caller that
       * sent a mismatched attribute would file a colour under Size and make the
       * storefront's option controls disagree with the variants they pick.
       */
      const valueIds = [...new Set(lines.flatMap((line) => line.attributeValueIds))];
      const valueRows = valueIds.length
        ? await store.db
            .select({ id: attributeValues.id, attributeId: attributeValues.attributeId })
            .from(attributeValues)
            .where(inArray(attributeValues.id, valueIds))
        : [];

      if (valueRows.length !== valueIds.length) {
        throw unprocessable('One of those option values does not exist.', ERROR_CODES.VALIDATION_FAILED, {
          variants: ['Choose option values that exist.'],
        });
      }
      const attributeOf = new Map(valueRows.map((row) => [row.id, row.attributeId]));

      const slug = await settleSlug({
        requested: body.slug,
        from: body.name,
        isTaken: async (candidate) =>
          (await store.db.select({ id: products.id }).from(products).where(eq(products.slug, candidate)).limit(1))
            .length > 0,
      });

      /*
       * Opening stock has to land in a warehouse, and the store seed creates
       * one. If a shop has somehow deleted every warehouse, the product is still
       * written — a missing shelf is not a reason to refuse a catalogue entry,
       * and a variant with no level rows reads as untracked rather than as
       * out of stock.
       */
      const [warehouse] = await store.db
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(eq(warehouses.isActive, true))
        .orderBy(desc(warehouses.isDefault), asc(warehouses.name))
        .limit(1);

      // Cheapest sellable line wins `price_from` — that is what "from £x" means.
      const cheapest = lines
        .map((line) => ({
          price: Number(line.price),
          salePrice: line.salePrice === null ? null : Number(line.salePrice),
        }))
        .sort((a, b) => (a.salePrice ?? a.price) - (b.salePrice ?? b.price))[0]!;

      const measureMode = body.sellBy === 'measure';
      /*
       * An empty list is stored as null, not as `[]`: null is what defers to the
       * store's default picker, and a product saved with no options of its own
       * means "use the shop's", never "offer nothing".
       */
      const createOptions = measureMode && body.measureOptions?.length
        ? normaliseMeasureOptions(body.measureOptions)
        : null;

      // One transaction, because a product whose variant failed to write is not
      // a half-saved product — it is one nobody can buy.
      const created = await store.db.transaction(async (tx) => {
        const [product] = await tx
          .insert(products)
          .values({
            name: body.name,
            slug,
            type: lines.length > 1 ? 'variable' : 'simple',
            status: body.status,
            categoryId: body.categoryId,
            brandId: body.brandId,
            description: body.description,
            priceFrom: cheapest.price.toFixed(2),
            salePriceFrom: cheapest.salePrice === null ? null : cheapest.salePrice.toFixed(2),
            videoUrl: body.videoUrl,
            trackInventory: body.trackInventory,
            isFeatured: body.isFeatured,
            isNewArrival: body.isNewArrival,
            isReturnable: body.isReturnable,
            minOrderQuantity: body.minOrderQuantity,
            maxOrderQuantity: body.maxOrderQuantity,
            seoTitle: body.seoTitle,
            seoDescription: body.seoDescription,
            publishedAt: body.status === 'active' ? new Date() : null,
            /*
             * Off unless asked for, and the four fields beside it are cleared
             * when it is off rather than left behind — a stale "per 1kg" on a
             * product switched back to unit selling would print on the card.
             */
            sellBy: measureMode ? 'measure' : 'unit',
            measureUnit: measureMode ? (body.measureUnit ?? 'g') : null,
            pricingMeasure: measureMode ? (body.pricingMeasure ?? 1000) : null,
            pricingLabel: measureMode ? (body.pricingLabel ?? null) : null,
            minMeasure: measureMode ? (body.minMeasure ?? null) : null,
            measureOptions: measureMode ? createOptions : null,
          })
          .returning();

        const saved: (typeof productVariants.$inferSelect)[] = [];

        for (const [index, line] of lines.entries()) {
          const [variant] = await tx
            .insert(productVariants)
            .values({
              productId: product!.id,
              sku: line.sku,
              title: line.title,
              barcode: line.barcode,
              price: line.price,
              salePrice: line.salePrice,
              costPrice: line.costPrice,
              weightGrams: line.weightGrams,
              imageUrl: line.imageUrl,
              isDefault: index === 0,
              isActive: body.status !== 'inactive',
              sortOrder: index * 10,
            })
            .returning();

          saved.push(variant!);

          if (line.attributeValueIds.length > 0) {
            await tx.insert(productVariantValues).values(
              line.attributeValueIds.map((attributeValueId) => ({
                variantId: variant!.id,
                attributeId: attributeOf.get(attributeValueId)!,
                attributeValueId,
              })),
            );
          }

          if (!warehouse) continue;

          /*
           * The level row is written even at zero, so the variant reads as
           * *tracked and empty* rather than as never counted — both show zero
           * available and only one of them is a mistake worth chasing.
           */
          await tx.insert(inventoryLevels).values({
            variantId: variant!.id,
            warehouseId: warehouse.id,
            available: line.stockQuantity,
            lowStockThreshold: body.lowStockThreshold,
          });

          /*
           * `initial` is the one ledger type that means "this is where the count
           * started". Every movement after it is a signed delta through
           * `/inventory/adjust`, so the history can be replayed from here.
           */
          if (line.stockQuantity > 0) {
            await tx.insert(inventoryTransactions).values({
              variantId: variant!.id,
              warehouseId: warehouse.id,
              type: 'initial',
              quantity: line.stockQuantity,
              toBucket: 'available',
              availableAfter: line.stockQuantity,
              reservedAfter: 0,
              note: 'Opening stock, set when the product was added.',
              adminId: request.storeAdmin!.adminId,
              adminLabel: request.storeAdmin!.email,
            });
          }
        }

        await setPrimaryMedia(tx, product!.id, saved[0]!.id, body.imageUrl, body.name);

        // The gallery is `variant_id is null`, which is what keeps it apart from
        // the single picture above — mixing them shows one image twice and then
        // deletes it on the next gallery save.
        if (body.galleryImages.length > 0) {
          await tx.insert(productMedia).values(
            body.galleryImages.map((image, index) => ({
              productId: product!.id,
              variantId: null,
              type: 'image' as const,
              url: image,
              altText: body.name.slice(0, 200),
              isPrimary: false,
              sortOrder: index * 10,
            })),
          );
        }

        return { ...product!, variants: saved, defaultVariant: saved[0]! };
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

      /*
       * The measure block is resolved as a whole against the merged row, because
       * these five fields only make sense together: switching the mode on with
       * one call and setting the unit with the next would leave a product priced
       * per nothing in between. Switching it *off* clears all four, so a stale
       * "Per 1kg" cannot survive on a product now sold one at a time.
       */
      const sellBy = body.sellBy ?? existing.sellBy;
      const measureMode = sellBy === 'measure';
      const measureUnit = measureMode
        ? (body.measureUnit === undefined ? (existing.measureUnit ?? 'g') : (body.measureUnit ?? 'g'))
        : null;
      const pricingMeasure = measureMode
        ? (body.pricingMeasure === undefined
            ? (existing.pricingMeasure ?? 1000)
            : (body.pricingMeasure ?? 1000))
        : null;
      const pricingLabel = measureMode
        ? (body.pricingLabel === undefined ? existing.pricingLabel : body.pricingLabel)
        : null;
      const minMeasure = measureMode
        ? (body.minMeasure === undefined ? existing.minMeasure : body.minMeasure)
        : null;
      const measureOptions = measureMode
        ? (body.measureOptions === undefined
            ? existing.measureOptions
            : body.measureOptions?.length
              ? normaliseMeasureOptions(body.measureOptions)
              : null)
        : null;

      const measureProblems = measureIssues({
        sellBy,
        measureUnit,
        pricingMeasure,
        minMeasure,
        measureOptions,
      });
      if (measureProblems.length > 0) {
        throw unprocessable(measureProblems[0]!.message, ERROR_CODES.VALIDATION_FAILED, {
          ...Object.fromEntries(measureProblems.map((issue) => [issue.path, [issue.message]])),
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

        /*
         * `price_from` is recomputed across the whole variant list rather than
         * copied from the one just written.
         *
         * This form edits the **default** variant, and a simple product has only
         * that one, so for it the two answers agree. A variable product's
         * `price_from` is its cheapest sellable variant — that is what "from £x"
         * means on every listing, card and sort — so copying the default's price
         * over it would silently re-price the product on the shop each time
         * anybody opened the details tab. Active variants first, because an
         * inactive one is not on sale and must not set the shelf price; if none
         * are active the cheapest of them stands in, exactly as
         * `PUT /products/:id/variants` does it.
         */
        const [cheapest] = await tx
          .select({ price: productVariants.price, salePrice: productVariants.salePrice })
          .from(productVariants)
          .where(eq(productVariants.productId, id))
          .orderBy(
            desc(productVariants.isActive),
            asc(sql`coalesce(${productVariants.salePrice}, ${productVariants.price})`),
          )
          .limit(1);

        const [product] = await tx
          .update(products)
          .set({
            name: body.name ?? existing.name,
            slug,
            status,
            categoryId: body.categoryId === undefined ? existing.categoryId : body.categoryId,
            brandId: body.brandId === undefined ? existing.brandId : body.brandId,
            description: body.description === undefined ? existing.description : body.description,
            priceFrom: cheapest?.price ?? price,
            salePriceFrom: cheapest === undefined ? salePrice : cheapest.salePrice,
            videoUrl: body.videoUrl === undefined ? existing.videoUrl : body.videoUrl,
            trackInventory: body.trackInventory ?? existing.trackInventory,
            isFeatured: body.isFeatured ?? existing.isFeatured,
            isNewArrival: body.isNewArrival ?? existing.isNewArrival,
            isReturnable: body.isReturnable ?? existing.isReturnable,
            minOrderQuantity,
            maxOrderQuantity,
            seoTitle: body.seoTitle === undefined ? existing.seoTitle : body.seoTitle,
            seoDescription: body.seoDescription === undefined ? existing.seoDescription : body.seoDescription,
            sellBy,
            measureUnit,
            pricingMeasure,
            pricingLabel,
            minMeasure,
            measureOptions,
            // First publish is stamped; re-publishing later does not rewrite the
            // date the product originally went live.
            publishedAt: status === 'active' ? (existing.publishedAt ?? new Date()) : existing.publishedAt,
            updatedAt: new Date(),
          })
          .where(eq(products.id, id))
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
          message: await translateFor(
            request,
            'This product has been ordered before, so it was hidden from the store instead of deleted.',
          ),
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

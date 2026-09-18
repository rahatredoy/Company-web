import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TenantDb } from '../../db/tenant-manager';
import { brands, categories, products } from '../../db/schema/index';
import { CACHE_TTL, cached, tenantKey } from '../../lib/cache';
import { ok, parseQuery } from '../../lib/http';
import { queryKey } from '../../lib/public-cache';
import { storeOf } from '../../plugins/tenant';
import { liveSalePriceSql, PUBLISHED_PRODUCT } from './service';
import type { SearchSuggestion } from './types';

const querySchema = z.object({
  q: z.string().trim().max(120).default(''),
  limit: z.coerce.number().int().min(1).max(10).default(6),
});

/**
 * Type-ahead for the search box.
 *
 * Products, categories and brands in one list, each carrying the href the
 * storefront should navigate to — built here rather than in the browser so a
 * suggestion can never link somewhere the shopper is not allowed to go.
 *
 * A short query returns nothing rather than the first N of everything: one
 * character matches most of a catalogue, which is a slow query that tells the
 * shopper nothing.
 */
export default async function searchRoutes(app: FastifyInstance) {
  app.get('/search/suggest', async (request, reply) => {
    const store = storeOf(request);
    const { q, limit } = parseQuery(querySchema, request.query);

    if (q.length < 2) return ok(reply, []);

    /*
     * Cached, and lower-cased into the key.
     *
     * This is the one storefront read that fires while a finger is moving: every
     * shopper typing "shirt" walks through "sh", "shi", "shir", "shirt", and the
     * prefixes of a store's popular terms are the same prefixes for everybody.
     * Uncached, a busy shop pays three substring scans per keystroke per visitor
     * for an answer it computed a second ago.
     *
     * Case is folded into the key because `ILIKE` already ignores it — "Shirt"
     * and "shirt" return the same rows and must not be two entries.
     */
    const suggestions = await cached(
      tenantKey(store.tenantRef, 'storefront', 'suggest', queryKey({ q: q.toLowerCase(), limit })),
      CACHE_TTL.searchSuggest,
      () => loadSuggestions(store.db, q, limit),
    );

    return ok(reply, suggestions);
  });
}

/**
 * The three lookups behind one suggestion list.
 *
 * A leading-wildcard `ILIKE` cannot use a B-tree index, so all three of these
 * relied on a sequential scan until migration `0006` added the trigram indexes
 * that make `%term%` an index lookup. Kept as three parallel queries rather than
 * a `UNION` so each keeps its own ordering rule — products rank by what actually
 * sells, the other two alphabetically.
 */
async function loadSuggestions(db: TenantDb, q: string, limit: number): Promise<SearchSuggestion[]> {
  const term = `%${q}%`;

  const [productRows, categoryRows, brandRows] = await Promise.all([
    db
      .select({
        id: products.id,
        name: products.name,
        slug: products.slug,
        price: products.priceFrom,
        // The active variants' sale. See `service.ts#liveSalePriceSql`.
        salePrice: liveSalePriceSql,
        brandName: brands.name,
        imageUrl: sql<string | null>`(
          select pm.url from product_media pm
          where pm.product_id = ${products.id} and pm.type = 'image'
          order by pm.is_primary desc, pm.sort_order asc
          limit 1
        )`,
      })
      .from(products)
      .leftJoin(brands, eq(brands.id, products.brandId))
      .where(and(PUBLISHED_PRODUCT, ilike(products.name, term)))
      .orderBy(desc(products.soldCount), asc(products.name))
      .limit(limit),

    db
      .select({ id: categories.id, name: categories.name, slug: categories.slug })
      .from(categories)
      .where(and(eq(categories.isActive, true), ilike(categories.name, term)))
      .orderBy(asc(categories.name))
      .limit(3),

    db
      .select({ id: brands.id, name: brands.name, slug: brands.slug })
      .from(brands)
      .where(and(eq(brands.isActive, true), ilike(brands.name, term)))
      .orderBy(asc(brands.name))
      .limit(3),
  ]);

  return [
    ...productRows.map((row) => ({
      type: 'product' as const,
      id: row.id,
      label: row.name,
      href: `/product/${row.slug}`,
      imageUrl: row.imageUrl,
      price: row.salePrice ?? row.price,
      meta: row.brandName,
    })),
    ...categoryRows.map((row) => ({
      type: 'category' as const,
      id: row.id,
      label: row.name,
      href: `/category/${row.slug}`,
      imageUrl: null,
      price: null,
      meta: 'Category',
    })),
    ...brandRows.map((row) => ({
      type: 'brand' as const,
      id: row.id,
      label: row.name,
      href: `/brand/${row.slug}`,
      imageUrl: null,
      price: null,
      meta: 'Brand',
    })),
  ];
}

import { and, asc, desc, eq, ilike, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { brands, categories, products } from '../../db/schema/index';
import { ok, parseQuery } from '../../lib/http';
import { storeOf } from '../../plugins/tenant';
import { PUBLISHED_PRODUCT } from './service';
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

    const term = `%${q}%`;

    const [productRows, categoryRows, brandRows] = await Promise.all([
      store.db
        .select({
          id: products.id,
          name: products.name,
          slug: products.slug,
          price: products.priceFrom,
          salePrice: products.salePriceFrom,
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

      store.db
        .select({ id: categories.id, name: categories.name, slug: categories.slug })
        .from(categories)
        .where(and(eq(categories.isActive, true), ilike(categories.name, term)))
        .orderBy(asc(categories.name))
        .limit(3),

      store.db
        .select({ id: brands.id, name: brands.name, slug: brands.slug })
        .from(brands)
        .where(and(eq(brands.isActive, true), ilike(brands.name, term)))
        .orderBy(asc(brands.name))
        .limit(3),
    ]);

    const suggestions: SearchSuggestion[] = [
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

    return ok(reply, suggestions);
  });
}

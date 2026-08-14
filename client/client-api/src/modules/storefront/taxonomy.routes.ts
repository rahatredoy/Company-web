import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { brands, categories, products } from '../../db/schema/index';
import { CACHE_TTL, cached, tenantKey } from '../../lib/cache';
import { notFound } from '../../lib/errors';
import { ok, parseParams } from '../../lib/http';
import { storeOf } from '../../plugins/tenant';
import { breadcrumbFor, descendantIds, loadCategoryTree, PUBLISHED_PRODUCT } from './service';
import type { BrandView, CategoryView } from './types';

const slugParamSchema = z.object({ slug: z.string().trim().min(1).max(220) });

/**
 * Category and brand reads.
 *
 * Both are cached for five minutes: a shopper browsing a store hits these on
 * every page and they change only when the owner edits them, at which point the
 * admin write drops the key rather than waiting the TTL out.
 */
export default async function taxonomyRoutes(app: FastifyInstance) {
  /**
   * The category tree, each node carrying how many products are actually in it.
   *
   * The count is over the **subtree**, because that is what the listing behind
   * the link will show — a parent reporting only its own directly-assigned
   * products would say "0" next to a menu entry that opens a full page of them.
   */
  app.get('/categories', async (request, reply) => {
    const store = storeOf(request);

    const tree = await cached(
      tenantKey(store.tenantRef, 'storefront', 'categories'),
      CACHE_TTL.categories,
      async () => {
        const rows = await store.db
          .select({
            id: categories.id,
            parentId: categories.parentId,
            name: categories.name,
            slug: categories.slug,
            description: categories.description,
            imageUrl: categories.imageUrl,
            bannerUrl: categories.bannerUrl,
            seoTitle: categories.seoTitle,
            seoDescription: categories.seoDescription,
          })
          .from(categories)
          .where(eq(categories.isActive, true))
          .orderBy(asc(categories.sortOrder), asc(categories.name));

        const counts = await store.db
          .select({ categoryId: products.categoryId, total: count() })
          .from(products)
          .where(PUBLISHED_PRODUCT)
          .groupBy(products.categoryId);

        const directCount = new Map(counts.map((row) => [row.categoryId ?? '', Number(row.total)]));
        const flat = rows.map((row) => ({ id: row.id, parentId: row.parentId, name: row.name, slug: row.slug }));

        const build = (parentId: string | null): CategoryView[] =>
          rows
            .filter((row) => row.parentId === parentId)
            .map((row) => ({
              id: row.id,
              name: row.name,
              slug: row.slug,
              description: row.description,
              imageUrl: row.imageUrl,
              bannerUrl: row.bannerUrl,
              productCount: descendantIds(flat, row.id).reduce(
                (total, id) => total + (directCount.get(id) ?? 0),
                0,
              ),
              children: build(row.id),
              breadcrumb: breadcrumbFor(flat, row.id),
              seo: { title: row.seoTitle, description: row.seoDescription },
            }));

        return build(null);
      },
    );

    return ok(reply, tree);
  });

  app.get('/categories/:slug', async (request, reply) => {
    const store = storeOf(request);
    const { slug } = parseParams(slugParamSchema, request.params);

    const [row] = await store.db
      .select()
      .from(categories)
      .where(and(eq(categories.slug, slug), eq(categories.isActive, true)))
      .limit(1);

    // An inactive category answers exactly as a missing one does. Saying "this
    // exists but is hidden" would let anyone map out what a store is preparing.
    if (!row) throw notFound('This category does not exist.');

    const flat = await loadCategoryTree(store);
    const subtree = descendantIds(flat, row.id);

    const [tally] = await store.db
      .select({ total: count() })
      .from(products)
      .where(and(PUBLISHED_PRODUCT, inArray(products.categoryId, subtree)));

    const children = flat.filter((node) => node.parentId === row.id);

    return ok(reply, {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      imageUrl: row.imageUrl,
      bannerUrl: row.bannerUrl,
      productCount: Number(tally?.total ?? 0),
      children: children.map((child) => ({
        id: child.id,
        name: child.name,
        slug: child.slug,
        description: null,
        imageUrl: null,
        bannerUrl: null,
        productCount: 0,
        children: [],
        breadcrumb: [],
        seo: { title: null, description: null },
      })),
      breadcrumb: breadcrumbFor(flat, row.id),
      seo: { title: row.seoTitle, description: row.seoDescription },
    } satisfies CategoryView);
  });

  app.get('/brands', async (request, reply) => {
    const store = storeOf(request);

    const list = await cached(
      tenantKey(store.tenantRef, 'storefront', 'brands'),
      CACHE_TTL.brands,
      async () => {
        const rows = await store.db
          .select({
            id: brands.id,
            name: brands.name,
            slug: brands.slug,
            description: brands.description,
            logoUrl: brands.logoUrl,
            seoTitle: brands.seoTitle,
            seoDescription: brands.seoDescription,
            productCount: sql<number>`(
              select count(*)::int from products p
              where p.brand_id = ${brands.id} and p.status = 'active'
            )`,
          })
          .from(brands)
          .where(eq(brands.isActive, true))
          .orderBy(asc(brands.sortOrder), asc(brands.name));

        return rows.map(
          (row) =>
            ({
              id: row.id,
              name: row.name,
              slug: row.slug,
              description: row.description,
              logoUrl: row.logoUrl,
              productCount: Number(row.productCount),
              seo: { title: row.seoTitle, description: row.seoDescription },
            }) satisfies BrandView,
        );
      },
    );

    return ok(reply, list);
  });

  app.get('/brands/:slug', async (request, reply) => {
    const store = storeOf(request);
    const { slug } = parseParams(slugParamSchema, request.params);

    const [row] = await store.db
      .select()
      .from(brands)
      .where(and(eq(brands.slug, slug), eq(brands.isActive, true)))
      .limit(1);

    if (!row) throw notFound('This brand does not exist.');

    const [tally] = await store.db
      .select({ total: count() })
      .from(products)
      .where(and(PUBLISHED_PRODUCT, eq(products.brandId, row.id)));

    return ok(reply, {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      logoUrl: row.logoUrl,
      productCount: Number(tally?.total ?? 0),
      seo: { title: row.seoTitle, description: row.seoDescription },
    } satisfies BrandView);
  });
}

import { and, asc, count, eq, ilike, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { brands, products } from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { buildMeta, noContent, ok, paginated, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { storeOf } from '../../plugins/tenant';
import { settleSlug } from './service';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).optional(),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
});

const writeSchema = z.object({
  name: z.string().trim().min(1, 'Give the brand a name.').max(140),
  slug: z.string().trim().max(160).optional(),
  description: z.string().trim().max(5000).nullable().default(null),
  logoUrl: z.string().trim().url('Use a full web address.').max(2000).nullable().default(null),
  websiteUrl: z.string().trim().url('Use a full web address.').max(2000).nullable().default(null),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
  seoTitle: z.string().trim().max(160).nullable().default(null),
  seoDescription: z.string().trim().max(300).nullable().default(null),
});

const patchSchema = writeSchema.partial();

/**
 * Brands — flat, unlike categories, so there is no tree to keep honest here.
 * Read on `brands.view`, every write on `brands.manage`, both enforced in
 * Fastify rather than by hiding a button.
 */
export default async function brandRoutes(app: FastifyInstance) {
  app.get(
    '/brands',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('brands.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const query = parseQuery(listQuerySchema, request.query);

      const filters = [
        query.search
          ? or(ilike(brands.name, `%${query.search}%`), ilike(brands.slug, `%${query.search}%`))
          : undefined,
        query.status === 'all' ? undefined : eq(brands.isActive, query.status === 'active'),
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;

      const rows = await store.db
        .select({
          id: brands.id,
          name: brands.name,
          slug: brands.slug,
          logoUrl: brands.logoUrl,
          websiteUrl: brands.websiteUrl,
          isActive: brands.isActive,
          isFeatured: brands.isFeatured,
          sortOrder: brands.sortOrder,
          createdAt: brands.createdAt,
          productCount: sql<number>`(
            select count(*)::int from ${products} where ${products.brandId} = ${brands.id}
          )`,
        })
        .from(brands)
        .where(where)
        .orderBy(asc(brands.sortOrder), asc(brands.name))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      const [totals] = await store.db.select({ total: count() }).from(brands).where(where);

      return paginated(reply, rows, buildMeta(query.page, query.pageSize, totals?.total ?? 0));
    },
  );

  app.get(
    '/brands/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('brands.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const rows = await store.db.select().from(brands).where(eq(brands.id, id)).limit(1);
      if (!rows[0]) throw notFound('That brand no longer exists.');

      return ok(reply, rows[0]);
    },
  );

  app.post(
    '/brands',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('brands.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(writeSchema, request.body);

      const slug = await settleSlug({
        requested: body.slug,
        from: body.name,
        isTaken: async (candidate) =>
          (await store.db.select({ id: brands.id }).from(brands).where(eq(brands.slug, candidate)).limit(1)).length > 0,
      });

      const [created] = await store.db.insert(brands).values({ ...body, slug }).returning();

      await audit(store.db, request, {
        action: 'brand.create',
        module: 'catalog',
        entity: 'brand',
        entityId: created!.id,
        entityLabel: created!.name,
        newValues: created,
      });

      return ok(reply, created, 201);
    },
  );

  app.patch(
    '/brands/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('brands.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(patchSchema, request.body);

      const existing = (await store.db.select().from(brands).where(eq(brands.id, id)).limit(1))[0];
      if (!existing) throw notFound('That brand no longer exists.');

      // As with categories: a rename does not move the storefront address unless
      // the address itself was the thing being changed.
      const slug =
        body.slug === undefined
          ? existing.slug
          : await settleSlug({
              requested: body.slug,
              from: body.name ?? existing.name,
              isTaken: async (candidate) =>
                (
                  await store.db
                    .select({ id: brands.id })
                    .from(brands)
                    .where(and(eq(brands.slug, candidate), ne(brands.id, id)))
                    .limit(1)
                ).length > 0,
            });

      const [updated] = await store.db
        .update(brands)
        .set({ ...body, slug, updatedAt: new Date() })
        .where(eq(brands.id, id))
        .returning();

      await audit(store.db, request, {
        action: 'brand.update',
        module: 'catalog',
        entity: 'brand',
        entityId: id,
        entityLabel: updated!.name,
        oldValues: existing,
        newValues: updated,
      });

      return ok(reply, updated);
    },
  );

  app.delete(
    '/brands/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('brands.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const existing = (await store.db.select().from(brands).where(eq(brands.id, id)).limit(1))[0];
      if (!existing) throw notFound('That brand no longer exists.');

      // `products.brand_id` is ON DELETE SET NULL — the products stay, they just
      // stop naming a brand.
      const [attachedCount] = await store.db
        .select({ attached: count() })
        .from(products)
        .where(eq(products.brandId, id));

      await store.db.delete(brands).where(eq(brands.id, id));

      await audit(store.db, request, {
        action: 'brand.delete',
        module: 'catalog',
        entity: 'brand',
        entityId: id,
        entityLabel: existing.name,
        oldValues: { ...existing, unbrandedProducts: attachedCount?.attached ?? 0 },
      });

      return noContent(reply);
    },
  );
}

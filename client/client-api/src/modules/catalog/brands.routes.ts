import { and, count, eq, ilike, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { brands, products } from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { cursorField, listed, noContent, ok, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { keyset } from '../../lib/keyset';
import { storeOf } from '../../plugins/tenant';
import { settleSlug } from './service';
import { httpsUrl } from '../../lib/secure-url';

const listQuerySchema = z.object({
  ...cursorField,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).optional(),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
});

const writeSchema = z.object({
  name: z.string().trim().min(1, 'Give the brand a name.').max(140),
  slug: z.string().trim().max(160).optional(),
  description: z.string().trim().max(5000).nullable().default(null),
  logoUrl: httpsUrl().nullable().default(null),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
});

const patchSchema = writeSchema.partial();

/**
 * Every column the panel's brand screen reads. The list returns the whole row
 * rather than a summary because the editor opens from a row already in memory —
 * a second fetch per click would buy nothing on a table measured in dozens, and
 * would make opening the panel wait on the network.
 */
const listColumns = {
  id: brands.id,
  name: brands.name,
  slug: brands.slug,
  description: brands.description,
  logoUrl: brands.logoUrl,
  isActive: brands.isActive,
  isFeatured: brands.isFeatured,
  createdAt: brands.createdAt,
  updatedAt: brands.updatedAt,
} as const;

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

      /*
       * By name, then the id. The id is what makes the order total — two brands
       * may share a name in different case, and without it a batch boundary
       * could drop one brand and repeat another.
       */
      const page = keyset<{ id: string; name: string }>([
        { expr: brands.name, order: 'asc', of: (row) => row.name },
        { expr: brands.id, order: 'asc', of: (row) => row.id },
      ]);

      const seek = page.after(query.cursor);
      const scan = seek ? and(seek, ...filters) : where;

      const rows = await store.db
        .select({
          ...listColumns,
          productCount: sql<number>`(
            select count(*)::int from ${products} where ${products.brandId} = ${brands.id}
          )`,
        })
        .from(brands)
        .where(scan)
        .orderBy(...page.orderBy)
        // One row more than fits, which separates "there is another batch" from
        // "that was the last one" without a second query.
        .limit(query.pageSize + 1)
        .offset(query.cursor ? 0 : (query.page - 1) * query.pageSize);

      const batch = page.batch(rows, query.pageSize);

      // Counted on the first batch only: the scroll shows the figure once, and
      // the count is the half of a list read that cannot stop at `pageSize`.
      const totals = query.cursor
        ? undefined
        : (await store.db.select({ total: count() }).from(brands).where(where))[0];

      return listed(reply, batch.rows, {
        pageSize: query.pageSize,
        nextCursor: batch.nextCursor,
        hasMore: batch.hasMore,
        total: totals?.total,
      });
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
      // Zod 4 applies a field's `.default()` even under `.partial()`, so a key the
      // body omits would come back as its default and overwrite what is stored.
      // Only the keys actually sent are written.
      const sent = (request.body ?? {}) as Record<string, unknown>;
      const body = Object.fromEntries(
        Object.entries(parseBody(patchSchema, request.body)).filter(([key]) => key in sent),
      ) as z.infer<typeof patchSchema>;

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

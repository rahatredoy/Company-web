import { and, asc, count, eq, ilike, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { categories, products } from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { ERROR_CODES, conflict, notFound } from '../../lib/errors';
import { buildMeta, noContent, ok, paginated, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { storeOf } from '../../plugins/tenant';
import { assertParentIsSafe, settleSlug } from './service';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).optional(),
  /** `all` is the panel's default; the storefront only ever wants the active ones. */
  status: z.enum(['all', 'active', 'inactive']).default('all'),
  parentId: z.union([z.string().uuid(), z.literal('root')]).optional(),
});

const writeSchema = z.object({
  name: z.string().trim().min(1, 'Give the category a name.').max(140),
  slug: z.string().trim().max(160).optional(),
  parentId: z.string().uuid('Choose a category that exists.').nullable().default(null),
  description: z.string().trim().max(5000).nullable().default(null),
  imageUrl: z.string().trim().url('Use a full web address.').max(2000).nullable().default(null),
  bannerUrl: z.string().trim().url('Use a full web address.').max(2000).nullable().default(null),
  isActive: z.boolean().default(true),
  showInMenu: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
  seoTitle: z.string().trim().max(160).nullable().default(null),
  seoDescription: z.string().trim().max(300).nullable().default(null),
});

/** Every field optional, but a supplied one must still be valid. */
const patchSchema = writeSchema.partial();

/**
 * Categories — the tree a storefront's navigation is built from.
 *
 * Read is gated on `categories.view` and every write on `categories.manage`,
 * enforced in Fastify rather than by hiding a button: the panel is one build
 * serving every store and the only thing that decides what an admin may do is
 * this guard.
 */
export default async function categoryRoutes(app: FastifyInstance) {
  app.get(
    '/categories',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('categories.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const query = parseQuery(listQuerySchema, request.query);

      const filters = [
        query.search
          ? or(
              ilike(categories.name, `%${query.search}%`),
              ilike(categories.slug, `%${query.search}%`),
            )
          : undefined,
        query.status === 'all' ? undefined : eq(categories.isActive, query.status === 'active'),
        query.parentId === 'root'
          ? sql`${categories.parentId} is null`
          : query.parentId
            ? eq(categories.parentId, query.parentId)
            : undefined,
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;

      // The product tally is what makes a category safe or unsafe to delete, so
      // the list shows it rather than making that a surprise at the last step.
      const rows = await store.db
        .select({
          id: categories.id,
          parentId: categories.parentId,
          name: categories.name,
          slug: categories.slug,
          imageUrl: categories.imageUrl,
          isActive: categories.isActive,
          showInMenu: categories.showInMenu,
          sortOrder: categories.sortOrder,
          createdAt: categories.createdAt,
          productCount: sql<number>`(
            select count(*)::int from ${products} where ${products.categoryId} = ${categories.id}
          )`,
        })
        .from(categories)
        .where(where)
        .orderBy(asc(categories.sortOrder), asc(categories.name))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize);

      const [totals] = await store.db
        .select({ total: count() })
        .from(categories)
        .where(where);

      return paginated(reply, rows, buildMeta(query.page, query.pageSize, totals?.total ?? 0));
    },
  );

  app.get(
    '/categories/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('categories.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const rows = await store.db.select().from(categories).where(eq(categories.id, id)).limit(1);
      if (!rows[0]) throw notFound('That category no longer exists.');

      return ok(reply, rows[0]);
    },
  );

  app.post(
    '/categories',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('categories.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(writeSchema, request.body);

      if (body.parentId) await assertParentIsSafe(store.db, body.parentId);

      const slug = await settleSlug({
        requested: body.slug,
        from: body.name,
        isTaken: async (candidate) =>
          (await store.db.select({ id: categories.id }).from(categories).where(eq(categories.slug, candidate)).limit(1))
            .length > 0,
      });

      const [created] = await store.db.insert(categories).values({ ...body, slug }).returning();

      await audit(store.db, request, {
        action: 'category.create',
        module: 'catalog',
        entity: 'category',
        entityId: created!.id,
        entityLabel: created!.name,
        newValues: created,
      });

      return ok(reply, created, 201);
    },
  );

  app.patch(
    '/categories/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('categories.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(patchSchema, request.body);

      const existing = (await store.db.select().from(categories).where(eq(categories.id, id)).limit(1))[0];
      if (!existing) throw notFound('That category no longer exists.');

      if (body.parentId) await assertParentIsSafe(store.db, body.parentId, id);

      // Only re-derive the slug when the address was actually asked to change.
      // Renaming a live category must not silently move its storefront URL and
      // break every link to it.
      const slug =
        body.slug === undefined
          ? existing.slug
          : await settleSlug({
              requested: body.slug,
              from: body.name ?? existing.name,
              isTaken: async (candidate) =>
                (
                  await store.db
                    .select({ id: categories.id })
                    .from(categories)
                    .where(and(eq(categories.slug, candidate), ne(categories.id, id)))
                    .limit(1)
                ).length > 0,
            });

      const [updated] = await store.db
        .update(categories)
        .set({ ...body, slug, updatedAt: new Date() })
        .where(eq(categories.id, id))
        .returning();

      await audit(store.db, request, {
        action: 'category.update',
        module: 'catalog',
        entity: 'category',
        entityId: id,
        entityLabel: updated!.name,
        oldValues: existing,
        newValues: updated,
      });

      return ok(reply, updated);
    },
  );

  app.delete(
    '/categories/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('categories.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const existing = (await store.db.select().from(categories).where(eq(categories.id, id)).limit(1))[0];
      if (!existing) throw notFound('That category no longer exists.');

      // `parent_id` has no foreign key, so nothing in the database would stop
      // this — the children would simply point at a row that is gone and drop
      // out of the tree with their products still attached.
      const [childCount] = await store.db
        .select({ children: count() })
        .from(categories)
        .where(eq(categories.parentId, id));

      const children = childCount?.children ?? 0;
      if (children > 0) {
        throw conflict(
          `Move or delete the ${children} subcategor${children === 1 ? 'y' : 'ies'} inside this one first.`,
          ERROR_CODES.CATEGORY_HAS_CHILDREN,
        );
      }

      // Products survive: `products.category_id` is ON DELETE SET NULL, so they
      // become uncategorised rather than disappearing with the category. Saying
      // how many is the difference between an informed choice and a shock.
      const [attachedCount] = await store.db
        .select({ attached: count() })
        .from(products)
        .where(eq(products.categoryId, id));

      await store.db.delete(categories).where(eq(categories.id, id));

      await audit(store.db, request, {
        action: 'category.delete',
        module: 'catalog',
        entity: 'category',
        entityId: id,
        entityLabel: existing.name,
        oldValues: { ...existing, uncategorisedProducts: attachedCount?.attached ?? 0 },
      });

      return noContent(reply);
    },
  );
}

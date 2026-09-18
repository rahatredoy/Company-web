import { and, count, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { categories, products } from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { ERROR_CODES, conflict, notFound } from '../../lib/errors';
import { cursorField, listed, noContent, ok, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { keyset } from '../../lib/keyset';
import { storeOf } from '../../plugins/tenant';
import { assertParentIsSafe, settleSlug } from './service';
import { httpsUrlNullable } from '../../lib/secure-url';

const listQuerySchema = z.object({
  ...cursorField,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().trim().max(120).optional(),
  /** `all` is the panel's default; the storefront only ever wants the active ones. */
  status: z.enum(['all', 'active', 'inactive']).default('all'),
  /** `showInMenu` — whether the category is offered in the storefront navigation. */
  visibility: z.enum(['all', 'shown', 'hidden']).default('all'),
  featured: z.enum(['all', 'yes', 'no']).default('all'),
  parentId: z.union([z.string().uuid(), z.literal('root')]).optional(),
});

/**
 * An https address, or nothing.
 *
 * `httpsUrlNullable` carries both halves of that: a form clearing an image sends
 * `""`, which becomes null before validation so "remove the picture" needs no
 * second endpoint — and the scheme is checked, because `z.string().url()` is not
 * a scheme check and accepts `javascript:` (see `lib/secure-url.ts`).
 */
const imageUrlSchema = httpsUrlNullable();

/** Empty-means-null, for the free-text fields. */
const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(max).nullable(),
  );

/**
 * The validators, with no defaults attached.
 *
 * The defaults live on the create schema below and **nowhere else**, because
 * `.partial()` does not remove them: Zod wraps the existing `ZodDefault` in a
 * `ZodOptional`, so an absent key still comes back carrying the default. A patch
 * built that way turns `{ isFeatured: true }` into a full row of defaults and
 * the `UPDATE` that follows quietly empties the image and the SEO fields.
 * Splitting the shapes is what keeps a partial update partial.
 */
const fields = {
  name: z.string().trim().min(1, 'Give the category a name.').max(140),
  slug: z.string().trim().max(160),
  parentId: z.string().uuid('Choose a category that exists.').nullable(),
  imageUrl: imageUrlSchema,
  isActive: z.boolean(),
  showInMenu: z.boolean(),
  isFeatured: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(100_000),
  seoTitle: optionalText(160),
  seoDescription: optionalText(300),
} as const;

/** Creating: everything the row needs, with a sensible value for what was left out. */
const writeSchema = z.object({
  ...fields,
  slug: fields.slug.optional(),
  parentId: fields.parentId.default(null),
  imageUrl: fields.imageUrl.default(null),
  isActive: fields.isActive.default(true),
  showInMenu: fields.showInMenu.default(true),
  isFeatured: fields.isFeatured.default(false),
  /** Absent means "after its siblings" — the handler places it; see POST. */
  sortOrder: fields.sortOrder.optional(),
  seoTitle: fields.seoTitle.default(null),
  seoDescription: fields.seoDescription.default(null),
});

/**
 * Updating: every field optional and **nothing defaulted**, so an absent key
 * stays absent and the `UPDATE` touches only what was actually sent.
 */
const patchSchema = z.object(fields).partial();

const reorderSchema = z.object({
  order: z
    .array(z.object({ id: z.string().uuid(), sortOrder: z.number().int().min(0).max(100_000) }))
    .min(1, 'Nothing to reorder.')
    .max(500),
});

/**
 * Every column the panel's category screen reads. The list returns the whole
 * row rather than a summary because the editor opens from a row that is already
 * in memory — a second fetch per click would buy nothing on a table that is
 * measured in dozens, and would make opening the panel wait on the network.
 */
const listColumns = {
  id: categories.id,
  parentId: categories.parentId,
  name: categories.name,
  slug: categories.slug,
  imageUrl: categories.imageUrl,
  isActive: categories.isActive,
  showInMenu: categories.showInMenu,
  isFeatured: categories.isFeatured,
  sortOrder: categories.sortOrder,
  seoTitle: categories.seoTitle,
  seoDescription: categories.seoDescription,
  createdAt: categories.createdAt,
  updatedAt: categories.updatedAt,
} as const;

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
        query.visibility === 'all' ? undefined : eq(categories.showInMenu, query.visibility === 'shown'),
        query.featured === 'all' ? undefined : eq(categories.isFeatured, query.featured === 'yes'),
        query.parentId === 'root'
          ? sql`${categories.parentId} is null`
          : query.parentId
            ? eq(categories.parentId, query.parentId)
            : undefined,
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;

      /*
       * Author's order, then name, then the id. The id is what makes the order
       * total — a freshly seeded tree shares `sort_order = 0` across every
       * sibling, so without it a cursor would point into a set of rows the
       * database may return in any order, and a batch boundary would drop one
       * category and repeat another.
       */
      const page = keyset<{ id: string; sortOrder: number; name: string }>([
        { expr: categories.sortOrder, order: 'asc', of: (row) => row.sortOrder },
        { expr: categories.name, order: 'asc', of: (row) => row.name },
        { expr: categories.id, order: 'asc', of: (row) => row.id },
      ]);

      const seek = page.after(query.cursor);
      const scan = seek ? and(seek, ...filters) : where;

      // The product tally is what makes a category safe or unsafe to delete, so
      // the list shows it rather than making that a surprise at the last step.
      const rows = await store.db
        .select({
          ...listColumns,
          productCount: sql<number>`(
            select count(*)::int from ${products} where ${products.categoryId} = ${categories.id}
          )`,
        })
        .from(categories)
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
        : (await store.db.select({ total: count() }).from(categories).where(where))[0];

      return listed(reply, batch.rows, {
        pageSize: query.pageSize,
        nextCursor: batch.nextCursor,
        hasMore: batch.hasMore,
        total: totals?.total,
      });
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

      /*
       * The panel no longer asks for a position: a new category goes to the end
       * of its own siblings, and dragging in the list is how it moves. A default
       * of 0 put every new row level with the first one, so it landed wherever
       * its name sorted rather than where it was added.
       */
      const sortOrder =
        body.sortOrder ??
        Math.min(
          100_000,
          (
            await store.db
              .select({ next: sql<number>`coalesce(max(${categories.sortOrder}) + 1, 0)::int` })
              .from(categories)
              .where(body.parentId ? eq(categories.parentId, body.parentId) : isNull(categories.parentId))
          )[0]?.next ?? 0,
        );

      const [created] = await store.db.insert(categories).values({ ...body, slug, sortOrder }).returning();

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

  /*
   * Dragging a row is one write, not one write per row. The panel sends only
   * the siblings whose position actually moved, and they are applied in a
   * single statement so a half-applied order can never be observed — the list
   * is ordered by `sort_order` and a partial reorder reads as rows swapping
   * places on their own.
   *
   * Registered before `/categories/:id` for legibility only; find-my-way
   * matches the static segment ahead of the parametric one regardless.
   */
  app.patch(
    '/categories/reorder',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('categories.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { order } = parseBody(reorderSchema, request.body);

      const ids = order.map((entry) => entry.id);
      const cases = sql.join(
        order.map((entry) => sql`when ${categories.id} = ${entry.id}::uuid then ${entry.sortOrder}`),
        sql` `,
      );

      await store.db
        .update(categories)
        .set({ sortOrder: sql`case ${cases} else ${categories.sortOrder} end`, updatedAt: new Date() })
        .where(inArray(categories.id, ids));

      await audit(store.db, request, {
        action: 'category.reorder',
        module: 'catalog',
        entity: 'category',
        entityId: ids[0]!,
        entityLabel: `${ids.length} categor${ids.length === 1 ? 'y' : 'ies'}`,
        newValues: { order },
      });

      return noContent(reply);
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

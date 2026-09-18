import { and, asc, count, desc, eq, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDb } from '../../db/tenant-manager';
import { z } from 'zod';
import {
  banners,
  categories,
  contactMessages,
  customers,
  orders,
} from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import { ERROR_CODES, notFound, unprocessable } from '../../lib/errors';
import { cursorField, listed, noContent, ok, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { keyset } from '../../lib/keyset';
import { storeOf } from '../../plugins/tenant';
import { httpsUrl, linkTarget } from '../../lib/secure-url';

const pageQuerySchema = z.object({
  ...cursorField,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
});

const bannerSchema = z.object({
  title: z.string().trim().max(160).nullable().default(null),
  subtitle: z.string().trim().max(240).nullable().default(null),
  imageUrl: httpsUrl(),
  mobileImageUrl: httpsUrl().nullable().default(null),
  /**
   * Where the artwork sends a shopper when `categoryId` names no category.
   *
   * `linkTarget` rather than free text: this becomes an `href` on the shop's own
   * homepage, so `javascript:` in it is script served to every visitor under the
   * store's origin — and `//evil.com` is a link off-site wearing a path's
   * clothes. An https address or a `/path`, and nothing else.
   */
  linkUrl: linkTarget().default(null),
  /**
   * The category or subcategory the banner opens, chosen from the panel's
   * picker rather than typed.
   *
   * It outranks `linkUrl`, which is what the panel's other destination mode
   * writes — a shop advertising a category should not have to know that its
   * address is `/category/<slug>`, and a slug that is later renamed moves the
   * banner with it instead of leaving it pointing at a 404.
   */
  categoryId: z.string().uuid('Pick a category from the list.').nullable().default(null),
  buttonLabel: z.string().trim().max(60).nullable().default(null),
  position: z.enum(['home_hero', 'home_promo', 'category_top', 'sidebar', 'popup']).default('home_hero'),
  startsAt: z.coerce.date().nullable().default(null),
  endsAt: z.coerce.date().nullable().default(null),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
});

/**
 * Refuses a banner naming a category that is not in this store's catalogue.
 *
 * The foreign key would refuse it too, but as a 500 with a constraint name in
 * it — the panel's picker is built from this store's own categories, so a body
 * that names anything else is either a stale form or somebody probing, and both
 * deserve the same plain 422 the rest of the form's fields give.
 */
async function assertCategoryExists(db: TenantDb, categoryId: string | null): Promise<void> {
  if (!categoryId) return;

  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);

  if (!row) {
    throw unprocessable('That category no longer exists.', ERROR_CODES.VALIDATION_FAILED, {
      categoryId: ['That category no longer exists.'],
    });
  }
}

/**
 * Banners, the mailing list and contact messages.
 *
 * All share `marketing.view` / `marketing.manage` — there are no per-feature
 * permission keys, and inventing them here would put the API out of step with
 * the seeded permission catalogue every store already has. Discounts are the
 * fourth part of the marketing section and live in `modules/discounts`, because
 * they are an engine rather than a form.
 */
export default async function marketingRoutes(app: FastifyInstance) {
  invalidateStorefrontOnWrite(app);

  // ------------------------------------------------------------- banners ----

  app.get(
    '/banners',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const rows = await store.db
        .select()
        .from(banners)
        .orderBy(asc(banners.position), asc(banners.sortOrder));

      return ok(
        reply,
        rows.map((row) => ({
          ...row,
          startsAt: row.startsAt?.toISOString() ?? null,
          endsAt: row.endsAt?.toISOString() ?? null,
        })),
      );
    },
  );

  /**
   * One banner, whole. `categoryId` is resolved to the category's name and slug
   * because a `category_top` banner that names a raw uuid tells the reader
   * nothing about where it is actually appearing.
   */
  app.get(
    '/banners/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [row] = await store.db
        .select({
          banner: banners,
          categoryName: categories.name,
          categorySlug: categories.slug,
        })
        .from(banners)
        .leftJoin(categories, eq(categories.id, banners.categoryId))
        .where(eq(banners.id, id))
        .limit(1);

      if (!row) throw notFound('That banner does not exist.');

      return ok(reply, {
        ...row.banner,
        startsAt: row.banner.startsAt?.toISOString() ?? null,
        endsAt: row.banner.endsAt?.toISOString() ?? null,
        createdAt: row.banner.createdAt.toISOString(),
        updatedAt: row.banner.updatedAt.toISOString(),
        categoryName: row.categoryName,
        categorySlug: row.categorySlug,
      });
    },
  );

  app.post(
    '/banners',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(bannerSchema, request.body);
      await assertCategoryExists(store.db, body.categoryId);

      const [created] = await store.db.insert(banners).values(body).returning();

      await audit(store.db, request, {
        action: 'banner.create',
        module: 'marketing',
        entity: 'banner',
        entityId: created!.id,
        entityLabel: created!.title ?? 'Banner',
        newValues: created,
      });

      return ok(reply, created, 201);
    },
  );

  app.put(
    '/banners/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(bannerSchema, request.body);
      await assertCategoryExists(store.db, body.categoryId);

      const [updated] = await store.db
        .update(banners)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(banners.id, id))
        .returning();

      if (!updated) throw notFound('That banner does not exist.');

      return ok(reply, updated);
    },
  );

  app.delete(
    '/banners/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [removed] = await store.db
        .delete(banners)
        .where(eq(banners.id, id))
        .returning({ id: banners.id, title: banners.title });

      if (!removed) throw notFound('That banner does not exist.');

      await audit(store.db, request, {
        action: 'banner.delete',
        module: 'marketing',
        entity: 'banner',
        entityId: id,
        entityLabel: removed.title ?? 'Banner',
      });

      return noContent(reply);
    },
  );

  /** Messages sent through the storefront's contact form. */
  app.get(
    '/contact-messages',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const query = parseQuery(pageQuerySchema, request.query);

      const where =
        query.status && query.status !== 'all'
          ? eq(contactMessages.status, query.status as 'new')
          : undefined;

      // Newest first, then the id — the id is what makes the order total, and a
      // cursor into a list with ties names no position.
      const page = keyset<{ id: string; createdAt: Date }>([
        { expr: contactMessages.createdAt, order: 'desc', of: (row) => row.createdAt },
        { expr: contactMessages.id, order: 'desc', of: (row) => row.id },
      ]);

      const seek = page.after(query.cursor);
      const scan = where && seek ? and(where, seek) : (seek ?? where);

      const [rows, tally] = await Promise.all([
        store.db
          .select()
          .from(contactMessages)
          .where(scan)
          .orderBy(...page.orderBy)
          // One row more than fits, which separates "there is another batch"
          // from "that was the last one" without a second query.
          .limit(query.pageSize + 1)
          .offset(query.cursor ? 0 : (query.page - 1) * query.pageSize),

        // Counted on the first batch only: the scroll shows the figure once, and
        // the count is the half of a list read that cannot stop at `pageSize`.
        query.cursor ? undefined : store.db.select({ total: count() }).from(contactMessages).where(where),
      ]);

      const batch = page.batch(rows, query.pageSize);

      return listed(
        reply,
        batch.rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        {
          pageSize: query.pageSize,
          nextCursor: batch.nextCursor,
          hasMore: batch.hasMore,
          total: tally ? Number(tally[0]?.total ?? 0) : undefined,
        },
      );
    },
  );

  /**
   * One message, whole.
   *
   * The row already holds everything the form captured, `ipAddress` included —
   * which the list deliberately does not show and this does, because it is what
   * separates one person writing twice from a form being scripted.
   *
   * The contact form does not require an account, so the sender is matched to
   * one by email if there is one. That is a lookup, not a link: the message
   * stores no `customer_id`, and an address that matches today may not have when
   * the message was sent.
   */
  app.get(
    '/contact-messages/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [message] = await store.db
        .select()
        .from(contactMessages)
        .where(eq(contactMessages.id, id))
        .limit(1);

      if (!message) throw notFound('That message does not exist.');

      const [account] = await store.db
        .select({
          id: customers.id,
          fullName: customers.fullName,
          email: customers.email,
          status: customers.status,
          createdAt: customers.createdAt,
          orderCount: sql<number>`(
            select count(*)::int from ${orders} o where o.customer_id = ${customers.id}
          )`,
        })
        .from(customers)
        .where(eq(customers.email, message.email))
        .limit(1);

      return ok(reply, {
        ...message,
        createdAt: message.createdAt.toISOString(),
        repliedAt: message.repliedAt?.toISOString() ?? null,
        account: account
          ? { ...account, createdAt: account.createdAt.toISOString(), orderCount: Number(account.orderCount) }
          : null,
      });
    },
  );
}

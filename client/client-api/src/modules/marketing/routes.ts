import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { TenantDb } from '../../db/tenant-manager';
import { z } from 'zod';
import {
  banners,
  categories,
  contactMessages,
  couponRedemptions,
  coupons,
  customers,
  newsletterSubscribers,
  orders,
} from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import { ERROR_CODES, conflict, notFound, unprocessable } from '../../lib/errors';
import { cursorField, listed, noContent, ok, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { keyset } from '../../lib/keyset';
import { moneySchema } from '../../lib/validation';
import { storeOf } from '../../plugins/tenant';

const pageQuerySchema = z.object({
  ...cursorField,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
});

const couponSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(3, 'Use at least three characters.')
    .max(40)
    .regex(/^[A-Z0-9-]+$/, 'Letters, numbers and dashes only.'),
  description: z.string().trim().max(200).nullable().default(null),
  type: z.enum(['percentage', 'fixed', 'free_shipping']).default('percentage'),
  value: moneySchema,
  maxDiscountAmount: moneySchema.nullable().default(null),
  minOrderAmount: moneySchema.nullable().default(null),
  usageLimit: z.coerce.number().int().min(1).max(1_000_000).nullable().default(null),
  perCustomerLimit: z.coerce.number().int().min(1).max(1000).nullable().default(null),
  startsAt: z.coerce.date().nullable().default(null),
  endsAt: z.coerce.date().nullable().default(null),
  status: z.enum(['active', 'scheduled', 'expired', 'disabled']).default('active'),
});

const bannerSchema = z.object({
  title: z.string().trim().max(160).nullable().default(null),
  subtitle: z.string().trim().max(240).nullable().default(null),
  imageUrl: z.string().trim().url('Use a full web address.').max(2000),
  mobileImageUrl: z.string().trim().url('Use a full web address.').max(2000).nullable().default(null),
  linkUrl: z.string().trim().max(2000).nullable().default(null),
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
 * Coupons, banners and the mailing list.
 *
 * All three share `marketing.view` / `marketing.manage` — there are no
 * per-feature permission keys, and inventing them here would put the API out of
 * step with the seeded permission catalogue every store already has.
 *
 * A coupon's rules are read at checkout by `applyCoupon`, so every field on this
 * form eventually decides what somebody pays. `used_count` is not editable: it
 * is incremented inside the order transaction and is the only honest record of
 * how often a code has been claimed.
 */
export default async function marketingRoutes(app: FastifyInstance) {
  invalidateStorefrontOnWrite(app);

  // ------------------------------------------------------------- coupons ----

  app.get(
    '/coupons',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const query = parseQuery(pageQuerySchema, request.query);

      const filters = [
        query.search ? or(ilike(coupons.code, `%${query.search}%`), ilike(coupons.description, `%${query.search}%`)) : undefined,
        query.status && query.status !== 'all' ? eq(coupons.status, query.status as 'active') : undefined,
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;

      // Newest first, then the id — the id is what makes the order total, and a
      // cursor into a list with ties names no position.
      const page = keyset<{ id: string; createdAt: Date }>([
        { expr: coupons.createdAt, order: 'desc', of: (row) => row.createdAt },
        { expr: coupons.id, order: 'desc', of: (row) => row.id },
      ]);

      const seek = page.after(query.cursor);
      const scan = seek ? and(seek, ...filters) : where;

      const [rows, tally] = await Promise.all([
        store.db
          .select()
          .from(coupons)
          .where(scan)
          .orderBy(...page.orderBy)
          // One row more than fits, which separates "there is another batch"
          // from "that was the last one" without a second query.
          .limit(query.pageSize + 1)
          .offset(query.cursor ? 0 : (query.page - 1) * query.pageSize),

        // Counted on the first batch only: the scroll shows the figure once, and
        // the count is the half of a list read that cannot stop at `pageSize`.
        query.cursor ? undefined : store.db.select({ total: count() }).from(coupons).where(where),
      ]);

      const batch = page.batch(rows, query.pageSize);

      return listed(
        reply,
        batch.rows.map((row) => ({
          ...row,
          startsAt: row.startsAt?.toISOString() ?? null,
          endsAt: row.endsAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
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
   * One coupon, whole — every column of the row plus the ledger behind
   * `used_count`.
   *
   * The count on the row is the figure checkout enforces the limit against; the
   * redemptions are what it is made of, and the two are worth showing together
   * because they are the only way to tell a code that was used a hundred times
   * by a hundred people from one used a hundred times by one. `targetIds` is
   * resolved to nothing here on purpose — it names products *or* categories
   * depending on `scope`, and the panel knows which.
   */
  app.get(
    '/coupons/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [coupon] = await store.db.select().from(coupons).where(eq(coupons.id, id)).limit(1);
      if (!coupon) throw notFound('That coupon does not exist.');

      const [redemptions, tally] = await Promise.all([
        store.db
          .select({
            id: couponRedemptions.id,
            orderId: couponRedemptions.orderId,
            orderNumber: orders.orderNumber,
            orderStatus: orders.status,
            customerId: couponRedemptions.customerId,
            customerName: customers.fullName,
            email: couponRedemptions.email,
            discountAmount: couponRedemptions.discountAmount,
            createdAt: couponRedemptions.createdAt,
          })
          .from(couponRedemptions)
          .leftJoin(orders, eq(orders.id, couponRedemptions.orderId))
          .leftJoin(customers, eq(customers.id, couponRedemptions.customerId))
          .where(eq(couponRedemptions.couponId, id))
          .orderBy(desc(couponRedemptions.createdAt))
          .limit(50),

        store.db
          .select({
            total: count(),
            discounted: sql<string>`coalesce(sum(${couponRedemptions.discountAmount}), 0)::text`,
          })
          .from(couponRedemptions)
          .where(eq(couponRedemptions.couponId, id)),
      ]);

      return ok(reply, {
        ...coupon,
        startsAt: coupon.startsAt?.toISOString() ?? null,
        endsAt: coupon.endsAt?.toISOString() ?? null,
        createdAt: coupon.createdAt.toISOString(),
        updatedAt: coupon.updatedAt.toISOString(),
        /** How much this code has actually given away, and over how many orders. */
        redemptionCount: Number(tally[0]?.total ?? 0),
        totalDiscounted: tally[0]?.discounted ?? '0',
        redemptions: redemptions.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
      });
    },
  );

  app.post(
    '/coupons',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(couponSchema, request.body);

      const [clash] = await store.db
        .select({ id: coupons.id })
        .from(coupons)
        .where(eq(sql`upper(${coupons.code})`, body.code))
        .limit(1);

      if (clash) throw conflict('That code is already in use.', ERROR_CODES.COUPON_CODE_TAKEN);

      const [created] = await store.db.insert(coupons).values(body).returning();

      await audit(store.db, request, {
        action: 'coupon.create',
        module: 'marketing',
        entity: 'coupon',
        entityId: created!.id,
        entityLabel: created!.code,
        newValues: created,
      });

      return ok(reply, created, 201);
    },
  );

  app.put(
    '/coupons/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(couponSchema, request.body);

      const [clash] = await store.db
        .select({ id: coupons.id })
        .from(coupons)
        .where(and(eq(sql`upper(${coupons.code})`, body.code), sql`${coupons.id} <> ${id}`))
        .limit(1);

      if (clash) throw conflict('That code is already in use.', ERROR_CODES.COUPON_CODE_TAKEN);

      const [updated] = await store.db
        .update(coupons)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(coupons.id, id))
        .returning();

      if (!updated) throw notFound('That coupon does not exist.');

      return ok(reply, updated);
    },
  );

  app.delete(
    '/coupons/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [existing] = await store.db
        .select({ id: coupons.id, code: coupons.code, usedCount: coupons.usedCount })
        .from(coupons)
        .where(eq(coupons.id, id))
        .limit(1);

      if (!existing) throw notFound('That coupon does not exist.');

      /*
       * A code that has been used is disabled, not deleted: `coupon_redemptions`
       * points at it and those rows are how an order's discount is explained
       * afterwards. Same reasoning as archiving a product that has sold.
       */
      if (existing.usedCount > 0) {
        const [disabled] = await store.db
          .update(coupons)
          .set({ status: 'disabled', updatedAt: new Date() })
          .where(eq(coupons.id, id))
          .returning();

        return ok(reply, {
          deleted: false,
          coupon: disabled,
          message: 'This code has been used, so it was switched off instead of deleted.',
        });
      }

      await store.db.delete(coupons).where(eq(coupons.id, id));

      await audit(store.db, request, {
        action: 'coupon.delete',
        module: 'marketing',
        entity: 'coupon',
        entityId: id,
        entityLabel: existing.code,
      });

      return noContent(reply);
    },
  );

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

  // ---------------------------------------------------------- newsletter ----

  app.get(
    '/newsletter',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const query = parseQuery(pageQuerySchema, request.query);

      const filters = [
        query.search ? ilike(newsletterSubscribers.email, `%${query.search}%`) : undefined,
        query.status && query.status !== 'all'
          ? eq(newsletterSubscribers.status, query.status as 'subscribed')
          : undefined,
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;

      // Newest first, then the id — the id is what makes the order total, and a
      // cursor into a list with ties names no position. A bulk import stamps
      // hundreds of subscribers with the same second, so the ties are real here.
      const page = keyset<{ id: string; subscribedAt: Date }>([
        { expr: newsletterSubscribers.subscribedAt, order: 'desc', of: (row) => row.subscribedAt },
        { expr: newsletterSubscribers.id, order: 'desc', of: (row) => row.id },
      ]);

      const seek = page.after(query.cursor);
      const scan = seek ? and(seek, ...filters) : where;

      const [rows, tally] = await Promise.all([
        store.db
          .select({
            id: newsletterSubscribers.id,
            email: newsletterSubscribers.email,
            status: newsletterSubscribers.status,
            source: newsletterSubscribers.source,
            subscribedAt: newsletterSubscribers.subscribedAt,
            unsubscribedAt: newsletterSubscribers.unsubscribedAt,
          })
          .from(newsletterSubscribers)
          .where(scan)
          .orderBy(...page.orderBy)
          // One row more than fits, which separates "there is another batch"
          // from "that was the last one" without a second query.
          .limit(query.pageSize + 1)
          .offset(query.cursor ? 0 : (query.page - 1) * query.pageSize),

        // Counted on the first batch only: the scroll shows the figure once, and
        // the count is the half of a list read that cannot stop at `pageSize`.
        query.cursor
          ? undefined
          : store.db.select({ total: count() }).from(newsletterSubscribers).where(where),
      ]);

      const batch = page.batch(rows, query.pageSize);

      return listed(
        reply,
        batch.rows.map((row) => ({
          ...row,
          subscribedAt: row.subscribedAt.toISOString(),
          unsubscribedAt: row.unsubscribedAt?.toISOString() ?? null,
        })),
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
   * One subscriber, whole.
   *
   * Every column bar `unsubscribe_token_hash`, which is a credential: it is the
   * single-use secret in the unsubscribe link, and a panel that displays it
   * hands whoever is reading the screen the ability to unsubscribe that address
   * without ever seeing the mailbox. Whether one *exists* is worth knowing, so
   * that is reported as a flag instead.
   *
   * The linked account is joined in because a subscriber row that names a
   * `customer_id` is a shopper, not just an address, and the difference decides
   * what may be sent to them.
   */
  app.get(
    '/newsletter/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [row] = await store.db
        .select({
          id: newsletterSubscribers.id,
          email: newsletterSubscribers.email,
          status: newsletterSubscribers.status,
          customerId: newsletterSubscribers.customerId,
          source: newsletterSubscribers.source,
          subscribedAt: newsletterSubscribers.subscribedAt,
          unsubscribedAt: newsletterSubscribers.unsubscribedAt,
          hasUnsubscribeToken: sql<boolean>`${newsletterSubscribers.unsubscribeTokenHash} is not null`,
          customerName: customers.fullName,
          customerEmail: customers.email,
          customerStatus: customers.status,
          acceptsMarketing: customers.acceptsMarketing,
        })
        .from(newsletterSubscribers)
        .leftJoin(customers, eq(customers.id, newsletterSubscribers.customerId))
        .where(eq(newsletterSubscribers.id, id))
        .limit(1);

      if (!row) throw notFound('That subscriber does not exist.');

      return ok(reply, {
        ...row,
        subscribedAt: row.subscribedAt.toISOString(),
        unsubscribedAt: row.unsubscribedAt?.toISOString() ?? null,
      });
    },
  );

  /**
   * Removing someone from the list.
   *
   * Marked unsubscribed rather than deleted, deliberately: a deleted row means
   * the next import or signup form silently re-adds them, and "I asked you to
   * stop" is the one instruction a mailing list must not lose.
   */
  app.delete(
    '/newsletter/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [updated] = await store.db
        .update(newsletterSubscribers)
        .set({ status: 'unsubscribed', unsubscribedAt: new Date() })
        .where(eq(newsletterSubscribers.id, id))
        .returning({ id: newsletterSubscribers.id, email: newsletterSubscribers.email });

      if (!updated) throw notFound('That subscriber does not exist.');

      await audit(store.db, request, {
        action: 'newsletter.unsubscribe',
        module: 'marketing',
        entity: 'subscriber',
        entityId: id,
        entityLabel: updated.email,
      });

      return ok(reply, { unsubscribed: true });
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

import { and, asc, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { banners, contactMessages, coupons, newsletterSubscribers } from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import { ERROR_CODES, conflict, notFound } from '../../lib/errors';
import { buildMeta, noContent, ok, paginated, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { moneySchema } from '../../lib/validation';
import { storeOf } from '../../plugins/tenant';

const pageQuerySchema = z.object({
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
  buttonLabel: z.string().trim().max(60).nullable().default(null),
  position: z.enum(['home_hero', 'home_promo', 'category_top', 'sidebar', 'popup']).default('home_hero'),
  startsAt: z.coerce.date().nullable().default(null),
  endsAt: z.coerce.date().nullable().default(null),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100_000).default(0),
});

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

      const [rows, tally] = await Promise.all([
        store.db
          .select()
          .from(coupons)
          .where(where)
          .orderBy(desc(coupons.createdAt))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        store.db.select({ total: count() }).from(coupons).where(where),
      ]);

      return paginated(
        reply,
        rows.map((row) => ({
          ...row,
          startsAt: row.startsAt?.toISOString() ?? null,
          endsAt: row.endsAt?.toISOString() ?? null,
          createdAt: row.createdAt.toISOString(),
        })),
        buildMeta(query.page, query.pageSize, Number(tally[0]?.total ?? 0)),
      );
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

  app.post(
    '/banners',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('marketing.manage')] },
    async (request, reply) => {
      const store = storeOf(request);
      const body = parseBody(bannerSchema, request.body);
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
          .where(where)
          .orderBy(desc(newsletterSubscribers.subscribedAt))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        store.db.select({ total: count() }).from(newsletterSubscribers).where(where),
      ]);

      return paginated(
        reply,
        rows.map((row) => ({
          ...row,
          subscribedAt: row.subscribedAt.toISOString(),
          unsubscribedAt: row.unsubscribedAt?.toISOString() ?? null,
        })),
        buildMeta(query.page, query.pageSize, Number(tally[0]?.total ?? 0)),
      );
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

      const [rows, tally] = await Promise.all([
        store.db
          .select()
          .from(contactMessages)
          .where(where)
          .orderBy(desc(contactMessages.createdAt))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),
        store.db.select({ total: count() }).from(contactMessages).where(where),
      ]);

      return paginated(
        reply,
        rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        buildMeta(query.page, query.pageSize, Number(tally[0]?.total ?? 0)),
      );
    },
  );
}

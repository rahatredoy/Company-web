import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  customerAddresses,
  customers,
  orders,
  reviews,
  wishlistItems,
  wishlists,
} from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { notFound } from '../../lib/errors';
import { cursorField, listed, ok, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { keyset } from '../../lib/keyset';
import { listCustomerSessions, revokeAllCustomerSessions } from '../../lib/session';
import { loadStoreCurrency } from '../../lib/store-currency';
import { storeOf } from '../../plugins/tenant';

const listQuerySchema = z.object({
  ...cursorField,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.enum(['all', 'active', 'blocked']).default('all'),
  sort: z.enum(['createdAt', 'fullName', 'totalSpent']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const patchSchema = z.object({
  status: z.enum(['active', 'blocked']).optional(),
  /**
   * The group a discount can be aimed at. Set by the owner: nothing derives it
   * from order history yet, so a VIP offer reaches exactly the customers the
   * owner has marked VIP.
   */
  customerType: z.enum(['new', 'repeat', 'vip', 'high_value']).optional(),
  adminNote: z.string().trim().max(4000).nullable().optional(),
  acceptsMarketing: z.boolean().optional(),
});

/**
 * The customer list.
 *
 * Read and annotate only. There is no create — an account is made by the person
 * it belongs to — and no delete, because order history points at these rows and
 * a shop that can erase a customer can erase its own books. Blocking is the
 * lever: it stops a sign-in without touching anything that was already bought.
 *
 * `password_hash` is never selected anywhere here — it is the credential itself,
 * and a spread would eventually leak it. The lockout columns are a different
 * thing and the detail endpoint *does* return them: "why can this person not
 * sign in" is a question the shop gets asked and cannot otherwise answer, and a
 * failed-attempt count is a fact about an account rather than a secret held in
 * it.
 */
export default async function customerRoutes(app: FastifyInstance) {
  app.get(
    '/customers',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('customers.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const query = parseQuery(listQuerySchema, request.query);

      const filters = [
        query.search
          ? or(
              ilike(customers.fullName, `%${query.search}%`),
              ilike(customers.email, `%${query.search}%`),
              ilike(customers.phone, `%${query.search}%`),
            )
          : undefined,
        query.status === 'all' ? undefined : eq(customers.status, query.status),
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;
      const currency = await loadStoreCurrency(store);

      // Spend and order count come from `orders` rather than `customer_stats`,
      // which is a rollup nothing maintains yet — a figure that is stale is
      // worse than one that costs a subquery. Only orders in the store's
      // current currency are added: the panel prints the sum with its symbol.
      const spent = sql<string>`(
        select coalesce(sum(o.grand_total), 0)::text from ${orders} o
        where o.customer_id = ${customers.id} and o.status not in ('cancelled', 'failed')
          and o.currency = ${currency}
      )`;

      /*
       * The chosen column, then the id. The id is what makes the order total: two
       * customers who registered in the same millisecond have no order between
       * them, and a cursor into a list with ties names no position — one would
       * arrive in two batches and the other in none.
       *
       * `totalSpent` is compared as the same coalesced subquery the `ORDER BY`
       * uses, so the seek and the sort can never disagree.
       */
      const page = keyset<{ id: string; createdAt: Date; fullName: string; totalSpent: string }>([
        {
          expr: query.sort === 'totalSpent' ? spent : customers[query.sort],
          order: query.order,
          of: (row) => row[query.sort],
        },
        { expr: customers.id, order: query.order, of: (row) => row.id },
      ]);

      const seek = page.after(query.cursor);
      const scan = seek ? and(seek, ...filters) : where;

      const [rows, tally] = await Promise.all([
        store.db
          .select({
            id: customers.id,
            fullName: customers.fullName,
            email: customers.email,
            phone: customers.phone,
            status: customers.status,
            customerType: customers.customerType,
            acceptsMarketing: customers.acceptsMarketing,
            createdAt: customers.createdAt,
            lastLoginAt: customers.lastLoginAt,
            orderCount: sql<number>`(
              select count(*)::int from ${orders} o where o.customer_id = ${customers.id}
            )`,
            totalSpent: spent,
          })
          .from(customers)
          .where(scan)
          .orderBy(...page.orderBy)
          // One row more than fits, which separates "there is another batch"
          // from "that was the last one" without a second query.
          .limit(query.pageSize + 1)
          .offset(query.cursor ? 0 : (query.page - 1) * query.pageSize),

        // Counted on the first batch only: the scroll shows the figure once, and
        // the count is the half of a list read that cannot stop at `pageSize`.
        query.cursor ? undefined : store.db.select({ total: count() }).from(customers).where(where),
      ]);

      const batch = page.batch(rows, query.pageSize);

      return listed(
        reply,
        batch.rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
          orderCount: Number(row.orderCount),
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

  app.get(
    '/customers/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('customers.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      /*
       * Every column but the password hash, named one by one rather than taken
       * with a spread — a spread over `customers` would pick up `password_hash`
       * the moment anybody adds a column, and a leak that arrives by refactor is
       * the kind nobody reviews.
       */
      const [customer] = await store.db
        .select({
          id: customers.id,
          email: customers.email,
          fullName: customers.fullName,
          phone: customers.phone,
          status: customers.status,
          customerType: customers.customerType,
          birthDate: customers.birthDate,
          emailVerifiedAt: customers.emailVerifiedAt,
          acceptsMarketing: customers.acceptsMarketing,
          failedLoginCount: customers.failedLoginCount,
          lockedUntil: customers.lockedUntil,
          lastLoginAt: customers.lastLoginAt,
          lastLoginIp: customers.lastLoginIp,
          passwordChangedAt: customers.passwordChangedAt,
          /** Whether they can sign in at all — an account with none cannot. */
          hasPassword: sql<boolean>`${customers.passwordHash} is not null`,
          adminNote: customers.adminNote,
          createdAt: customers.createdAt,
          updatedAt: customers.updatedAt,
        })
        .from(customers)
        .where(eq(customers.id, id))
        .limit(1);

      if (!customer) throw notFound('That customer does not exist.');

      const currency = await loadStoreCurrency(store);

      const [customerOrders, addresses, tally, sessions, reviewTally, wishlist] = await Promise.all([
        store.db
          .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            status: orders.status,
            paymentStatus: orders.paymentStatus,
            itemCount: sql<number>`(
              select coalesce(sum(oi.quantity), 0)::int from order_items oi where oi.order_id = ${orders.id}
            )`,
            grandTotal: orders.grandTotal,
            refundedTotal: orders.refundedTotal,
            currency: orders.currency,
            placedAt: orders.placedAt,
          })
          .from(orders)
          .where(eq(orders.customerId, id))
          .orderBy(desc(orders.placedAt))
          .limit(50),

        store.db
          .select()
          .from(customerAddresses)
          .where(eq(customerAddresses.customerId, id))
          .orderBy(desc(customerAddresses.isDefault)),

        // Counted on the same basis as the list's columns: a cancelled or failed
        // order is still an order placed, but is not money the shop took — and
        // an order in a currency the store no longer trades in is still an
        // order, but not one whose total can be added to today's.
        store.db
          .select({
            orderCount: count(),
            totalSpent: sql<string>`coalesce(sum(${orders.grandTotal}) filter (
              where ${orders.status} not in ('cancelled', 'failed') and ${orders.currency} = ${currency}
            ), 0)::text`,
            refunded: sql<string>`coalesce(sum(${orders.refundedTotal}) filter (
              where ${orders.currency} = ${currency}
            ), 0)::text`,
            firstOrderAt: sql<string | null>`min(${orders.placedAt})::text`,
            lastOrderAt: sql<string | null>`max(${orders.placedAt})::text`,
          })
          .from(orders)
          .where(eq(orders.customerId, id)),

        /*
         * Where they are signed in.
         *
         * Read from the session records rather than a table: a JWT is not
         * written down anywhere, so the Redis record its `jti` names is the only
         * thing that knows a login exists. Nothing here is a credential — the
         * token is not stored in any form, so unlike the column this replaced
         * there is nothing to remember to leave out.
         *
         * Only live sessions can come back, so there is no revoked state to
         * report: a revoked session is a deleted record.
         */
        listCustomerSessions(store.tenantRef, id),

        store.db.select({ total: count() }).from(reviews).where(eq(reviews.customerId, id)),

        store.db
          .select({ total: count() })
          .from(wishlistItems)
          .innerJoin(wishlists, eq(wishlists.id, wishlistItems.wishlistId))
          .where(eq(wishlists.customerId, id)),
      ]);

      const stats = tally[0];

      return ok(reply, {
        ...customer,
        emailVerified: customer.emailVerifiedAt !== null,
        emailVerifiedAt: customer.emailVerifiedAt?.toISOString() ?? null,
        lockedUntil: customer.lockedUntil?.toISOString() ?? null,
        lastLoginAt: customer.lastLoginAt?.toISOString() ?? null,
        passwordChangedAt: customer.passwordChangedAt?.toISOString() ?? null,
        createdAt: customer.createdAt.toISOString(),
        updatedAt: customer.updatedAt.toISOString(),
        /** Locked *now*, rather than a timestamp the reader has to compare. */
        isLocked: customer.lockedUntil !== null && customer.lockedUntil.getTime() > Date.now(),
        stats: {
          orderCount: Number(stats?.orderCount ?? 0),
          totalSpent: stats?.totalSpent ?? '0',
          refundedTotal: stats?.refunded ?? '0',
          firstOrderAt: stats?.firstOrderAt ? new Date(stats.firstOrderAt).toISOString() : null,
          lastOrderAt: stats?.lastOrderAt ? new Date(stats.lastOrderAt).toISOString() : null,
          reviewCount: Number(reviewTally[0]?.total ?? 0),
          wishlistCount: Number(wishlist[0]?.total ?? 0),
        },
        orders: customerOrders.map((order) => ({
          ...order,
          itemCount: Number(order.itemCount),
          placedAt: order.placedAt.toISOString(),
        })),
        addresses: addresses.map((address) => ({
          ...address,
          createdAt: address.createdAt.toISOString(),
          updatedAt: address.updatedAt.toISOString(),
        })),
        sessions: sessions.slice(0, 10).map((session) => ({
          id: session.id,
          ipAddress: session.ip,
          userAgent: session.ua,
          remember: session.remember,
          lastSeenAt: session.lastSeenAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          revokedAt: null,
          createdAt: session.createdAt.toISOString(),
        })),
      });
    },
  );

  app.patch(
    '/customers/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('customers.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(patchSchema, request.body);

      const [existing] = await store.db
        .select({ id: customers.id, status: customers.status, email: customers.email })
        .from(customers)
        .where(eq(customers.id, id))
        .limit(1);

      if (!existing) throw notFound('That customer does not exist.');

      const [updated] = await store.db
        .update(customers)
        .set({
          ...(body.status === undefined ? {} : { status: body.status }),
          ...(body.customerType === undefined ? {} : { customerType: body.customerType }),
          ...(body.adminNote === undefined ? {} : { adminNote: body.adminNote }),
          ...(body.acceptsMarketing === undefined ? {} : { acceptsMarketing: body.acceptsMarketing }),
          updatedAt: new Date(),
        })
        .where(eq(customers.id, id))
        .returning({
          id: customers.id,
          status: customers.status,
          customerType: customers.customerType,
          adminNote: customers.adminNote,
          acceptsMarketing: customers.acceptsMarketing,
        });

      /*
       * Blocking signs them out everywhere. Leaving a live session behind means
       * the block does not take effect until the cookie happens to expire, which
       * is the opposite of what whoever pressed it expected.
       */
      if (body.status === 'blocked' && existing.status !== 'blocked') {
        await revokeAllCustomerSessions(store.tenantRef, id);
      }

      await audit(store.db, request, {
        action: 'customer.update',
        module: 'customers',
        entity: 'customer',
        entityId: id,
        entityLabel: existing.email ?? existing.id,
        oldValues: { status: existing.status },
        newValues: updated,
      });

      return ok(reply, updated);
    },
  );
}

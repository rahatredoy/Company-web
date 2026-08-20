import { and, asc, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  customers,
  orderAddresses,
  orderItems,
  orderStatusHistory,
  orders,
  payments,
  refunds,
  returns,
  shipments,
  storeSettings,
} from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import type { OrderStatus } from '../../lib/constants';
import { ORDER_STATUSES, ORDER_TRANSITIONS } from '../../lib/constants';
import { ERROR_CODES, conflict, notFound } from '../../lib/errors';
import { cursorField, listed, ok, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { keyset } from '../../lib/keyset';
import { releaseOrderStock } from '../storefront/orders.routes';
import { fulfilOrderStock } from './service';
import { storeOf } from '../../plugins/tenant';

const listQuerySchema = z.object({
  ...cursorField,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  paymentStatus: z.string().trim().max(40).optional(),
  /**
   * A **date**, not a timestamp: the panel's range picker deals in days, and
   * `to` is read inclusively (below, `< to + 1 day`) so "1st to 1st" is that day
   * rather than nothing at all.
   */
  from: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').optional(),
  to: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.').optional(),
  /** Orders whose status still asks something of the shop. */
  needsAction: z.enum(['all', 'yes']).default('all'),
  sort: z.enum(['placedAt', 'grandTotal', 'orderNumber']).default('placedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

/**
 * The statuses that are still the shop's problem: a customer has ordered and
 * nothing has left the building yet. Shared by the list's `needsAction` filter
 * and the tally, so the count and the rows behind it can never disagree.
 */
const OPEN_STATUSES = ['new', 'pending', 'confirmed', 'processing', 'packed'] as const;

/** Money that counts as taken. Cancelled and failed orders are not revenue. */
const COUNTED = sql`${orders.status} not in ('cancelled', 'failed')`;

const statusSchema = z.object({
  status: z.enum(ORDER_STATUSES as unknown as [OrderStatus, ...OrderStatus[]]),
  note: z.string().trim().max(300).optional(),
});

const shipmentSchema = z.object({
  carrier: z.string().trim().max(80).nullable().default(null),
  trackingNumber: z.string().trim().max(120).nullable().default(null),
  trackingUrl: z.string().trim().url('Use a full web address.').max(2000).nullable().default(null),
  note: z.string().trim().max(300).nullable().default(null),
});

const noteSchema = z.object({ adminNote: z.string().trim().max(4000).nullable().default(null) });

const SORTABLE = {
  placedAt: orders.placedAt,
  grandTotal: orders.grandTotal,
  orderNumber: orders.orderNumber,
} as const;

/**
 * Orders, from the shop's side.
 *
 * The status column is not free-form: `ORDER_TRANSITIONS` in `lib/constants.ts`
 * is the only map of what may follow what, and it is checked here rather than in
 * the panel. A dropdown that offers the wrong option is a UI bug; an API that
 * accepts it is a shop that can mark an unpaid order delivered.
 */
export default async function orderRoutes(app: FastifyInstance) {
  invalidateStorefrontOnWrite(app);

  app.get(
    '/orders',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('orders.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const query = parseQuery(listQuerySchema, request.query);

      const filters = [
        query.search
          ? or(
              ilike(orders.orderNumber, `%${query.search}%`),
              ilike(orders.email, `%${query.search}%`),
              ilike(orders.customerName, `%${query.search}%`),
              ilike(orders.phone, `%${query.search}%`),
            )
          : undefined,
        query.status && query.status !== 'all'
          ? eq(orders.status, query.status as OrderStatus)
          : undefined,
        query.paymentStatus && query.paymentStatus !== 'all'
          ? sql`${orders.paymentStatus}::text = ${query.paymentStatus}`
          : undefined,
        query.needsAction === 'yes'
          ? inArray(orders.status, OPEN_STATUSES as unknown as OrderStatus[])
          : undefined,
        query.from ? sql`${orders.placedAt} >= ${query.from}::date` : undefined,
        // Inclusive of `to`: a range picker means whole days, so the boundary is
        // the start of the next one rather than midnight on the day itself.
        query.to ? sql`${orders.placedAt} < (${query.to}::date + interval '1 day')` : undefined,
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;

      /*
       * The chosen column, then the id — the id is what makes the order total.
       * Two orders placed in the same millisecond have no order between them,
       * and a cursor into a list with ties names no position: one of them would
       * arrive in two batches and the other in none.
       */
      const page = keyset<{ id: string; placedAt: Date; grandTotal: string; orderNumber: string }>([
        { expr: SORTABLE[query.sort], order: query.order, of: (row) => row[query.sort] },
        { expr: orders.id, order: query.order, of: (row) => row.id },
      ]);

      const seek = page.after(query.cursor);
      const scan = seek ? and(seek, ...filters) : where;

      const [rows, tally] = await Promise.all([
        store.db
          .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            customerId: orders.customerId,
            customerName: orders.customerName,
            email: orders.email,
            phone: orders.phone,
            status: orders.status,
            paymentStatus: orders.paymentStatus,
            shippingStatus: orders.shippingStatus,
            paymentProvider: orders.paymentProvider,
            grandTotal: orders.grandTotal,
            currency: orders.currency,
            placedAt: orders.placedAt,
            itemCount: sql<number>`(
              select coalesce(sum(oi.quantity), 0)::int
              from ${orderItems} oi where oi.order_id = ${orders.id}
            )`,
          })
          .from(orders)
          .where(scan)
          .orderBy(...page.orderBy)
          // One row more than fits, which separates "there is another batch"
          // from "that was the last one" without a second query.
          .limit(query.pageSize + 1)
          .offset(query.cursor ? 0 : (query.page - 1) * query.pageSize),

        // Counted on the first batch only: the scroll shows the figure once, and
        // the count is the half of a list read that cannot stop at `pageSize`.
        query.cursor ? undefined : store.db.select({ total: count() }).from(orders).where(where),
      ]);

      const batch = page.batch(rows, query.pageSize);

      return listed(
        reply,
        batch.rows.map((row) => ({
          ...row,
          placedAt: row.placedAt.toISOString(),
          itemCount: Number(row.itemCount),
          /*
           * What each row may become next, so the list can advance an order
           * without opening it. The same map the PATCH re-checks — the panel
           * offering a move is never what makes it legal.
           */
          allowedTransitions: ORDER_TRANSITIONS[row.status as OrderStatus],
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
   * The figures above the list, counted in the database over the whole book of
   * orders rather than the page on screen.
   *
   * "Today" is the store's own day, not UTC: an owner in Dhaka closing their
   * evening should see the orders they took today, and `store_settings.timezone`
   * is where that is recorded.
   *
   * Registered before `/orders/:id`; find-my-way matches the static segment first
   * regardless.
   */
  app.get(
    '/orders/stats',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('orders.view')] },
    async (request, reply) => {
      const store = storeOf(request);

      const [settings] = await store.db
        .select({ timezone: storeSettings.timezone })
        .from(storeSettings)
        .limit(1);
      const zone = settings?.timezone || 'UTC';

      const result = await store.db.execute<{
        total: number;
        today_orders: number;
        today_revenue: string;
        open_orders: number;
        unpaid: number;
        shipped: number;
        delivered: number;
        cancelled: number;
        revenue_30d: string;
        average_order: string;
        by_status: Record<string, number>;
        by_payment: Record<string, number>;
      }>(sql`
        select
          count(*)::int as total,
          count(*) filter (
            where (${orders.placedAt} at time zone ${zone}::text)::date = (now() at time zone ${zone}::text)::date
              and ${COUNTED}
          )::int as today_orders,
          coalesce(sum(${orders.grandTotal}) filter (
            where (${orders.placedAt} at time zone ${zone}::text)::date = (now() at time zone ${zone}::text)::date
              and ${COUNTED}
          ), 0)::text as today_revenue,
          count(*) filter (where ${orders.status} in ('new', 'pending', 'confirmed', 'processing', 'packed'))::int as open_orders,
          count(*) filter (where ${orders.paymentStatus} in ('pending', 'cod_pending', 'partially_paid') and ${COUNTED})::int as unpaid,
          count(*) filter (where ${orders.status} in ('shipped', 'out_for_delivery'))::int as shipped,
          count(*) filter (where ${orders.status} = 'delivered')::int as delivered,
          count(*) filter (where ${orders.status} in ('cancelled', 'failed'))::int as cancelled,
          coalesce(sum(${orders.grandTotal}) filter (
            where ${orders.placedAt} >= now() - interval '30 days' and ${COUNTED}
          ), 0)::text as revenue_30d,
          coalesce(avg(${orders.grandTotal}) filter (where ${COUNTED}), 0)::numeric(12,2)::text as average_order,
          coalesce(
            (select jsonb_object_agg(s.status, s.total)
               from (select ${orders.status} as status, count(*)::int as total from ${orders} group by ${orders.status}) s),
            '{}'::jsonb
          ) as by_status,
          coalesce(
            (select jsonb_object_agg(p.payment_status, p.total)
               from (select ${orders.paymentStatus} as payment_status, count(*)::int as total from ${orders} group by ${orders.paymentStatus}) p),
            '{}'::jsonb
          ) as by_payment
        from ${orders}
      `);

      const row = result.rows?.[0];

      return ok(reply, {
        total: Number(row?.total ?? 0),
        todayOrders: Number(row?.today_orders ?? 0),
        todayRevenue: row?.today_revenue ?? '0',
        openOrders: Number(row?.open_orders ?? 0),
        unpaid: Number(row?.unpaid ?? 0),
        shipped: Number(row?.shipped ?? 0),
        delivered: Number(row?.delivered ?? 0),
        cancelled: Number(row?.cancelled ?? 0),
        revenue30d: row?.revenue_30d ?? '0',
        averageOrderValue: row?.average_order ?? '0',
        byStatus: row?.by_status ?? {},
        byPaymentStatus: row?.by_payment ?? {},
        timezone: zone,
      });
    },
  );

  app.get(
    '/orders/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('orders.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [order] = await store.db.select().from(orders).where(eq(orders.id, id)).limit(1);
      if (!order) throw notFound('That order does not exist.', ERROR_CODES.ORDER_NOT_FOUND);

      const [lines, addresses, history, paymentRows, shipmentRows, customer, refundRows, returnRows] =
        await Promise.all([
        store.db.select().from(orderItems).where(eq(orderItems.orderId, id)).orderBy(asc(orderItems.createdAt)),
        store.db.select().from(orderAddresses).where(eq(orderAddresses.orderId, id)),
        store.db
          .select()
          .from(orderStatusHistory)
          .where(eq(orderStatusHistory.orderId, id))
          .orderBy(desc(orderStatusHistory.createdAt)),
        store.db.select().from(payments).where(eq(payments.orderId, id)).orderBy(desc(payments.createdAt)),
        store.db.select().from(shipments).where(eq(shipments.orderId, id)).orderBy(desc(shipments.createdAt)),
        order.customerId
          ? store.db
              .select({ id: customers.id, fullName: customers.fullName, email: customers.email })
              .from(customers)
              .where(eq(customers.id, order.customerId))
              .limit(1)
          : Promise.resolve([]),

        // `refunded_total` on the order is a figure; these are what it is made
        // of, and the only place the *reason* money went back is recorded.
        store.db
          .select({
            id: refunds.id,
            refundNumber: refunds.refundNumber,
            status: refunds.status,
            amount: refunds.amount,
            currency: refunds.currency,
            method: refunds.method,
            reason: refunds.reason,
            returnId: refunds.returnId,
            completedAt: refunds.completedAt,
            createdAt: refunds.createdAt,
          })
          .from(refunds)
          .where(eq(refunds.orderId, id))
          .orderBy(desc(refunds.createdAt)),

        store.db
          .select({
            id: returns.id,
            returnNumber: returns.returnNumber,
            status: returns.status,
            resolution: returns.resolution,
            reason: returns.reason,
            refundableAmount: returns.refundableAmount,
            createdAt: returns.createdAt,
          })
          .from(returns)
          .where(eq(returns.orderId, id))
          .orderBy(desc(returns.createdAt)),
      ]);

      return ok(reply, {
        ...order,
        placedAt: order.placedAt.toISOString(),
        lines,
        addresses,
        // Every entry, including the ones hidden from the customer — this is the
        // side that needs to see what actually happened.
        history: history.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
        payments: paymentRows,
        shipments: shipmentRows,
        customer: customer[0] ?? null,
        refunds: refundRows.map((refund) => ({
          ...refund,
          createdAt: refund.createdAt.toISOString(),
          completedAt: refund.completedAt?.toISOString() ?? null,
        })),
        returns: returnRows.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
        /** What this order may become next, so the panel offers only those. */
        allowedTransitions: ORDER_TRANSITIONS[order.status as OrderStatus],
      });
    },
  );

  /**
   * Moves an order along.
   *
   * Refuses any move `ORDER_TRANSITIONS` does not list, and does the work each
   * one implies: cancelling releases reserved stock, dispatching converts it
   * from reserved into sold, and both write a ledger row.
   */
  app.patch(
    '/orders/:id/status',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('orders.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(statusSchema, request.body);

      const updated = await store.db.transaction(async (tx) => {
        const [order] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
        if (!order) throw notFound('That order does not exist.', ERROR_CODES.ORDER_NOT_FOUND);

        const from = order.status as OrderStatus;
        if (from === body.status) return order;

        if (!ORDER_TRANSITIONS[from].includes(body.status)) {
          throw conflict(
            `An order that is ${from.replace(/_/g, ' ')} cannot become ${body.status.replace(/_/g, ' ')}.`,
            ERROR_CODES.INVALID_STATUS_TRANSITION,
          );
        }

        const now = new Date();
        const patch: Record<string, unknown> = { status: body.status, updatedAt: now };

        if (body.status === 'confirmed') patch.confirmedAt = now;
        if (body.status === 'shipped') {
          patch.shippedAt = now;
          patch.shippingStatus = 'shipped';
        }
        if (body.status === 'out_for_delivery') patch.shippingStatus = 'out_for_delivery';
        if (body.status === 'delivered') {
          patch.deliveredAt = now;
          patch.shippingStatus = 'delivered';
          // Cash on delivery is collected at the door; this is the moment it
          // stops being owed.
          if (order.paymentStatus === 'cod_pending') patch.paymentStatus = 'paid';
        }
        if (body.status === 'cancelled' || body.status === 'failed') {
          patch.cancelledAt = now;
          patch.cancelReason = body.note ?? 'Cancelled by the store';
        }

        await tx.update(orders).set(patch).where(eq(orders.id, id));

        await tx.insert(orderStatusHistory).values({
          orderId: id,
          fromStatus: from,
          toStatus: body.status,
          note: body.note ?? null,
          adminId: request.storeAdmin!.adminId,
          adminLabel: request.storeAdmin!.email,
        });

        /*
         * Stock follows the status, and only once. `inventory_released` is what
         * stops a cancel-then-fail from putting the same units back twice.
         */
        if ((body.status === 'cancelled' || body.status === 'failed') && !order.inventoryReleased) {
          await releaseOrderStock(tx, id);
          await tx.update(orders).set({ inventoryReleased: true }).where(eq(orders.id, id));
        }

        if (body.status === 'shipped' && !order.inventoryReleased) {
          await fulfilOrderStock(tx, id);
          await tx.update(orders).set({ inventoryReleased: true }).where(eq(orders.id, id));
        }

        const [after] = await tx.select().from(orders).where(eq(orders.id, id)).limit(1);
        return after!;
      });

      await audit(store.db, request, {
        action: 'order.status',
        module: 'orders',
        entity: 'order',
        entityId: id,
        entityLabel: updated.orderNumber,
        newValues: { status: updated.status },
      });

      return ok(reply, updated);
    },
  );

  /** Tracking details. Customer-visible, so it is the one place a typo shows. */
  app.post(
    '/orders/:id/shipments',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('orders.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(shipmentSchema, request.body);

      const [order] = await store.db
        .select({ id: orders.id, orderNumber: orders.orderNumber })
        .from(orders)
        .where(eq(orders.id, id))
        .limit(1);

      if (!order) throw notFound('That order does not exist.', ERROR_CODES.ORDER_NOT_FOUND);

      const [created] = await store.db
        .insert(shipments)
        .values({ orderId: id, ...body, status: 'shipped', shippedAt: new Date() })
        .returning();

      await audit(store.db, request, {
        action: 'order.shipment',
        module: 'orders',
        entity: 'order',
        entityId: id,
        entityLabel: order.orderNumber,
        newValues: created,
      });

      return ok(reply, created, 201);
    },
  );

  /** Staff-only note. Never returned by any storefront endpoint. */
  app.patch(
    '/orders/:id/note',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('orders.update')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(noteSchema, request.body);

      const [updated] = await store.db
        .update(orders)
        .set({ adminNote: body.adminNote, updatedAt: new Date() })
        .where(eq(orders.id, id))
        .returning({ id: orders.id, adminNote: orders.adminNote });

      if (!updated) throw notFound('That order does not exist.', ERROR_CODES.ORDER_NOT_FOUND);

      return ok(reply, updated);
    },
  );
}

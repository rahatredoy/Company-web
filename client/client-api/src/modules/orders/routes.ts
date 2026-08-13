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
  shipments,
} from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { invalidateStorefrontOnWrite } from '../../lib/cache';
import type { OrderStatus } from '../../lib/constants';
import { ORDER_STATUSES, ORDER_TRANSITIONS } from '../../lib/constants';
import { ERROR_CODES, conflict, notFound } from '../../lib/errors';
import { buildMeta, ok, paginated, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { releaseOrderStock } from '../storefront/orders.routes';
import { fulfilOrderStock } from './service';
import { storeOf } from '../../plugins/tenant';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
  paymentStatus: z.string().trim().max(40).optional(),
  sort: z.enum(['placedAt', 'grandTotal', 'orderNumber']).default('placedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

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
            )
          : undefined,
        query.status && query.status !== 'all'
          ? eq(orders.status, query.status as OrderStatus)
          : undefined,
        query.paymentStatus && query.paymentStatus !== 'all'
          ? sql`${orders.paymentStatus}::text = ${query.paymentStatus}`
          : undefined,
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;
      const direction = query.order === 'asc' ? asc : desc;

      const [rows, tally] = await Promise.all([
        store.db
          .select({
            id: orders.id,
            orderNumber: orders.orderNumber,
            customerName: orders.customerName,
            email: orders.email,
            status: orders.status,
            paymentStatus: orders.paymentStatus,
            shippingStatus: orders.shippingStatus,
            grandTotal: orders.grandTotal,
            currency: orders.currency,
            placedAt: orders.placedAt,
            itemCount: sql<number>`(
              select coalesce(sum(oi.quantity), 0)::int
              from ${orderItems} oi where oi.order_id = ${orders.id}
            )`,
          })
          .from(orders)
          .where(where)
          .orderBy(direction(SORTABLE[query.sort]))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),

        store.db.select({ total: count() }).from(orders).where(where),
      ]);

      return paginated(
        reply,
        rows.map((row) => ({ ...row, placedAt: row.placedAt.toISOString(), itemCount: Number(row.itemCount) })),
        buildMeta(query.page, query.pageSize, Number(tally[0]?.total ?? 0)),
      );
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

      const [lines, addresses, history, paymentRows, shipmentRows, customer] = await Promise.all([
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

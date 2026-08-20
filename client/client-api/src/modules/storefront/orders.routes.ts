import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  inventoryTransactions,
  orderItems,
  orderStatusHistory,
  orders,
  payments,
} from '../../db/schema/index';
import type { TenantExecutor } from '../../db/tenant-manager';
import type { OrderStatus } from '../../lib/constants';
import { RATE_LIMITS } from '../../lib/constants';
import { ERROR_CODES, notFound, unprocessable } from '../../lib/errors';
import { buildMeta, noContent, ok, paginated, parseBody, parseParams, parseQuery } from '../../lib/http';
import { stockUnitsOf } from '../../lib/measure';
import { enforce } from '../../lib/rate-limit';
import { storeOf, type StoreContext } from '../../plugins/tenant';
import { releaseStock } from './checkout.service';
import { guestOwnsOrder } from './guest-orders';
import { canCustomerCancel, loadOrderDetail } from './orders.service';

const numberParamSchema = z.object({ orderNumber: z.string().trim().min(1).max(32) });

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  status: z.string().trim().max(40).optional(),
});

const trackSchema = z.object({
  orderNumber: z.string().trim().min(1).max(32),
  email: z.string().trim().toLowerCase().email().max(254),
});

const cancelSchema = z.object({
  reason: z.string().trim().min(1, 'Tell us why.').max(60),
  notes: z.string().trim().max(500).nullable().optional(),
});

/**
 * Which database statuses each storefront filter chip means.
 *
 * The chips are customer language — "Active" covers everything between paid and
 * delivered — so they cannot be compared to the status column directly.
 */
const STATUS_FILTERS: Record<string, OrderStatus[]> = {
  processing: ['new', 'pending', 'confirmed', 'processing', 'packed', 'shipped', 'out_for_delivery'],
  delivered: ['delivered'],
  cancelled: ['cancelled', 'failed'],
  returned: ['returned', 'refunded'],
};

export default async function storefrontOrderRoutes(app: FastifyInstance) {
  app.get('/account/orders', { preHandler: [app.requireCustomer] }, async (request, reply) => {
    const store = storeOf(request);
    const query = parseQuery(listQuerySchema, request.query);

    const filters = [eq(orders.customerId, request.customer!.customerId)];
    // `all` is the storefront's default and means no filter; an unrecognised
    // value is ignored rather than returning nothing, so a stale bookmark still
    // shows the customer their orders.
    const statuses = query.status && query.status !== 'all' ? STATUS_FILTERS[query.status] : undefined;
    if (statuses) filters.push(inArray(orders.status, statuses));

    const where = and(...filters);

    const [rows, tally] = await Promise.all([
      store.db
        .select({
          orderNumber: orders.orderNumber,
          placedAt: orders.placedAt,
          status: orders.status,
          paymentStatus: orders.paymentStatus,
          total: orders.grandTotal,
          currency: orders.currency,
          /*
           * `${orders}.id` rather than `${orders.id}`: with no join on the outer
           * select, a bare column renders unqualified as `"id"`, which Postgres
           * then resolves against `order_items` — so this counted
           * `oi.order_id = oi.id` and every order in the customer's list showed
           * no items at all.
           */
          itemCount: sql<number>`(
            select coalesce(sum(oi.quantity), 0)::int
            from ${orderItems} oi where oi.order_id = ${orders}.id
          )`,
        })
        .from(orders)
        .where(where)
        .orderBy(desc(orders.placedAt))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),

      store.db.select({ total: count() }).from(orders).where(where),
    ]);

    return paginated(
      reply,
      rows.map((row) => ({
        orderNumber: row.orderNumber,
        placedAt: row.placedAt.toISOString(),
        status: row.status,
        paymentStatus: row.paymentStatus,
        itemCount: Number(row.itemCount),
        total: row.total,
        currency: row.currency,
      })),
      buildMeta(query.page, query.pageSize, Number(tally[0]?.total ?? 0)),
    );
  });

  /**
   * One order, for whoever is entitled to see it.
   *
   * Two ways in: the customer who owns it, or the browser that placed it as a
   * guest. Both are checked here before anything is loaded — `loadOrderDetail`
   * deliberately does no authorisation of its own.
   */
  app.get('/account/orders/:orderNumber', { preHandler: [app.optionalCustomer] }, async (request, reply) => {
    const store = storeOf(request);
    const { orderNumber } = parseParams(numberParamSchema, request.params);

    const order = await authoriseOrder(request, store, orderNumber);
    if (!order) throw notFound('That order does not exist.');

    const detail = await loadOrderDetail(store.db, order.id);
    if (!detail) throw notFound('That order does not exist.');

    return ok(reply, detail);
  });

  /**
   * Guest lookup by order number **and** email.
   *
   * The number alone is not a secret — it is printed on the packaging and it is
   * sequential — so requiring the address is what stops the page becoming a way
   * to read a stranger's name, phone number and home address. A wrong email and
   * an unknown order give the identical answer.
   */
  app.post('/orders/track', async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(trackSchema, request.body);
    await enforce(request, 'order-track', RATE_LIMITS.forgotPassword);

    const [order] = await store.db
      .select({ id: orders.id })
      .from(orders)
      .where(
        and(
          eq(orders.orderNumber, body.orderNumber),
          eq(sql`lower(${orders.email})`, body.email),
        ),
      )
      .limit(1);

    if (!order) throw notFound('We could not find that order.');

    return ok(reply, await loadOrderDetail(store.db, order.id));
  });

  /**
   * Customer-initiated cancellation.
   *
   * Only from a status the shop has not acted on yet, and the reserved stock
   * goes back in the same transaction — an order cancelled without releasing its
   * stock quietly makes the shop look sold out.
   */
  app.post(
    '/account/orders/:orderNumber/cancel',
    { preHandler: [app.optionalCustomer] },
    async (request, reply) => {
      const store = storeOf(request);
      const { orderNumber } = parseParams(numberParamSchema, request.params);
      const body = parseBody(cancelSchema, request.body);

      const owned = await authoriseOrder(request, store, orderNumber);
      if (!owned) throw notFound('That order does not exist.');

      await store.db.transaction(async (tx) => {
        // Re-read inside the transaction: the page the button was on may have
        // been open while the shop dispatched the parcel.
        const [order] = await tx
          .select({ id: orders.id, status: orders.status, released: orders.inventoryReleased })
          .from(orders)
          .where(eq(orders.id, owned.id))
          .limit(1);

        if (!order) throw notFound('That order does not exist.');

        if (!canCustomerCancel(order.status as OrderStatus)) {
          throw unprocessable(
            'This order can no longer be cancelled. Contact us and we will help.',
            ERROR_CODES.ORDER_ALREADY_CANCELLED,
          );
        }

        await tx
          .update(orders)
          .set({
            status: 'cancelled',
            cancelReason: body.reason,
            cancelledAt: new Date(),
            inventoryReleased: true,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, order.id));

        await tx.insert(orderStatusHistory).values({
          orderId: order.id,
          fromStatus: order.status,
          toStatus: 'cancelled',
          note: body.notes ?? body.reason,
        });

        if (!order.released) await releaseOrderStock(tx, order.id);

        // A cancelled order that was never paid should not sit as "pending" for
        // ever in the payments list.
        await tx
          .update(payments)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(and(eq(payments.orderId, order.id), eq(payments.status, 'pending')));
      });

      return noContent(reply);
    },
  );
}

/**
 * Finds an order this caller is allowed to read, or nothing.
 *
 * Scoped by owner in the query rather than fetched-then-compared: a route that
 * loads by number and checks afterwards is one early return away from being an
 * enumeration hole.
 */
export async function authoriseOrder(
  request: FastifyRequest,
  store: StoreContext,
  orderNumber: string,
): Promise<{ id: string } | null> {
  const customerId = request.customer?.customerId;

  if (customerId) {
    const [own] = await store.db
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.orderNumber, orderNumber), eq(orders.customerId, customerId)))
      .limit(1);

    if (own) return own;
  }

  if (!(await guestOwnsOrder(request, store, orderNumber))) return null;

  const [guest] = await store.db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);

  return guest ?? null;
}

/** Puts every reserved line back, with a ledger row for each move. */
export async function releaseOrderStock(tx: TenantExecutor, orderId: string): Promise<void> {
  const lines = await tx
    .select({
      variantId: orderItems.variantId,
      quantity: orderItems.quantity,
      measure: orderItems.measure,
    })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  for (const line of lines) {
    if (!line.variantId) continue;

    /*
     * Released in the same units it was reserved in — base units for a product
     * sold by measure. Putting back the quantity instead would return two grams
     * of a cancelled kilo and quietly lose the rest of the shelf.
     */
    const stockUnits = stockUnitsOf(line);
    const outcome = await releaseStock(tx, line.variantId, stockUnits);
    if (!outcome.released || !outcome.warehouseId) continue;

    await tx.insert(inventoryTransactions).values({
      variantId: line.variantId,
      warehouseId: outcome.warehouseId,
      type: 'order_released',
      quantity: stockUnits,
      fromBucket: 'reserved',
      toBucket: 'available',
      availableAfter: outcome.availableAfter,
      reservedAfter: 0,
      referenceType: 'order',
      referenceId: orderId,
    });
  }
}

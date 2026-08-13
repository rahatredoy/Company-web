import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  inventoryTransactions,
  orderItems,
  orders,
  refunds,
  returnHistory,
  returnItems,
  returns,
} from '../../db/schema/index';
import type { TenantExecutor } from '../../db/tenant-manager';
import { audit } from '../../lib/audit';
import { ERROR_CODES, conflict, notFound } from '../../lib/errors';
import { buildMeta, ok, paginated, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { moneyToNumber, toMoney } from '../../lib/utils';
import { claimDailyRef } from '../storefront/orders.service';
import { storeOf } from '../../plugins/tenant';

type ReturnStatus = 'requested' | 'under_review' | 'approved' | 'rejected' | 'received' | 'inspected' | 'completed';

/**
 * A return's own status graph.
 *
 * Separate from the order's and just as closed: a return that jumps from
 * `requested` to `completed` has refunded money for goods nobody looked at.
 */
const RETURN_TRANSITIONS: Record<ReturnStatus, ReturnStatus[]> = {
  requested: ['under_review', 'approved', 'rejected'],
  under_review: ['approved', 'rejected'],
  approved: ['received', 'rejected'],
  received: ['inspected'],
  inspected: ['completed', 'rejected'],
  rejected: [],
  completed: [],
};

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
});

const statusSchema = z.object({
  status: z.enum(['under_review', 'approved', 'rejected', 'received', 'inspected', 'completed']),
  note: z.string().trim().max(300).optional(),
  /** Only read on `rejected`. */
  rejectionReason: z.string().trim().max(300).optional(),
  /** Only read on `inspected` — which items came back in a sellable state. */
  restock: z.array(z.object({ itemId: z.string().uuid(), quantity: z.coerce.number().int().min(0).max(999) })).max(50).optional(),
});

export default async function adminReturnRoutes(app: FastifyInstance) {
  app.get(
    '/returns',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('returns.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const query = parseQuery(listQuerySchema, request.query);

      const filters = [
        query.search
          ? or(ilike(returns.returnNumber, `%${query.search}%`), ilike(orders.orderNumber, `%${query.search}%`))
          : undefined,
        query.status && query.status !== 'all' ? eq(returns.status, query.status as ReturnStatus) : undefined,
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;

      const [rows, tally] = await Promise.all([
        store.db
          .select({
            id: returns.id,
            returnNumber: returns.returnNumber,
            orderId: returns.orderId,
            orderNumber: orders.orderNumber,
            customerName: orders.customerName,
            status: returns.status,
            resolution: returns.resolution,
            reason: returns.reason,
            refundableAmount: returns.refundableAmount,
            currency: orders.currency,
            createdAt: returns.createdAt,
          })
          .from(returns)
          .innerJoin(orders, eq(orders.id, returns.orderId))
          .where(where)
          .orderBy(desc(returns.createdAt))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),

        store.db
          .select({ total: count() })
          .from(returns)
          .innerJoin(orders, eq(orders.id, returns.orderId))
          .where(where),
      ]);

      return paginated(
        reply,
        rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        buildMeta(query.page, query.pageSize, Number(tally[0]?.total ?? 0)),
      );
    },
  );

  app.get(
    '/returns/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('returns.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [row] = await store.db
        .select({
          id: returns.id,
          returnNumber: returns.returnNumber,
          orderId: returns.orderId,
          orderNumber: orders.orderNumber,
          customerName: orders.customerName,
          email: orders.email,
          currency: orders.currency,
          status: returns.status,
          resolution: returns.resolution,
          reason: returns.reason,
          description: returns.description,
          refundableAmount: returns.refundableAmount,
          rejectionReason: returns.rejectionReason,
          adminNote: returns.adminNote,
          createdAt: returns.createdAt,
        })
        .from(returns)
        .innerJoin(orders, eq(orders.id, returns.orderId))
        .where(eq(returns.id, id))
        .limit(1);

      if (!row) throw notFound('That return does not exist.', ERROR_CODES.RETURN_NOT_FOUND);

      const [items, history] = await Promise.all([
        store.db
          .select({
            id: returnItems.id,
            orderItemId: returnItems.orderItemId,
            productName: orderItems.productName,
            sku: orderItems.sku,
            quantity: returnItems.quantity,
            unitPrice: returnItems.unitPrice,
            lineTotal: returnItems.lineTotal,
            inspectionResult: returnItems.inspectionResult,
            restockedQuantity: returnItems.restockedQuantity,
            variantId: orderItems.variantId,
          })
          .from(returnItems)
          .innerJoin(orderItems, eq(orderItems.id, returnItems.orderItemId))
          .where(eq(returnItems.returnId, id)),

        store.db
          .select()
          .from(returnHistory)
          .where(eq(returnHistory.returnId, id))
          .orderBy(desc(returnHistory.createdAt)),
      ]);

      return ok(reply, {
        ...row,
        createdAt: row.createdAt.toISOString(),
        items,
        history: history.map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
        allowedTransitions: RETURN_TRANSITIONS[row.status as ReturnStatus],
      });
    },
  );

  /**
   * Moves a return along, and does what each step means.
   *
   * `inspected` is the one that touches stock: only the quantity staff say came
   * back in a sellable state goes to `available`, and the rest is recorded as
   * damaged. Restocking everything automatically is how a shop ends up selling
   * something a customer returned broken.
   *
   * `completed` raises the refund. It is not paid here — that is `refunds.approve`,
   * deliberately a second person's permission.
   */
  app.patch(
    '/returns/:id/status',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('returns.approve')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(statusSchema, request.body);

      const result = await store.db.transaction(async (tx) => {
        const [row] = await tx.select().from(returns).where(eq(returns.id, id)).limit(1);
        if (!row) throw notFound('That return does not exist.', ERROR_CODES.RETURN_NOT_FOUND);

        const from = row.status as ReturnStatus;
        if (!RETURN_TRANSITIONS[from].includes(body.status)) {
          throw conflict(
            `A return that is ${from.replace(/_/g, ' ')} cannot become ${body.status.replace(/_/g, ' ')}.`,
            ERROR_CODES.INVALID_STATUS_TRANSITION,
          );
        }

        const now = new Date();
        const patch: Record<string, unknown> = { status: body.status, updatedAt: now };

        if (body.status === 'approved' || body.status === 'rejected') {
          patch.reviewedAt = now;
          patch.reviewedBy = request.storeAdmin!.adminId;
        }
        if (body.status === 'rejected') patch.rejectionReason = body.rejectionReason ?? body.note ?? null;
        if (body.status === 'received') patch.receivedAt = now;
        if (body.status === 'completed') patch.completedAt = now;

        await tx.update(returns).set(patch).where(eq(returns.id, id));

        await tx.insert(returnHistory).values({
          returnId: id,
          fromStatus: from,
          toStatus: body.status,
          note: body.note ?? null,
          adminId: request.storeAdmin!.adminId,
          adminLabel: request.storeAdmin!.email,
        });

        if (body.status === 'inspected') await restockInspected(tx, id, body.restock ?? []);

        let refundNumber: string | null = null;
        if (body.status === 'completed' && row.resolution === 'refund') {
          refundNumber = await raiseRefund(tx, row.orderId, id, row.customerId, row.refundableAmount);
        }

        /*
         * A rejected return releases the quantity it had claimed, so the
         * customer can ask again for the same line. Claiming at request time is
         * what stops two open returns for one item; it has to be given back when
         * one of them ends without goods coming home.
         */
        if (body.status === 'rejected') await releaseClaim(tx, id);

        return { returnNumber: row.returnNumber, status: body.status, refundNumber };
      });

      await audit(store.db, request, {
        action: `return.${body.status}`,
        module: 'fulfilment',
        entity: 'return',
        entityId: id,
        entityLabel: result.returnNumber,
        newValues: result,
      });

      return ok(reply, result);
    },
  );
}

/** Puts back only what staff judged sellable; the rest is marked damaged. */
async function restockInspected(
  tx: TenantExecutor,
  returnId: string,
  restock: { itemId: string; quantity: number }[],
): Promise<void> {
  const wanted = new Map(restock.map((entry) => [entry.itemId, entry.quantity]));

  const items = await tx
    .select({
      id: returnItems.id,
      quantity: returnItems.quantity,
      variantId: orderItems.variantId,
    })
    .from(returnItems)
    .innerJoin(orderItems, eq(orderItems.id, returnItems.orderItemId))
    .where(eq(returnItems.returnId, returnId));

  for (const item of items) {
    const good = Math.min(wanted.get(item.id) ?? 0, item.quantity);
    const damaged = item.quantity - good;

    await tx
      .update(returnItems)
      .set({
        restockedQuantity: good,
        inspectionResult: good === item.quantity ? 'good' : good === 0 ? 'damaged' : 'repairable',
      })
      .where(eq(returnItems.id, item.id));

    if (!item.variantId || item.quantity === 0) continue;

    const result = await tx.execute<{ warehouse_id: string; available: number; reserved: number }>(sql`
      update inventory_levels
         set available = available + ${good},
             damaged   = damaged + ${damaged},
             updated_at = now()
       where id = (
         select id from inventory_levels where variant_id = ${item.variantId}::uuid limit 1
       )
      returning warehouse_id, available, reserved
    `);

    const level = result.rows?.[0];
    if (!level) continue;

    await tx.insert(inventoryTransactions).values({
      variantId: item.variantId,
      warehouseId: level.warehouse_id,
      type: 'return_restocked',
      quantity: good,
      fromBucket: 'return_pending',
      toBucket: 'available',
      availableAfter: Number(level.available),
      reservedAfter: Number(level.reserved),
      referenceType: 'return',
      referenceId: returnId,
      note: damaged > 0 ? `${damaged} written off as damaged` : null,
    });
  }
}

/** Raises the refund a completed return owes. Approval to pay is separate. */
async function raiseRefund(
  tx: TenantExecutor,
  orderId: string,
  returnId: string,
  customerId: string | null,
  amount: string,
): Promise<string | null> {
  if (moneyToNumber(amount) <= 0) return null;

  const [order] = await tx
    .select({ currency: orders.currency, grandTotal: orders.grandTotal, refunded: orders.refundedTotal })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  if (!order) return null;

  // Never more than is left on the order, however the return was priced.
  const remaining = moneyToNumber(order.grandTotal) - moneyToNumber(order.refunded);
  const payable = Math.min(moneyToNumber(amount), remaining);
  if (payable <= 0) return null;

  const refundNumber = await claimDailyRef(
    'REF',
    async () => {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(refunds)
        .where(sql`${refunds.createdAt} >= date_trunc('day', now())`);
      return Number(row?.count ?? 0);
    },
    async (candidate) => {
      const [taken] = await tx
        .select({ id: refunds.id })
        .from(refunds)
        .where(eq(refunds.refundNumber, candidate))
        .limit(1);
      return Boolean(taken);
    },
  );

  await tx.insert(refunds).values({
    refundNumber,
    orderId,
    returnId,
    customerId,
    amount: toMoney(payable),
    currency: order.currency,
    reason: 'Return completed',
    status: 'requested',
  });

  return refundNumber;
}

/** Gives back the `returned_quantity` a rejected return had claimed. */
async function releaseClaim(tx: TenantExecutor, returnId: string): Promise<void> {
  const items = await tx
    .select({ orderItemId: returnItems.orderItemId, quantity: returnItems.quantity })
    .from(returnItems)
    .where(eq(returnItems.returnId, returnId));

  for (const item of items) {
    await tx
      .update(orderItems)
      .set({ returnedQuantity: sql`greatest(${orderItems.returnedQuantity} - ${item.quantity}, 0)` })
      .where(eq(orderItems.id, item.orderItemId));
  }
}


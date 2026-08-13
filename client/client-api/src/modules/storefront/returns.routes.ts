import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { orderItems, orders, returnHistory, returnItems, returns } from '../../db/schema/index';
import type { TenantExecutor } from '../../db/tenant-manager';
import type { OrderStatus } from '../../lib/constants';
import { RATE_LIMITS } from '../../lib/constants';
import { ERROR_CODES, notFound, unprocessable } from '../../lib/errors';
import { ok, parseBody, parseParams } from '../../lib/http';
import { enforce } from '../../lib/rate-limit';
import { moneyToNumber, toMoney } from '../../lib/utils';
import { storeOf } from '../../plugins/tenant';
import { authoriseOrder } from './orders.routes';
import { canRequestReturn, claimDailyRef, DEFAULT_RETURN_WINDOW_DAYS } from './orders.service';

const paramsSchema = z.object({ orderNumber: z.string().trim().min(1).max(32) });

const returnSchema = z.object({
  items: z
    .array(
      z.object({
        /** Index into the order's own line list, as the wizard sends it. */
        lineIndex: z.coerce.number().int().min(0).max(99),
        quantity: z.coerce.number().int().min(1).max(99),
      }),
    )
    .min(1, 'Choose what you are returning.')
    .max(50),
  reason: z.string().trim().min(1, 'Tell us why.').max(60),
  description: z.string().trim().max(2000).nullable().optional(),
  resolution: z.enum(['refund', 'exchange', 'replacement']),
  evidenceCount: z.coerce.number().int().min(0).max(4).optional(),
});

/**
 * Customer-initiated returns.
 *
 * Items arrive as **`lineIndex`** — the position in `OrderDetail.lines` — not as
 * a row id, because that is what the storefront's wizard has to hand. The index
 * is resolved against the same ordering `loadOrderDetail` uses, so the two
 * cannot drift; anything out of range is refused rather than clamped.
 */
export default async function storefrontReturnRoutes(app: FastifyInstance) {
  app.post(
    '/account/orders/:orderNumber/returns',
    { preHandler: [app.optionalCustomer] },
    async (request, reply) => {
      const store = storeOf(request);
      const { orderNumber } = parseParams(paramsSchema, request.params);
      const body = parseBody(returnSchema, request.body);
      await enforce(request, 'return-request', RATE_LIMITS.forgotPassword);

      const owned = await authoriseOrder(request, store, orderNumber);
      if (!owned) throw notFound('That order does not exist.');

      const created = await store.db.transaction(async (tx) => {
        const [order] = await tx
          .select({
            id: orders.id,
            status: orders.status,
            deliveredAt: orders.deliveredAt,
            customerId: orders.customerId,
          })
          .from(orders)
          .where(eq(orders.id, owned.id))
          .limit(1);

        if (!order) throw notFound('That order does not exist.');

        // Same ordering as the detail endpoint — this is what makes `lineIndex`
        // mean the same thing on both sides.
        const lines = await tx
          .select({
            id: orderItems.id,
            productName: orderItems.productName,
            quantity: orderItems.quantity,
            returnedQuantity: orderItems.returnedQuantity,
            unitPrice: orderItems.unitPrice,
            unitSalePrice: orderItems.unitSalePrice,
          })
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id))
          .orderBy(asc(orderItems.createdAt));

        const eligible = lines.some((line) => line.quantity > line.returnedQuantity);

        if (
          !canRequestReturn(
            order.status as OrderStatus,
            order.deliveredAt,
            DEFAULT_RETURN_WINDOW_DAYS,
            eligible,
          )
        ) {
          throw unprocessable(
            'This order cannot be returned.',
            order.status === 'delivered'
              ? ERROR_CODES.RETURN_WINDOW_CLOSED
              : ERROR_CODES.PRODUCT_NOT_RETURNABLE,
          );
        }

        const chosen = body.items.map((item) => {
          const line = lines[item.lineIndex];
          if (!line) {
            throw unprocessable('That item is not on this order.', ERROR_CODES.VALIDATION_FAILED, {
              items: ['One of the chosen items is not on this order.'],
            });
          }

          const remaining = line.quantity - line.returnedQuantity;
          if (item.quantity > remaining) {
            throw unprocessable(
              `You can return at most ${remaining} of ${line.productName}.`,
              ERROR_CODES.RETURN_QUANTITY_EXCEEDED,
              { items: [`Only ${remaining} of ${line.productName} can be returned.`] },
            );
          }

          const unit = line.unitSalePrice ?? line.unitPrice;
          return {
            orderItemId: line.id,
            quantity: item.quantity,
            unitPrice: unit,
            lineTotal: toMoney(moneyToNumber(unit) * item.quantity),
          };
        });

        const refundable = chosen.reduce((sum, item) => sum + moneyToNumber(item.lineTotal), 0);
        const returnNumber = await claimReturnNumber(tx);

        const [row] = await tx
          .insert(returns)
          .values({
            returnNumber,
            orderId: order.id,
            customerId: order.customerId,
            reason: body.reason,
            description: body.description ?? null,
            resolution: body.resolution,
            // What it is worth if approved in full. Staff can reduce it during
            // inspection; the customer is never quoted more than they paid.
            refundableAmount: toMoney(refundable),
          })
          .returning({ id: returns.id, returnNumber: returns.returnNumber });

        await tx.insert(returnItems).values(
          chosen.map((item) => ({ ...item, returnId: row!.id })),
        );

        await tx.insert(returnHistory).values({
          returnId: row!.id,
          toStatus: 'requested',
          note: body.reason,
        });

        /*
         * `returned_quantity` is claimed now, not on approval. Two requests for
         * the same line would otherwise both pass the remaining-quantity check
         * and the shop would owe twice what it sold.
         */
        for (const item of chosen) {
          await tx
            .update(orderItems)
            .set({ returnedQuantity: sql`${orderItems.returnedQuantity} + ${item.quantity}` })
            .where(and(eq(orderItems.id, item.orderItemId)));
        }

        return row!;
      });

      return ok(reply, { returnNumber: created.returnNumber }, 201);
    },
  );
}

/** `RET-20260812-0003`, allocated the same way an order number is. */
async function claimReturnNumber(tx: TenantExecutor): Promise<string> {
  return claimDailyRef(
    'RET',
    async () => {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(returns)
        .where(sql`${returns.createdAt} >= date_trunc('day', now())`);
      return Number(row?.count ?? 0);
    },
    async (candidate) => {
      const [taken] = await tx
        .select({ id: returns.id })
        .from(returns)
        .where(eq(returns.returnNumber, candidate))
        .limit(1);
      return Boolean(taken);
    },
  );
}

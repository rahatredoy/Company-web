import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { orders, payments, refunds } from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { ERROR_CODES, conflict, notFound, unprocessable } from '../../lib/errors';
import { buildMeta, ok, paginated, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { moneyToNumber, toMoney } from '../../lib/utils';
import { storeOf } from '../../plugins/tenant';

type RefundStatus = 'requested' | 'approved' | 'rejected' | 'processing' | 'completed' | 'failed';

const REFUND_TRANSITIONS: Record<RefundStatus, RefundStatus[]> = {
  requested: ['approved', 'rejected'],
  approved: ['processing', 'completed', 'failed'],
  processing: ['completed', 'failed'],
  rejected: [],
  completed: [],
  failed: ['approved'],
};

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(40).optional(),
});

const decisionSchema = z.object({
  status: z.enum(['approved', 'rejected', 'processing', 'completed', 'failed']),
  method: z.string().trim().max(40).optional(),
  reason: z.string().trim().max(200).optional(),
});

/**
 * Money going back out.
 *
 * A refund is raised by a completed return and settled here, deliberately under
 * a different permission (`refunds.approve`) from the one that approves the
 * return itself. The two can be the same person in a small shop; in a larger one
 * they should not be, and the API is where that is enforceable at all.
 *
 * **`orders.refunded_total` is the cap and it is only ever moved on `completed`.**
 * Recording the intention early would let the same money be refunded twice by
 * approving two refunds against one order.
 *
 * Nothing here talks to a payment gateway. `cod` and `mock` are what this
 * platform settles today, and a refund against either is a physical act
 * somebody performs and then records — which is honest, and is what `method`
 * captures.
 */
export default async function refundRoutes(app: FastifyInstance) {
  app.get(
    '/refunds',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('refunds.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const query = parseQuery(listQuerySchema, request.query);

      const filters = [
        query.search
          ? or(ilike(refunds.refundNumber, `%${query.search}%`), ilike(orders.orderNumber, `%${query.search}%`))
          : undefined,
        query.status && query.status !== 'all' ? eq(refunds.status, query.status as RefundStatus) : undefined,
      ].filter(Boolean);

      const where = filters.length ? and(...filters) : undefined;

      const [rows, tally] = await Promise.all([
        store.db
          .select({
            id: refunds.id,
            refundNumber: refunds.refundNumber,
            orderId: refunds.orderId,
            orderNumber: orders.orderNumber,
            customerName: orders.customerName,
            amount: refunds.amount,
            currency: refunds.currency,
            status: refunds.status,
            method: refunds.method,
            reason: refunds.reason,
            createdAt: refunds.createdAt,
            completedAt: refunds.completedAt,
          })
          .from(refunds)
          .innerJoin(orders, eq(orders.id, refunds.orderId))
          .where(where)
          .orderBy(desc(refunds.createdAt))
          .limit(query.pageSize)
          .offset((query.page - 1) * query.pageSize),

        store.db
          .select({ total: count() })
          .from(refunds)
          .innerJoin(orders, eq(orders.id, refunds.orderId))
          .where(where),
      ]);

      return paginated(
        reply,
        rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          allowedTransitions: REFUND_TRANSITIONS[row.status as RefundStatus],
        })),
        buildMeta(query.page, query.pageSize, Number(tally[0]?.total ?? 0)),
      );
    },
  );

  app.patch(
    '/refunds/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('refunds.approve')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);
      const body = parseBody(decisionSchema, request.body);

      const result = await store.db.transaction(async (tx) => {
        const [refund] = await tx.select().from(refunds).where(eq(refunds.id, id)).limit(1);
        if (!refund) throw notFound('That refund does not exist.', ERROR_CODES.REFUND_NOT_FOUND);

        const from = refund.status as RefundStatus;
        if (!REFUND_TRANSITIONS[from].includes(body.status)) {
          throw conflict(
            `A refund that is ${from} cannot become ${body.status}.`,
            ERROR_CODES.INVALID_STATUS_TRANSITION,
          );
        }

        const now = new Date();
        const patch: Record<string, unknown> = { status: body.status, updatedAt: now };

        if (body.method) patch.method = body.method;
        if (body.status === 'approved') {
          patch.approvedAt = now;
          patch.approvedBy = request.storeAdmin!.adminId;
        }
        if (body.status === 'rejected' || body.status === 'failed') {
          patch.failureReason = body.reason ?? null;
        }

        if (body.status === 'completed') {
          const [order] = await tx
            .select({
              id: orders.id,
              grandTotal: orders.grandTotal,
              refunded: orders.refundedTotal,
              paymentStatus: orders.paymentStatus,
            })
            .from(orders)
            .where(eq(orders.id, refund.orderId))
            .limit(1);

          if (!order) throw notFound('That order no longer exists.', ERROR_CODES.ORDER_NOT_FOUND);

          const already = moneyToNumber(order.refunded);
          const amount = moneyToNumber(refund.amount);

          // The cap. Two refunds approved separately against one order would
          // otherwise each look affordable and together exceed what was paid.
          if (already + amount > moneyToNumber(order.grandTotal) + 0.001) {
            throw unprocessable(
              'That is more than is left to refund on this order.',
              ERROR_CODES.REFUND_EXCEEDS_REMAINING,
            );
          }

          const total = toMoney(already + amount);
          const fully = moneyToNumber(total) >= moneyToNumber(order.grandTotal) - 0.001;

          patch.completedAt = now;

          await tx
            .update(orders)
            .set({
              refundedTotal: total,
              paymentStatus: fully ? 'refunded' : 'partially_refunded',
              updatedAt: now,
            })
            .where(eq(orders.id, order.id));

          await tx
            .update(payments)
            .set({
              refundedAmount: sql`${payments.refundedAmount} + ${refund.amount}`,
              status: fully ? 'refunded' : 'partially_refunded',
              updatedAt: now,
            })
            .where(and(eq(payments.orderId, order.id), eq(payments.status, 'paid')));
        }

        await tx.update(refunds).set(patch).where(eq(refunds.id, id));

        return { refundNumber: refund.refundNumber, status: body.status, amount: refund.amount };
      });

      await audit(store.db, request, {
        action: `refund.${body.status}`,
        module: 'fulfilment',
        entity: 'refund',
        entityId: id,
        entityLabel: result.refundNumber,
        newValues: result,
      });

      return ok(reply, result);
    },
  );
}

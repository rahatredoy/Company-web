import { and, count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { customers, orders, payments, refunds, returns } from '../../db/schema/index';
import { audit } from '../../lib/audit';
import { ERROR_CODES, conflict, notFound, unprocessable } from '../../lib/errors';
import { cursorField, listed, ok, parseBody, parseParams, parseQuery, uuidParamSchema } from '../../lib/http';
import { keyset } from '../../lib/keyset';
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
  ...cursorField,
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

      // Newest first, then the id — the id is what makes the order total, and a
      // cursor into a list with ties names no position.
      const page = keyset<{ id: string; createdAt: Date }>([
        { expr: refunds.createdAt, order: 'desc', of: (row) => row.createdAt },
        { expr: refunds.id, order: 'desc', of: (row) => row.id },
      ]);

      const seek = page.after(query.cursor);
      const scan = seek ? and(seek, ...filters) : where;

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
          : store.db
              .select({ total: count() })
              .from(refunds)
              .innerJoin(orders, eq(orders.id, refunds.orderId))
              .where(where),
      ]);

      const batch = page.batch(rows, query.pageSize);

      return listed(
        reply,
        batch.rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          completedAt: row.completedAt?.toISOString() ?? null,
          allowedTransitions: REFUND_TRANSITIONS[row.status as RefundStatus],
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
   * One refund, whole.
   *
   * Everything the row carries, and the three things it only points at: the
   * order it is drawn against, the return that raised it, and the payments that
   * took the money in the first place. That last one is the answer to the
   * question a refund screen actually gets asked — *how* was this paid, and how
   * much of that payment has already gone back — which `payments.refunded_amount`
   * holds and the refund row itself does not.
   *
   * `remainingOnOrder` is computed here rather than left to the reader: the cap
   * this refund will be checked against on completion is the order's grand total
   * less what has already been refunded, and a screen that shows the two figures
   * separately makes every viewer do the subtraction.
   */
  app.get(
    '/refunds/:id',
    { preHandler: [app.requireStoreAdmin, app.requirePermission('refunds.view')] },
    async (request, reply) => {
      const store = storeOf(request);
      const { id } = parseParams(uuidParamSchema, request.params);

      const [row] = await store.db
        .select({
          refund: refunds,
          order: {
            id: orders.id,
            orderNumber: orders.orderNumber,
            status: orders.status,
            paymentStatus: orders.paymentStatus,
            paymentProvider: orders.paymentProvider,
            paymentMethodLabel: orders.paymentMethodLabel,
            grandTotal: orders.grandTotal,
            refundedTotal: orders.refundedTotal,
            currency: orders.currency,
            customerName: orders.customerName,
            customerEmail: orders.email,
            customerPhone: orders.phone,
            placedAt: orders.placedAt,
          },
          returnNumber: returns.returnNumber,
          returnStatus: returns.status,
          customerEmail: customers.email,
        })
        .from(refunds)
        .innerJoin(orders, eq(orders.id, refunds.orderId))
        .leftJoin(returns, eq(returns.id, refunds.returnId))
        .leftJoin(customers, eq(customers.id, refunds.customerId))
        .where(eq(refunds.id, id))
        .limit(1);

      if (!row) throw notFound('That refund does not exist.', ERROR_CODES.REFUND_NOT_FOUND);

      const orderPayments = await store.db
        .select({
          id: payments.id,
          provider: payments.provider,
          status: payments.status,
          amount: payments.amount,
          currency: payments.currency,
          refundedAmount: payments.refundedAmount,
          providerReference: payments.providerReference,
          failureReason: payments.failureReason,
          paidAt: payments.paidAt,
          createdAt: payments.createdAt,
        })
        .from(payments)
        .where(eq(payments.orderId, row.refund.orderId))
        .orderBy(desc(payments.createdAt));

      const remaining = moneyToNumber(row.order.grandTotal) - moneyToNumber(row.order.refundedTotal);

      return ok(reply, {
        ...row.refund,
        createdAt: row.refund.createdAt.toISOString(),
        updatedAt: row.refund.updatedAt.toISOString(),
        approvedAt: row.refund.approvedAt?.toISOString() ?? null,
        completedAt: row.refund.completedAt?.toISOString() ?? null,
        allowedTransitions: REFUND_TRANSITIONS[row.refund.status as RefundStatus],
        order: { ...row.order, placedAt: row.order.placedAt.toISOString() },
        returnNumber: row.returnNumber,
        returnStatus: row.returnStatus,
        customerEmail: row.customerEmail ?? row.order.customerEmail,
        /** What could still be refunded on the order, this refund included. */
        remainingOnOrder: toMoney(Math.max(0, remaining)),
        payments: orderPayments.map((payment) => ({
          ...payment,
          paidAt: payment.paidAt?.toISOString() ?? null,
          createdAt: payment.createdAt.toISOString(),
        })),
      });
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

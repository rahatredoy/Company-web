import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { orderStatusHistory, orders, payments } from '../../db/schema/index';
import { notFound } from '../../lib/errors';
import { parseParams, parseQuery } from '../../lib/http';
import { storeUrl } from '../../lib/urls';
import { storeOf } from '../../plugins/tenant';

const paramsSchema = z.object({ orderNumber: z.string().trim().min(1).max(32) });
const querySchema = z.object({ outcome: z.enum(['paid', 'failed']).optional() });

/**
 * A stand-in payment gateway.
 *
 * Real gateways take the shopper to their own domain, then tell the shop what
 * happened. Nothing about that flow can be exercised without a merchant account,
 * so this reproduces its shape — leave the site, decide, come back — for the two
 * providers the platform ships with live: `cod`, which never arrives here, and
 * `mock`, which does.
 *
 * It is confirmed over **GET** deliberately. A form POST from this page would
 * carry the API's own origin, which is not in the store's allow-list and would
 * be refused by the CSRF hook. A real gateway does not have that problem because
 * it posts a *signed* webhook server-to-server, to the already tenant-exempt
 * `/api/v1/webhooks` prefix, and `payment_webhook_events`' unique
 * `(provider, event_id)` is what makes a redelivery a no-op.
 *
 * `config.devStoreSlug` does not gate this: a store that has switched the `mock`
 * provider on has asked for a shop that takes pretend money, and the guard that
 * matters is `payment_methods.is_enabled`, checked at checkout.
 */
export default async function paymentRoutes(app: FastifyInstance) {
  app.get('/payments/mock/:orderNumber', async (request, reply) => {
    const store = storeOf(request);
    const { orderNumber } = parseParams(paramsSchema, request.params);
    const { outcome } = parseQuery(querySchema, request.query);

    const [order] = await store.db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        total: orders.grandTotal,
        currency: orders.currency,
        paymentStatus: orders.paymentStatus,
      })
      .from(orders)
      .where(eq(orders.orderNumber, orderNumber))
      .limit(1);

    if (!order) throw notFound('That order does not exist.');

    const back = storeUrl(store.slug, `/checkout/success/${encodeURIComponent(order.orderNumber)}`);
    const failed = storeUrl(store.slug, '/checkout/failure');

    if (!outcome) {
      return reply
        .type('text/html; charset=utf-8')
        .send(gatewayPage(store.storeName, order.orderNumber, order.total, order.currency, request.url));
    }

    // Settling twice is a no-op rather than an error: a customer who reloads the
    // return URL must not see their order break.
    if (order.paymentStatus !== 'paid') {
      await store.db.transaction(async (tx) => {
        await tx
          .update(payments)
          .set({
            status: outcome === 'paid' ? 'paid' : 'failed',
            paidAt: outcome === 'paid' ? new Date() : null,
            providerReference: `mock-${order.orderNumber}`,
            failureReason: outcome === 'failed' ? 'Declined in the test gateway.' : null,
            updatedAt: new Date(),
          })
          .where(and(eq(payments.orderId, order.id), eq(payments.provider, 'mock')));

        await tx
          .update(orders)
          .set({
            paymentStatus: outcome === 'paid' ? 'paid' : 'failed',
            status: outcome === 'paid' ? 'confirmed' : 'pending',
            confirmedAt: outcome === 'paid' ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(eq(orders.id, order.id));

        if (outcome === 'paid') {
          await tx.insert(orderStatusHistory).values({
            orderId: order.id,
            fromStatus: 'pending',
            toStatus: 'confirmed',
            note: 'Payment received',
          });
        }
      });
    }

    return reply.redirect(outcome === 'paid' ? back : failed, 303);
  });
}

/** Plain, self-contained, and obviously not a real payment page. */
function gatewayPage(
  storeName: string,
  orderNumber: string,
  total: string,
  currency: string,
  selfUrl: string,
): string {
  const escape = (value: string) =>
    value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

  const base = selfUrl.split('?')[0]!;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Test payment · ${escape(storeName)}</title>
<style>
  body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f7f9;color:#111}
  .card{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.12);max-width:24rem;width:calc(100% - 2rem)}
  .tag{display:inline-block;font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:#92400e;background:#fef3c7;padding:.25rem .5rem;border-radius:4px}
  .amount{font-size:2rem;font-weight:600;margin:.5rem 0 0}
  .muted{color:#6b7280;font-size:.875rem}
  a{display:block;text-align:center;padding:.75rem;border-radius:8px;text-decoration:none;font-weight:500;margin-top:.75rem}
  .pay{background:#111;color:#fff}.fail{background:#fff;color:#b91c1c;border:1px solid #fecaca}
</style></head>
<body><div class="card">
  <span class="tag">Test gateway</span>
  <p class="muted" style="margin:1rem 0 0">${escape(storeName)} · order ${escape(orderNumber)}</p>
  <p class="amount">${escape(currency)} ${escape(total)}</p>
  <p class="muted">No money moves. Choose what the gateway should report back.</p>
  <a class="pay" href="${escape(base)}?outcome=paid">Pay ${escape(currency)} ${escape(total)}</a>
  <a class="fail" href="${escape(base)}?outcome=failed">Simulate a declined card</a>
</div></body></html>`;
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db } from '../../db/client';
import { paymentWebhookEvents } from '../../db/schema/index';
import { config, isProduction } from '../../config/index';
import { AppError, ERROR_CODES } from '../../lib/errors';
import { ok, parseQuery } from '../../lib/http';
import { getPaymentProvider, signMockPayload } from '../../lib/payment';
import {
  activateSubscriptionForPayment,
  findPaymentByReference,
  issueInvoiceForPayment,
  markPaymentFailed,
  markPaymentPaid,
  markPaymentRefunded,
  recordPaymentMethodForPayment,
} from '../../services/billing';
import { advanceOnboardingAfterPayment } from '../../services/onboarding';
import { httpsUrl } from '../../lib/secure-url';

function signatureHeader(headers: Record<string, unknown>, provider: string): string | undefined {
  if (provider === 'stripe') return headers['stripe-signature'] as string | undefined;
  return (headers['x-signature'] ?? headers['x-webhook-signature']) as string | undefined;
}

export default async function webhookRoutes(app: FastifyInstance) {
  /**
   * Gateway callback. Order matters:
   *   verify signature → record event (unique on provider+event_id) → apply.
   * The unique index is what makes replays and duplicate deliveries harmless.
   */
  app.post('/payments/:provider', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    const raw = request.rawBody ?? '';
    const gateway = getPaymentProvider(provider);

    if (!gateway.verifySignature(raw, signatureHeader(request.headers as Record<string, unknown>, provider))) {
      request.log.warn({ provider }, 'rejected webhook with invalid signature');
      throw new AppError(ERROR_CODES.WEBHOOK_SIGNATURE_INVALID, 'Invalid signature.', 401);
    }

    const event = gateway.parseEvent(request.body);
    if (!event) {
      throw new AppError(ERROR_CODES.BAD_REQUEST, 'Unrecognised webhook payload.', 400);
    }

    // Idempotency: a duplicate event_id fails the unique index and stops here.
    try {
      await db.insert(paymentWebhookEvents).values({
        provider,
        eventId: event.eventId,
        eventType: event.eventType,
        status: 'received',
        payload: request.body as object,
      });
    } catch {
      request.log.info({ provider, eventId: event.eventId }, 'duplicate webhook ignored');
      return ok(reply, { received: true, duplicate: true });
    }

    const payment = await findPaymentByReference(event.reference);
    if (!payment) {
      await db
        .update(paymentWebhookEvents)
        .set({ status: 'ignored', processedAt: new Date(), error: 'No matching payment reference.' })
        .where(eq(paymentWebhookEvents.eventId, event.eventId));
      return ok(reply, { received: true, matched: false });
    }

    // The gateway is authoritative for status, but the amount and currency must
    // still match what we asked for — a mismatch is never treated as success.
    if (event.status === 'paid') {
      const amountMatches = !event.amount || Number(event.amount) === Number(payment.amount);
      const currencyMatches = !event.currency || event.currency === payment.currency;

      if (!amountMatches || !currencyMatches) {
        request.log.error(
          { paymentId: payment.id, expected: payment.amount, received: event.amount },
          'webhook amount/currency mismatch',
        );
        await markPaymentFailed(payment.id, 'Amount or currency did not match the pending payment.');
        await db
          .update(paymentWebhookEvents)
          .set({ status: 'failed', processedAt: new Date(), error: 'amount_mismatch', paymentId: payment.id })
          .where(eq(paymentWebhookEvents.eventId, event.eventId));
        return ok(reply, { received: true, applied: false });
      }

      if (payment.status !== 'paid') {
        await markPaymentPaid(payment.id, event.transactionId);

        // A card authorisation only puts the instrument on file; a real charge
        // is what activates a subscription. Onboarding advances either way.
        if (payment.purpose === 'method_setup') {
          await recordPaymentMethodForPayment(payment.id);
          // A trial is billed 0.00 rather than not billed at all. The invoice is
          // what makes the billing process complete — and what the client has to
          // point at to say the bill was settled before the store was built.
          await issueInvoiceForPayment(payment.id);
        } else {
          await activateSubscriptionForPayment(payment.id);
        }

        await advanceOnboardingAfterPayment(payment.clientAccountId);
      }
    } else if (event.status === 'failed') {
      await markPaymentFailed(payment.id, 'The payment gateway reported a failure.');
    } else if (event.status === 'refunded') {
      await markPaymentRefunded(payment.id);
    }

    await db
      .update(paymentWebhookEvents)
      .set({ status: 'processed', processedAt: new Date(), paymentId: payment.id })
      .where(eq(paymentWebhookEvents.eventId, event.eventId));

    return ok(reply, { received: true, applied: true });
  });

  /**
   * Development-only checkout stub. It signs and posts a real webhook to itself,
   * so the whole verified-payment path is exercised without a live gateway.
   */
  app.get('/mock-checkout', async (request, reply) => {
    if (isProduction || config.payment.provider !== 'mock') {
      throw new AppError(ERROR_CODES.NOT_FOUND, 'Not available.', 404);
    }

    const query = parseQuery(
      z.object({
        reference: z.string().trim().min(4).max(64),
        amount: z.string().trim(),
        currency: z.string().trim().length(3),
        /**
         * Where the stub sends the browser once it has settled.
         *
         * `httpsUrl` rather than `z.string().url()`, which is not a scheme check
         * — it accepts `javascript:`, and this value is handed straight to
         * `reply.redirect`. The route is development-only, but a redirector that
         * is only safe because the route is unreachable is one refactor away
         * from not being safe at all.
         */
        redirect: httpsUrl().optional(),
      }),
      request.query,
    );

    const payload = JSON.stringify({
      eventId: `evt_${query.reference}_${Date.now()}`,
      eventType: 'payment.succeeded',
      reference: query.reference,
      transactionId: `txn_${query.reference}`,
      amount: query.amount,
      currency: query.currency.toUpperCase(),
      status: 'paid',
    });

    const response = await fetch(`${config.api.publicUrl}/api/v1/webhooks/payments/mock`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-signature': signMockPayload(payload) },
      body: payload,
    });

    const settled = response.ok;
    const target = query.redirect ?? `${config.urls.website}/account/billing`;
    return reply.redirect(`${target}${target.includes('?') ? '&' : '?'}payment=${settled ? 'success' : 'failed'}`);
  });
}

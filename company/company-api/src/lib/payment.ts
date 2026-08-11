import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config/index';
import { logger } from './logger';

export interface CheckoutRequest {
  reference: string;
  amount: string;
  currency: string;
  description: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  checkoutUrl: string;
  providerReference: string | null;
}

export interface WebhookEvent {
  eventId: string;
  eventType: string;
  reference: string;
  transactionId: string | null;
  amount: string | null;
  currency: string | null;
  status: 'paid' | 'failed' | 'refunded' | 'pending';
}

/**
 * Gateway abstraction. Only two things matter for correctness here:
 * 1. a checkout URL is never treated as proof of payment;
 * 2. every inbound webhook is signature-verified before it is trusted.
 */
export interface PaymentProvider {
  readonly name: string;
  createCheckout(input: CheckoutRequest): Promise<CheckoutSession>;
  verifySignature(rawBody: string, signature: string | undefined): boolean;
  parseEvent(payload: unknown): WebhookEvent | null;
}

function hmacSha256Hex(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

function safeCompare(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Development provider. It still signs its callbacks with the real webhook
 * secret, so the verification path is exercised exactly as in production.
 */
const mockProvider: PaymentProvider = {
  name: 'mock',

  async createCheckout(input) {
    const url = new URL('/api/v1/webhooks/mock-checkout', config.api.publicUrl);
    url.searchParams.set('reference', input.reference);
    url.searchParams.set('amount', input.amount);
    url.searchParams.set('currency', input.currency);
    url.searchParams.set('redirect', input.successUrl);
    return { checkoutUrl: url.toString(), providerReference: null };
  },

  verifySignature(rawBody, signature) {
    if (!signature) return false;
    return safeCompare(signature, hmacSha256Hex(rawBody, config.payment.webhookSecret));
  },

  parseEvent(payload) {
    const body = payload as Partial<WebhookEvent> & { reference?: string };
    if (!body?.eventId || !body?.reference) return null;
    return {
      eventId: String(body.eventId),
      eventType: String(body.eventType ?? 'payment.updated'),
      reference: String(body.reference),
      transactionId: body.transactionId ? String(body.transactionId) : null,
      amount: body.amount ? String(body.amount) : null,
      currency: body.currency ? String(body.currency) : null,
      status: (body.status as WebhookEvent['status']) ?? 'pending',
    };
  },
};

/**
 * Stripe-shaped adapter. Checkout-session creation is intentionally left to the
 * deployment that supplies real keys; signature verification and event parsing
 * follow Stripe's documented format.
 */
const stripeProvider: PaymentProvider = {
  name: 'stripe',

  async createCheckout() {
    throw new Error('Stripe checkout is not configured. Set PAYMENT_PROVIDER=mock or supply an implementation.');
  },

  verifySignature(rawBody, signature) {
    if (!signature) return false;
    // Stripe sends: t=<timestamp>,v1=<signature>
    const parts = Object.fromEntries(
      signature.split(',').map((part) => {
        const [key, value] = part.split('=');
        return [key?.trim() ?? '', value?.trim() ?? ''];
      }),
    );
    const timestamp = parts.t;
    const provided = parts.v1;
    if (!timestamp || !provided) return false;

    // Reject replays of anything older than five minutes.
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(age) || age > 300) return false;

    return safeCompare(provided, hmacSha256Hex(`${timestamp}.${rawBody}`, config.payment.webhookSecret));
  },

  parseEvent(payload) {
    const body = payload as {
      id?: string;
      type?: string;
      data?: { object?: { client_reference_id?: string; id?: string; amount_total?: number; currency?: string } };
    };
    const object = body?.data?.object;
    if (!body?.id || !object?.client_reference_id) return null;

    const type = String(body.type ?? '');
    const status: WebhookEvent['status'] =
      type.includes('succeeded') || type.includes('completed')
        ? 'paid'
        : type.includes('refund')
          ? 'refunded'
          : type.includes('failed')
            ? 'failed'
            : 'pending';

    return {
      eventId: String(body.id),
      eventType: type || 'unknown',
      reference: String(object.client_reference_id),
      transactionId: object.id ? String(object.id) : null,
      amount: typeof object.amount_total === 'number' ? (object.amount_total / 100).toFixed(2) : null,
      currency: object.currency ? String(object.currency).toUpperCase() : null,
      status,
    };
  },
};

const sslcommerzProvider: PaymentProvider = {
  name: 'sslcommerz',

  async createCheckout() {
    throw new Error('SSLCommerz checkout is not configured. Set PAYMENT_PROVIDER=mock or supply an implementation.');
  },

  verifySignature(rawBody, signature) {
    if (!signature) return false;
    return safeCompare(signature, hmacSha256Hex(rawBody, config.payment.webhookSecret));
  },

  parseEvent(payload) {
    const body = payload as {
      tran_id?: string;
      val_id?: string;
      status?: string;
      amount?: string;
      currency?: string;
    };
    if (!body?.tran_id) return null;

    const raw = String(body.status ?? '').toUpperCase();
    const status: WebhookEvent['status'] =
      raw === 'VALID' || raw === 'VALIDATED'
        ? 'paid'
        : raw === 'REFUNDED'
          ? 'refunded'
          : raw === 'FAILED' || raw === 'CANCELLED'
            ? 'failed'
            : 'pending';

    return {
      eventId: String(body.val_id ?? body.tran_id),
      eventType: `sslcommerz.${raw.toLowerCase() || 'unknown'}`,
      reference: String(body.tran_id),
      transactionId: body.val_id ? String(body.val_id) : null,
      amount: body.amount ? String(body.amount) : null,
      currency: body.currency ? String(body.currency).toUpperCase() : null,
      status,
    };
  },
};

const PROVIDERS: Record<string, PaymentProvider> = {
  mock: mockProvider,
  stripe: stripeProvider,
  sslcommerz: sslcommerzProvider,
};

export function getPaymentProvider(name: string = config.payment.provider): PaymentProvider {
  const provider = PROVIDERS[name];
  if (!provider) {
    logger.error({ provider: name }, 'unknown payment provider, falling back to mock');
    return mockProvider;
  }
  return provider;
}

/** Exposed so the development checkout stub can sign its own callback. */
export function signMockPayload(rawBody: string): string {
  return hmacSha256Hex(rawBody, config.payment.webhookSecret);
}

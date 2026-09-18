import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { discountCustomers, discounts, orders, paymentMethods } from '../../db/schema/index';
import { describeOffer } from '../../lib/discounts/engine';
import { PAYMENT_CHANNEL_CHOICES } from '../../lib/discounts/rules';
import { ok, parseBody } from '../../lib/http';
import { enforce } from '../../lib/rate-limit';
import { storeOf } from '../../plugins/tenant';
import { issueRewardsQuietly } from '../discounts/rewards';
import {
  MAX_CODES,
  fromCents,
  loadDiscountSettings,
  moneyFormatter,
  quoteDiscounts,
  quoteView,
  resolveChannel,
  toCents,
  toEngineDiscount,
} from '../discounts/service';
import { priceLines } from './checkout.service';
import { loadMeasureDefaults } from './service';

const quoteSchema = z.object({
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid(),
        quantity: z.coerce.number().int().min(1).max(99),
        measure: z.coerce.number().int().min(1).max(10_000_000).nullable().optional(),
      }),
    )
    .min(1, 'Your basket is empty.')
    .max(50),
  codes: z.array(z.string().trim().max(40)).max(MAX_CODES).default([]),
  paymentProvider: z.string().trim().max(40).nullable().optional(),
  paymentChannel: z.enum(PAYMENT_CHANNEL_CHOICES).nullable().optional(),
  cardBin: z
    .string()
    .trim()
    .regex(/^\d{6,8}$/)
    .nullable()
    .optional()
    .catch(null),
  /** Where the order is going, for a discount limited to an area. */
  shippingAddress: z
    .object({
      country: z.string().trim().max(60),
      city: z.string().trim().max(80),
    })
    .nullable()
    .optional(),
});

/**
 * What a basket is worth, before it is an order.
 *
 * The basket lives in `localStorage` and can only ever show an estimate of its
 * prices, but the *discount* must not be an estimate. This runs exactly the
 * engine checkout runs — same prices from the database, same customer, same
 * rules — with whatever the shopper has told us so far: nothing about payment
 * or delivery on the cart page, both on the checkout page. The refusal
 * sentences come back with it, so the basket never has to phrase a rule it does
 * not hold.
 *
 * `optionalCustomer`, because it is asked before the sign-in an order needs. A
 * code for a named group of customers answers "Sign in to use this offer"
 * rather than pretending to apply.
 */
export default async function storefrontDiscountRoutes(app: FastifyInstance) {
  app.post('/discounts/quote', { preHandler: [app.optionalCustomer] }, async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(quoteSchema, request.body);
    await enforce(request, 'discount-quote', { max: 90, windowSeconds: 60 });

    const customerId = request.customer?.customerId ?? null;
    // A birthday or win-back voucher is issued on the customer's own visit.
    await issueRewardsQuietly(store.db, customerId, 'visit');

    const [settings, measureDefaults] = await Promise.all([loadDiscountSettings(store), loadMeasureDefaults(store)]);
    const lines = await priceLines(store.db, body.lines, measureDefaults);
    const subtotal = lines.reduce((sum, line) => sum + toCents(line.lineTotal), 0);

    // Payment counts only for a provider the shop has switched on.
    let channel: (typeof PAYMENT_CHANNEL_CHOICES)[number] | null = null;
    if (body.paymentProvider) {
      const [enabled] = await store.db
        .select({ provider: paymentMethods.provider })
        .from(paymentMethods)
        .where(sql`${paymentMethods.provider}::text = ${body.paymentProvider} and ${paymentMethods.isEnabled} = true`)
        .limit(1);
      if (enabled) {
        try {
          channel = resolveChannel(enabled.provider, body.paymentChannel ?? null);
        } catch {
          channel = null;
        }
      }
    }

    const quote = await quoteDiscounts(store.db, settings, {
      lines,
      codes: body.codes,
      address: body.shippingAddress ? { country: body.shippingAddress.country, city: body.shippingAddress.city } : null,
      customerId,
      contact: { email: request.customer?.email ?? null },
      payment: { channel, cardBin: channel === 'card' ? (body.cardBin ?? null) : null },
    });

    return ok(reply, {
      ...quoteView(quote, lines),
      signedIn: customerId !== null,
      total: fromCents(Math.max(0, subtotal - quote.itemCents)),
    });
  });

  /**
   * The vouchers in a customer's account, spent and expired ones included —
   * a voucher that silently vanishes reads as one that was taken away.
   */
  app.get('/account/vouchers', { preHandler: [app.requireCustomer] }, async (request, reply) => {
    const store = storeOf(request);
    const customerId = request.customer!.customerId;
    await issueRewardsQuietly(store.db, customerId, 'visit');

    const settings = await loadDiscountSettings(store);
    const money = moneyFormatter(settings.currency);

    const rows = await store.db
      .select({
        holding: discountCustomers,
        discount: discounts,
        orderNumber: orders.orderNumber,
      })
      .from(discountCustomers)
      .innerJoin(discounts, eq(discounts.id, discountCustomers.discountId))
      .leftJoin(orders, eq(orders.id, discountCustomers.orderId))
      .where(
        and(
          eq(discountCustomers.customerId, customerId),
          eq(discounts.kind, 'voucher'),
          isNull(discounts.archivedAt),
          ne(discounts.status, 'draft'),
        ),
      )
      .orderBy(sql`${discountCustomers.usedAt} is not null`, asc(discountCustomers.expiresAt), asc(discounts.endsAt));

    const now = Date.now();

    return ok(
      reply,
      rows.map(({ holding, discount, orderNumber }) => {
        const engine = toEngineDiscount(discount, settings.timezone);
        const expiresAt = [holding.expiresAt, discount.endsAt]
          .filter((value): value is Date => value !== null)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

        const state = holding.usedAt
          ? 'used'
          : expiresAt && expiresAt.getTime() <= now
            ? 'expired'
            : discount.status === 'paused'
              ? 'unavailable'
              : discount.startsAt && discount.startsAt.getTime() > now
                ? 'upcoming'
                : 'available';

        return {
          id: holding.id,
          code: discount.code,
          label: discount.title?.trim() || describeOffer(engine, money),
          summary: discount.summary,
          offer: describeOffer(engine, money),
          minOrderAmount: discount.minOrderAmount,
          maxDiscountAmount: discount.maxDiscountAmount,
          startsAt: discount.startsAt?.toISOString() ?? null,
          expiresAt: expiresAt?.toISOString() ?? null,
          issuedAt: holding.issuedAt.toISOString(),
          usedAt: holding.usedAt?.toISOString() ?? null,
          orderNumber: holding.usedAt ? orderNumber : null,
          state,
        };
      }),
    );
  });
}

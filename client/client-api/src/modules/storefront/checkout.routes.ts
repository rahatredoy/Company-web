import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  couponRedemptions,
  coupons,
  inventoryTransactions,
  orderAddresses,
  orderItems,
  orderStatusHistory,
  orders,
  paymentMethods,
  payments,
} from '../../db/schema/index';
import type { TenantExecutor } from '../../db/tenant-manager';
import { RATE_LIMITS } from '../../lib/constants';
import { ERROR_CODES, unprocessable } from '../../lib/errors';
import { clientIp, ok, parseBody, parseQuery } from '../../lib/http';
import { enforce } from '../../lib/rate-limit';
import { moneyToNumber, toMoney } from '../../lib/utils';
import { storeOf, type StoreContext } from '../../plugins/tenant';
import {
  applyCoupon,
  CouponError,
  priceLines,
  quoteShipping,
  reserveStock,
  type PricedLine,
} from './checkout.service';
import { claimOrderNumber } from './orders.service';
import { rememberGuestOrder } from './guest-orders';
import { loadStoreCurrency } from './service';

const shippingQuerySchema = z.object({
  country: z.string().trim().max(60).optional(),
  city: z.string().trim().max(80).optional(),
  postalCode: z.string().trim().max(20).optional(),
});

const addressSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter a name.').max(120),
  phone: z.string().trim().min(6, 'Enter a phone number.').max(32),
  addressLine1: z.string().trim().min(3, 'Enter the street address.').max(200),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().min(2, 'Enter a city.').max(80),
  state: z.string().trim().max(80).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  country: z.string().trim().min(2, 'Choose a country.').max(60),
});

const checkoutSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(254),
  phone: z.string().trim().min(6, 'Enter a phone number.').max(32),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        variantId: z.string().uuid(),
        quantity: z.coerce.number().int().min(1).max(99),
      }),
    )
    .min(1, 'Your basket is empty.')
    .max(50),
  shippingAddress: addressSchema,
  shippingMethodId: z.string().trim().min(1).max(40),
  paymentProvider: z.string().trim().min(1).max(40),
  couponCode: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const couponSchema = z.object({
  code: z.string().trim().min(1, 'Enter a code.').max(40),
  subtotal: z.coerce.number().min(0).default(0),
});

/**
 * Taking an order.
 *
 * Guest-capable by design — requiring an account to buy something is how a shop
 * loses the sale — so `optionalCustomer` attaches the shopper when there is one
 * and says nothing when there is not.
 */
export default async function checkoutRoutes(app: FastifyInstance) {
  app.get('/checkout/shipping-methods', async (request, reply) => {
    const store = storeOf(request);
    const query = parseQuery(shippingQuerySchema, request.query);
    return ok(reply, await quoteShipping(store.db, query));
  });

  /**
   * Server-side coupon check for the cart.
   *
   * The cart is browser-local and its totals are an estimate, but the *discount*
   * cannot be: a figure shown in the basket and a different one charged at the
   * till is a complaint every time. This is the same function checkout itself
   * calls, so the two can never drift.
   */
  app.post('/coupons/validate', { preHandler: [app.optionalCustomer] }, async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(couponSchema, request.body);
    await enforce(request, 'coupon-validate', RATE_LIMITS.bulkWrite);

    try {
      const outcome = await applyCoupon(store.db, body.code, body.subtotal, {
        customerId: request.customer?.customerId ?? null,
        email: request.customer?.email ?? null,
      });
      return ok(reply, { valid: true as const, ...outcome });
    } catch (error) {
      if (error instanceof CouponError) {
        return ok(reply, { valid: false as const, reason: error.refusal, message: error.message });
      }
      throw error;
    }
  });

  app.post('/checkout', { preHandler: [app.optionalCustomer] }, async (request, reply) => {
    const store = storeOf(request);
    const body = parseBody(checkoutSchema, request.body);
    await enforce(request, 'checkout', { max: 12, windowSeconds: 60 });

    const currency = await loadStoreCurrency(store);
    const method = await resolvePaymentMethod(store, body.paymentProvider);

    const placed = await store.db.transaction(async (tx) => {
      const lines = await priceLines(tx, body.lines);
      const subtotal = lines.reduce((sum, line) => sum + moneyToNumber(line.lineTotal), 0);

      const shipping = await resolveShipping(tx, body, subtotal);
      const coupon = await resolveCoupon(tx, body.couponCode, subtotal, request.customer, body.email);

      const discount = moneyToNumber(coupon?.discount ?? '0');
      const shippingTotal = moneyToNumber(shipping.price);
      // Tax is not modelled yet; it is carried as an explicit zero rather than
      // omitted, so the receipt's arithmetic is visible and adds up.
      const grandTotal = Math.max(0, subtotal - discount + shippingTotal);

      const orderNumber = await claimOrderNumber(tx);

      const [order] = await tx
        .insert(orders)
        .values({
          orderNumber,
          customerId: request.customer?.customerId ?? null,
          email: body.email,
          phone: body.phone,
          customerName: body.shippingAddress.fullName,
          status: 'pending',
          paymentStatus: method.provider === 'cod' ? 'cod_pending' : 'pending',
          currency,
          subtotal: toMoney(subtotal),
          discountTotal: toMoney(discount),
          taxTotal: '0.00',
          shippingTotal: toMoney(shippingTotal),
          grandTotal: toMoney(grandTotal),
          couponCode: coupon?.code ?? null,
          couponId: coupon?.id ?? null,
          paymentProvider: method.provider,
          paymentMethodLabel: method.label,
          shippingMethodId: shipping.id,
          shippingMethodLabel: shipping.name,
          estimatedDeliveryAt: estimatedDelivery(shipping.estimatedDaysMax),
          customerNote: body.notes ?? null,
          ipAddress: clientIp(request) || null,
        })
        .returning();

      await tx.insert(orderItems).values(
        lines.map((line) => ({
          orderId: order!.id,
          productId: line.productId,
          variantId: line.variantId,
          productName: line.productName,
          variantTitle: line.variantTitle,
          sku: line.sku,
          imageUrl: line.imageUrl,
          unitPrice: line.unitPrice,
          unitSalePrice: line.unitSalePrice,
          quantity: line.quantity,
          lineTotal: line.lineTotal,
        })),
      );

      await tx.insert(orderAddresses).values({
        orderId: order!.id,
        type: 'shipping',
        fullName: body.shippingAddress.fullName,
        phone: body.shippingAddress.phone,
        addressLine1: body.shippingAddress.addressLine1,
        addressLine2: body.shippingAddress.addressLine2 ?? null,
        city: body.shippingAddress.city,
        state: body.shippingAddress.state ?? null,
        postalCode: body.shippingAddress.postalCode ?? null,
        country: body.shippingAddress.country,
      });

      await tx.insert(orderStatusHistory).values({
        orderId: order!.id,
        toStatus: 'pending',
        note: 'Order placed',
      });

      await commitStock(tx, order!.id, lines);

      if (coupon) {
        await tx.insert(couponRedemptions).values({
          couponId: coupon.id,
          orderId: order!.id,
          customerId: request.customer?.customerId ?? null,
          email: request.customer ? null : body.email,
          discountAmount: coupon.discount,
        });

        // Conditional so a coupon cannot be pushed past its own limit by two
        // orders committing at the same moment.
        await tx
          .update(coupons)
          .set({ usedCount: sql`${coupons.usedCount} + 1` })
          .where(eq(coupons.id, coupon.id));
      }

      await tx.insert(payments).values({
        orderId: order!.id,
        provider: method.provider,
        status: method.provider === 'cod' ? 'pending' : 'pending',
        amount: toMoney(grandTotal),
        currency,
        clientReference: orderNumber,
      });

      return { id: order!.id, orderNumber, grandTotal: toMoney(grandTotal) };
    });

    /*
     * Lets this browser read its own receipt.
     *
     * `/checkout/success/<n>` fetches the order straight after this returns, and
     * a guest has no session to authorise it with. Without this they would be
     * bounced off the confirmation page for the order they had just paid for.
     */
    await rememberGuestOrder(request, reply, store, placed.orderNumber);

    return ok(
      reply,
      {
        orderNumber: placed.orderNumber,
        paymentRedirectUrl:
          method.provider === 'cod'
            ? null
            : mockGatewayUrl(request, placed.orderNumber),
      },
      201,
    );
  });
}

/**
 * Only a method the owner switched on may be chosen.
 *
 * Checked against `is_enabled` rather than against the provider enum, because
 * the enum lists every adapter the platform can speak and a store has almost
 * certainly configured none of them. A disabled provider and an unknown one get
 * the same answer.
 */
async function resolvePaymentMethod(store: StoreContext, provider: string) {
  const [enabled] = await store.db
    .select({ provider: paymentMethods.provider, label: paymentMethods.label })
    .from(paymentMethods)
    .where(
      sql`${paymentMethods.provider}::text = ${provider} and ${paymentMethods.isEnabled} = true`,
    )
    .limit(1);

  if (!enabled) {
    throw unprocessable('That payment method is not available.', ERROR_CODES.VALIDATION_FAILED, {
      paymentProvider: ['Choose a payment method.'],
    });
  }

  return enabled;
}

/** The quoted price is re-derived here; the browser's copy is never trusted. */
async function resolveShipping(
  tx: TenantExecutor,
  body: { shippingMethodId: string; shippingAddress: { country: string; city: string } },
  subtotal: number,
) {
  const quotes = await quoteShipping(
    tx,
    { country: body.shippingAddress.country, city: body.shippingAddress.city },
    subtotal,
  );

  const chosen = quotes.find((quote) => quote.id === body.shippingMethodId);
  if (!chosen) {
    throw unprocessable(
      'That delivery option is not available for this address.',
      ERROR_CODES.VALIDATION_FAILED,
      { shippingMethodId: ['Choose a delivery option.'] },
    );
  }

  return chosen;
}

async function resolveCoupon(
  tx: TenantExecutor,
  code: string | null | undefined,
  subtotal: number,
  customer: FastifyRequest['customer'],
  email: string,
) {
  if (!code) return null;

  try {
    return await applyCoupon(tx, code, subtotal, {
      customerId: customer?.customerId ?? null,
      email: customer ? null : email,
    });
  } catch (error) {
    if (error instanceof CouponError) {
      throw unprocessable(error.message, ERROR_CODES.COUPON_EXPIRED, { couponCode: [error.message] });
    }
    throw error;
  }
}

/**
 * Reserves every line, or fails the whole order.
 *
 * Inside the checkout transaction, so a line that cannot be reserved rolls back
 * the ones that already were — a half-reserved order would hold stock nobody can
 * buy and nobody will ship.
 */
async function commitStock(tx: TenantExecutor, orderId: string, lines: PricedLine[]): Promise<void> {
  for (const line of lines) {
    const outcome = await reserveStock(tx, line.variantId, line.quantity);

    if (!outcome.reserved) {
      throw unprocessable(
        `There is not enough stock left of ${line.productName}.`,
        ERROR_CODES.INSUFFICIENT_STOCK,
        { lines: [`${line.productName} is out of stock.`] },
      );
    }

    // Untracked stock moves nothing, so there is nothing to record.
    if (!outcome.tracked || !outcome.warehouseId) continue;

    await tx.insert(inventoryTransactions).values({
      variantId: line.variantId,
      warehouseId: outcome.warehouseId,
      type: 'order_reserved',
      quantity: -line.quantity,
      fromBucket: 'available',
      toBucket: 'reserved',
      availableAfter: outcome.availableAfter,
      reservedAfter: 0,
      referenceType: 'order',
      referenceId: orderId,
    });
  }
}

function estimatedDelivery(days: number | null): Date | null {
  if (days === null) return null;
  const at = new Date();
  at.setDate(at.getDate() + days);
  return at;
}

/**
 * Where the browser is sent to "pay".
 *
 * Built from the request's own host so it lands back on the store the customer
 * is actually shopping on — the same hostname that identified the tenant in the
 * first place.
 */
function mockGatewayUrl(request: FastifyRequest, orderNumber: string): string {
  const proto = (request.headers['x-forwarded-proto'] as string | undefined) ?? request.protocol;
  const host = request.headers.host ?? '';
  return `${proto}://${host}/api/v1/storefront/payments/mock/${encodeURIComponent(orderNumber)}`;
}

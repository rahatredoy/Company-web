import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  customerAddresses,
  inventoryTransactions,
  orderAddresses,
  orderItems,
  orderStatusHistory,
  orders,
  paymentMethods,
  payments,
} from '../../db/schema/index';
import type { TenantExecutor } from '../../db/tenant-manager';
import { ERROR_CODES, unprocessable } from '../../lib/errors';
import { clientIp, ok, parseBody } from '../../lib/http';
import { enforce } from '../../lib/rate-limit';
import { moneyToNumber, toMoney } from '../../lib/utils';
import { storeOf, type StoreContext } from '../../plugins/tenant';
import { priceLines, reserveStock, type PricedLine } from './checkout.service';
import { claimOrderNumber } from './orders.service';
import { loadMeasureDefaults } from './service';
import { PAYMENT_CHANNEL_CHOICES } from '../../lib/discounts/rules';
import {
  MAX_CODES,
  fromCents,
  loadDiscountSettings,
  lockCustomerDiscounts,
  normaliseCodes,
  quoteDiscounts,
  redeemDiscounts,
  resolveChannel,
  toCents,
} from '../discounts/service';

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
        /**
         * Which size was picked, in base units, for a product sold by weight or
         * volume — 500 for half a kilo. Optional, and validated against the
         * product's own list in `priceLines`; a line that omits it on a measure
         * product is priced at the product's own pricing measure, which is what
         * the "Per 1kg" on the card advertises.
         */
        measure: z.coerce.number().int().min(1).max(10_000_000).nullable().optional(),
      }),
    )
    .min(1, 'Your basket is empty.')
    .max(50),
  shippingAddress: addressSchema,
  /**
   * Which saved address the form was filled from, if any.
   *
   * It is what makes an edit made at the till an **edit**: without it the only
   * honest thing to do with a changed address is add it beside the old one, and
   * the next checkout would prefill whichever of the two was default — usually
   * the one the shopper had just corrected. Optional, because a first order has
   * no saved address to have come from, and never trusted: `rememberAddress`
   * matches it against the sender's own rows in the WHERE clause.
   */
  shippingAddressId: z.string().uuid().nullable().optional(),
  paymentProvider: z.string().trim().min(1).max(40),
  /**
   * What the shopper is paying with under that provider — a card, bKash, Nagad.
   * Only ever used to decide a bank or wallet offer, and checked against what
   * the provider can actually take.
   */
  paymentChannel: z.enum(PAYMENT_CHANNEL_CHOICES).nullable().optional(),
  /**
   * The first 6 to 8 digits of the card, for a card offer. Never the whole
   * number: this is the issuer prefix, which says whose card it is and nothing
   * that could charge it.
   */
  cardBin: z
    .string()
    .trim()
    .regex(/^\d{6,8}$/, 'Enter the first 6 digits of your card.')
    .nullable()
    .optional(),
  /** Every code in the basket. `couponCode` is the single-code form older baskets still send. */
  couponCodes: z.array(z.string().trim().max(40)).max(MAX_CODES).optional(),
  couponCode: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

/**
 * Taking an order.
 *
 * **An order needs an account.** `POST /checkout` is guarded by
 * `requireCustomer`, so a signed-out basket is refused with a 401 rather than
 * taken as a guest: every order belongs to a customer record, and the shop can
 * answer "who bought this" without matching an email address typed at the till.
 *
 * This is the *only* place that decision is enforceable. The storefront sends
 * `/checkout` to the sign-in page first, but a redirect is a courtesy to
 * somebody using a browser — the guard is what makes it true of a POST from
 * anything else.
 *
 * Discounts are priced for the basket by `POST /discounts/quote`
 * (`discounts.routes.ts`), which keeps `optionalCustomer` — it is asked before
 * the sign-in the order will require, and refusing to price a code until then
 * would hide the discount at the moment it is being decided on. Checkout runs
 * the same engine again, inside the order transaction, and its answer is the
 * one charged.
 */
export default async function checkoutRoutes(app: FastifyInstance) {
  app.post('/checkout', { preHandler: [app.requireCustomer] }, async (request, reply) => {
    const store = storeOf(request);
    // Guaranteed by `requireCustomer`. Named once so the order, its coupon
    // redemption and anything added later attach to the same shopper.
    const customer = request.customer!;
    const body = parseBody(checkoutSchema, request.body);
    await enforce(request, 'checkout', { max: 12, windowSeconds: 60 });

    const settings = await loadDiscountSettings(store);
    const currency = settings.currency;
    const method = await resolvePaymentMethod(store, body.paymentProvider);
    const channel = resolveChannel(method.provider, body.paymentChannel ?? null);
    const cardBin = channel === 'card' ? (body.cardBin ?? null) : null;
    const codes = normaliseCodes([...(body.couponCodes ?? []), body.couponCode]);
    const measureDefaults = await loadMeasureDefaults(store);

    const placed = await store.db.transaction(async (tx) => {
      // Before anything is read: a second checkout by the same customer waits
      // here, so the two cannot both spend one voucher or one allowance.
      await lockCustomerDiscounts(tx, customer.customerId);

      const lines = await priceLines(tx, body.lines, measureDefaults);
      const subtotal = lines.reduce((sum, line) => sum + moneyToNumber(line.lineTotal), 0);

      const quote = await quoteDiscounts(tx, settings, {
        lines,
        codes,
        address: { country: body.shippingAddress.country, city: body.shippingAddress.city },
        customerId: customer.customerId,
        contact: { email: body.email, phone: body.phone },
        payment: { channel, cardBin },
      });

      /*
       * A code the shopper entered that does not apply stops the order rather
       * than being dropped from it. They were shown a total with it; charging a
       * different one without saying so is the one thing a till must not do.
       */
      const refusal = quote.refused[0];
      if (refusal) {
        throw unprocessable(refusal.message, ERROR_CODES.DISCOUNT_NOT_APPLICABLE, {
          couponCodes: quote.refused.map((entry) => `${entry.code}: ${entry.message}`),
        });
      }

      // There is no delivery charge: the total is the subtotal less discounts.
      // Tax is not modelled yet; it is carried as an explicit zero rather than
      // omitted, so the receipt's arithmetic is visible and adds up. Worked in
      // cents so the figures on the receipt add up exactly.
      const grandCents = Math.max(0, toCents(subtotal) - quote.itemCents);
      const discount = quote.itemCents / 100;
      const grandTotal = grandCents / 100;
      const appliedCodes = quote.applied.filter((entry) => entry.code);

      const orderNumber = await claimOrderNumber(tx);

      const [order] = await tx
        .insert(orders)
        .values({
          orderNumber,
          customerId: customer.customerId,
          email: body.email,
          phone: body.phone,
          customerName: body.shippingAddress.fullName,
          status: 'pending',
          paymentStatus: method.provider === 'cod' ? 'cod_pending' : 'pending',
          currency,
          subtotal: toMoney(subtotal),
          discountTotal: toMoney(discount),
          taxTotal: '0.00',
          grandTotal: toMoney(grandTotal),
          couponCode: appliedCodes.map((entry) => entry.code).join(', ').slice(0, 200) || null,
          couponId: appliedCodes[0]?.id ?? null,
          paymentProvider: method.provider,
          paymentMethodLabel: method.label,
          paymentChannel: channel,
          cardBin,
          customerNote: body.notes ?? null,
          ipAddress: clientIp(request) || null,
        })
        .returning();

      await tx.insert(orderItems).values(
        lines.map((line, index) => ({
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
          measureLabel: line.measureLabel,
          measure: line.measure,
          // This line's share of every discount on the order, so a return or a
          // report can say what the line was actually sold for.
          lineDiscount: fromCents(quote.lineCents[String(index)] ?? 0),
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

      await redeemDiscounts(tx, {
        orderId: order!.id,
        customerId: customer.customerId,
        quote,
        originalCents: toCents(subtotal),
        finalCents: grandCents,
      });

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
     * Written after the order commits, for the reason `audit()` is: the address
     * book is a convenience, and a shopper whose order was taken must never be
     * told it failed because we could not remember where they live. Its failure
     * costs the next checkout's prefill and nothing else, so it is logged rather
     * than raised.
     */
    await rememberAddress(
      store,
      customer.customerId,
      body.shippingAddress,
      body.shippingAddressId ?? null,
    ).catch((error: unknown) => {
      request.log.warn({ err: error }, 'could not save the checkout address to the address book');
    });

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
 * Where the order was sent, kept so the next checkout opens already filled in.
 *
 * Nothing else writes this: an order's address is snapshotted onto
 * `order_addresses` and is deliberately frozen there, so without this the
 * address book stayed empty for every shopper who never opened
 * `/account/addresses` — and the checkout form, which prefills from it, asked
 * the same nine questions on every single order.
 *
 * Three outcomes, in this order, and the order is the whole design.
 *
 * 1. **An address the customer already has saved is left exactly as it is.**
 *    Ordering twice to the same place must not fill the address book with
 *    copies of itself, and it is compared on its content rather than on its id
 *    because the same address typed again is the same address.
 * 2. **Otherwise the address the form was filled from is updated in place.**
 *    What the shopper corrected at the till is what they meant; adding the
 *    correction beside the original would prefill whichever of the two happened
 *    to be default next time, which is as likely as not the one they had just
 *    fixed.
 * 3. **Otherwise it is written as a new address**, which is the first order,
 *    and — only when it is the only one — the default. A one-off address never
 *    takes the default away from a book the shopper has curated themselves.
 *
 * `sourceId` came from the browser and is therefore matched against the
 * sender's own rows in the WHERE clause rather than trusted. The worst a forged
 * one can do is overwrite an address belonging to whoever sent it.
 */
async function rememberAddress(
  store: StoreContext,
  customerId: string,
  submitted: z.infer<typeof addressSchema>,
  sourceId: string | null,
): Promise<void> {
  /*
   * `customer_addresses.phone` is narrower than checkout's own phone field. The
   * order itself carries the number in full; a truncated copy here would prefill
   * a wrong phone on every later order, so an over-long one is not remembered at
   * all rather than remembered incorrectly.
   */
  if (submitted.phone.length > 24) return;

  const address = {
    fullName: submitted.fullName,
    phone: submitted.phone,
    addressLine1: submitted.addressLine1,
    addressLine2: submitted.addressLine2 ?? null,
    city: submitted.city,
    state: submitted.state ?? null,
    postalCode: submitted.postalCode ?? null,
    country: submitted.country,
  };

  await store.db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(customerAddresses)
      .where(eq(customerAddresses.customerId, customerId));

    if (existing.some((row) => sameAddress(row, address))) return;

    const source = sourceId ? existing.find((row) => row.id === sourceId) : undefined;

    if (source) {
      await tx
        .update(customerAddresses)
        .set({ ...address, updatedAt: new Date() })
        .where(
          and(
            eq(customerAddresses.id, source.id),
            eq(customerAddresses.customerId, customerId),
          ),
        );
      return;
    }

    await tx.insert(customerAddresses).values({
      ...address,
      customerId,
      isDefault: existing.length === 0,
    });
  });
}

/**
 * Two addresses are the same address if every part of them reads the same.
 *
 * Compared on trimmed, case-folded text with runs of whitespace collapsed,
 * because "House 4, Road 12" and "house 4,  road 12" are one place and saving
 * both would defeat the point of the check. Every field is compared, phone and
 * name included: correcting only the phone number is a real edit, and treating
 * it as a match would quietly drop the correction.
 */
function sameAddress(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const fields = [
    'fullName',
    'phone',
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'postalCode',
    'country',
  ] as const;

  const normalise = (value: unknown): string =>
    typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';

  return fields.every((field) => normalise(a[field]) === normalise(b[field]));
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

/**
 * Reserves every line, or fails the whole order.
 *
 * Inside the checkout transaction, so a line that cannot be reserved rolls back
 * the ones that already were — a half-reserved order would hold stock nobody can
 * buy and nobody will ship.
 */
async function commitStock(tx: TenantExecutor, orderId: string, lines: PricedLine[]): Promise<void> {
  for (const line of lines) {
    /*
     * `stockUnits`, not `quantity`. For an ordinary product they are the same
     * number; for one sold by measure the quantity is how many 500gm bags and
     * this is the thousand grams they come to.
     */
    const outcome = await reserveStock(tx, line.variantId, line.stockUnits);

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
      quantity: -line.stockUnits,
      fromBucket: 'available',
      toBucket: 'reserved',
      availableAfter: outcome.availableAfter,
      reservedAfter: 0,
      referenceType: 'order',
      referenceId: orderId,
    });
  }
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

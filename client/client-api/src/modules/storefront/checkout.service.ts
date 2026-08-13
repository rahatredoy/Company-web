import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { TenantExecutor } from '../../db/tenant-manager';
import {
  couponRedemptions,
  coupons,
  productMedia,
  productVariants,
  products,
  shippingMethods,
  shippingZones,
} from '../../db/schema/index';
import { ERROR_CODES, unprocessable } from '../../lib/errors';
import { moneyToNumber, toMoney } from '../../lib/utils';
import { effectiveSale } from './service';

export interface RequestedLine {
  productId: string;
  variantId: string;
  quantity: number;
}

export interface PricedLine {
  productId: string;
  variantId: string;
  productName: string;
  variantTitle: string | null;
  sku: string;
  imageUrl: string | null;
  quantity: number;
  /** List price, kept so a receipt can show what was struck through. */
  unitPrice: string;
  /** What is actually charged, when a live sale beats the list price. */
  unitSalePrice: string | null;
  lineTotal: string;
}

/**
 * Re-prices the basket from the database.
 *
 * The browser sends ids and quantities and no money at all, which is the only
 * arrangement that can be trusted: the cart lives in `localStorage`, so anything
 * priced there is a number the customer could have edited. Everything below —
 * price, sale window, availability — is read fresh here and nothing from the
 * request survives except which variant and how many.
 */
export async function priceLines(db: TenantExecutor, requested: RequestedLine[]): Promise<PricedLine[]> {
  const variantIds = [...new Set(requested.map((line) => line.variantId))];

  const rows = await db
    .select({
      variantId: productVariants.id,
      productId: products.id,
      productName: products.name,
      variantTitle: productVariants.title,
      sku: productVariants.sku,
      variantImage: productVariants.imageUrl,
      price: productVariants.price,
      salePrice: productVariants.salePrice,
      saleStartsAt: productVariants.saleStartsAt,
      saleEndsAt: productVariants.saleEndsAt,
      status: products.status,
      variantActive: productVariants.isActive,
    })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.id, variantIds));

  const byVariant = new Map(rows.map((row) => [row.variantId, row]));

  // Fallback image: the product's own primary, for a variant that has none.
  const productIds = [...new Set(rows.map((row) => row.productId))];
  const media = productIds.length
    ? await db
        .select({ productId: productMedia.productId, url: productMedia.url })
        .from(productMedia)
        .where(and(inArray(productMedia.productId, productIds), eq(productMedia.type, 'image')))
        .orderBy(asc(productMedia.sortOrder))
    : [];

  const primaryImage = new Map<string, string>();
  for (const item of media) if (!primaryImage.has(item.productId)) primaryImage.set(item.productId, item.url);

  const priced: PricedLine[] = [];

  for (const line of requested) {
    const variant = byVariant.get(line.variantId);

    /*
     * An unknown, withdrawn or deactivated line is refused rather than silently
     * dropped. A basket that quietly loses an item and charges for the rest is
     * the kind of thing a customer only notices when the parcel arrives.
     */
    if (!variant || variant.status !== 'active' || !variant.variantActive) {
      throw unprocessable(
        'Something in your basket is no longer available. Please review it and try again.',
        ERROR_CODES.VALIDATION_FAILED,
        { lines: ['One or more items are no longer available.'] },
      );
    }

    if (variant.productId !== line.productId) {
      throw unprocessable(
        'Something in your basket does not look right. Please review it and try again.',
        ERROR_CODES.VALIDATION_FAILED,
        { lines: ['One or more items are no longer available.'] },
      );
    }

    const sale = effectiveSale(variant.salePrice, variant.saleStartsAt, variant.saleEndsAt);
    const charged = sale ?? variant.price;

    priced.push({
      productId: variant.productId,
      variantId: variant.variantId,
      productName: variant.productName,
      variantTitle: variant.variantTitle,
      sku: variant.sku,
      imageUrl: variant.variantImage ?? primaryImage.get(variant.productId) ?? null,
      quantity: line.quantity,
      unitPrice: variant.price,
      unitSalePrice: sale,
      lineTotal: toMoney(moneyToNumber(charged) * line.quantity),
    });
  }

  return priced;
}

export interface ShippingQuote {
  id: string;
  name: string;
  description: string | null;
  price: string;
  estimatedDaysMin: number | null;
  estimatedDaysMax: number | null;
}

/**
 * Which shipping methods serve an address.
 *
 * A zone matches when it names the country (or the city), and the zone flagged
 * `is_default` is the catch-all for everywhere else. Matching zones win over the
 * default, so a store with a Dhaka rate and a rest-of-world rate quotes the
 * Dhaka one to Dhaka rather than both.
 */
export async function quoteShipping(
  db: TenantExecutor,
  target: { country?: string; city?: string },
  subtotal = 0,
): Promise<ShippingQuote[]> {
  const zones = await db
    .select()
    .from(shippingZones)
    .where(eq(shippingZones.isActive, true))
    .orderBy(asc(shippingZones.sortOrder));

  const country = target.country?.trim().toLowerCase();
  const city = target.city?.trim().toLowerCase();

  const matches = (zone: (typeof zones)[number]) => {
    const countries = (zone.countries ?? []).map((value) => value.toLowerCase());
    const cities = (zone.cities ?? []).map((value) => value.toLowerCase());
    if (countries.length === 0 && cities.length === 0) return false;
    if (city && cities.includes(city)) return true;
    if (country && countries.includes(country)) return true;
    return false;
  };

  const specific = zones.filter(matches);
  const chosen = specific.length > 0 ? specific : zones.filter((zone) => zone.isDefault);
  if (chosen.length === 0) return [];

  const methods = await db
    .select()
    .from(shippingMethods)
    .where(
      and(
        inArray(
          shippingMethods.zoneId,
          chosen.map((zone) => zone.id),
        ),
        eq(shippingMethods.isActive, true),
      ),
    )
    .orderBy(asc(shippingMethods.sortOrder), asc(shippingMethods.price));

  return methods.map((method) => ({
    id: method.id,
    name: method.name,
    description: method.description,
    // Free over a threshold is quoted as free, not quoted at full price and
    // discounted later — the number shown is the number charged.
    price:
      method.freeAboveSubtotal !== null && subtotal >= moneyToNumber(method.freeAboveSubtotal)
        ? '0.00'
        : method.price,
    estimatedDaysMin: method.estimatedDaysMin,
    estimatedDaysMax: method.estimatedDaysMax,
  }));
}

export interface CouponOutcome {
  id: string;
  code: string;
  discount: string;
  label: string | null;
}

export type CouponRefusal =
  | 'unknown'
  | 'expired'
  | 'not_started'
  | 'disabled'
  | 'minimum_not_met'
  | 'usage_limit'
  | 'customer_limit';

export class CouponError extends Error {
  constructor(readonly refusal: CouponRefusal, message: string) {
    super(message);
    this.name = 'CouponError';
  }
}

/**
 * Validates a coupon and works out what it is worth on this basket.
 *
 * The single authority. The storefront used to hold two hardcoded tables that
 * already disagreed with each other about one code's minimum — a discount shown
 * in the cart and a different one charged at the till is a support ticket every
 * time, so the number the customer sees now comes from here in both places.
 */
export async function applyCoupon(
  db: TenantExecutor,
  code: string,
  subtotal: number,
  identity: { customerId?: string | null; email?: string | null },
): Promise<CouponOutcome> {
  const normalised = code.trim().toUpperCase();

  const [coupon] = await db
    .select()
    .from(coupons)
    .where(eq(sql`upper(${coupons.code})`, normalised))
    .limit(1);

  if (!coupon) throw new CouponError('unknown', 'That code is not valid.');

  const now = new Date();
  if (coupon.status === 'disabled') throw new CouponError('disabled', 'That code is no longer available.');
  if (coupon.startsAt && coupon.startsAt > now) {
    throw new CouponError('not_started', 'That code is not active yet.');
  }
  if (coupon.endsAt && coupon.endsAt < now) {
    throw new CouponError('expired', 'That code has expired.');
  }
  if (coupon.minOrderAmount !== null && subtotal < moneyToNumber(coupon.minOrderAmount)) {
    throw new CouponError(
      'minimum_not_met',
      `Spend at least ${toMoney(coupon.minOrderAmount)} to use this code.`,
    );
  }
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    throw new CouponError('usage_limit', 'That code has been fully claimed.');
  }

  if (coupon.perCustomerLimit !== null) {
    // A guest is counted by the email they order with, which is the only handle
    // there is; it is weak, and it is why `per_customer_limit` is not a security
    // control so much as a fairness one.
    const owner = identity.customerId
      ? eq(couponRedemptions.customerId, identity.customerId)
      : identity.email
        ? and(isNull(couponRedemptions.customerId), eq(couponRedemptions.email, identity.email))
        : null;

    if (owner) {
      const [used] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(couponRedemptions)
        .where(and(eq(couponRedemptions.couponId, coupon.id), owner));

      if (Number(used?.count ?? 0) >= coupon.perCustomerLimit) {
        throw new CouponError('customer_limit', 'You have already used that code.');
      }
    }
  }

  let discount =
    coupon.type === 'percentage'
      ? (subtotal * moneyToNumber(coupon.value)) / 100
      : coupon.type === 'fixed'
        ? moneyToNumber(coupon.value)
        : 0;

  if (coupon.maxDiscountAmount !== null) {
    discount = Math.min(discount, moneyToNumber(coupon.maxDiscountAmount));
  }

  // Never more than the basket: a discount larger than the order would make the
  // total negative and turn a coupon into a withdrawal.
  discount = Math.max(0, Math.min(discount, subtotal));

  return { id: coupon.id, code: coupon.code, discount: toMoney(discount), label: coupon.description };
}

/**
 * Moves stock from `available` to `reserved` for one variant.
 *
 * A single conditional `UPDATE`, never read-then-write: two checkouts racing for
 * the last unit both read "1 available", and only the arrangement below lets
 * exactly one of them win. The `>= 0` CHECK on the column is the backstop; this
 * returns false first so the caller can answer `INSUFFICIENT_STOCK` rather than
 * surfacing a constraint violation.
 *
 * A variant with no stock rows at all is untracked, and untracked means "sell
 * it" — the same rule the listing and the badge use.
 */
export async function reserveStock(
  tx: TenantExecutor,
  variantId: string,
  quantity: number,
): Promise<{ reserved: boolean; tracked: boolean; availableAfter: number; warehouseId: string | null }> {
  const result = await tx.execute<{ id: string; warehouse_id: string; available: number; reserved: number }>(sql`
    update inventory_levels
       set available = available - ${quantity},
           reserved  = reserved  + ${quantity},
           updated_at = now()
     where id = (
       select id from inventory_levels
        where variant_id = ${variantId}::uuid and available >= ${quantity}
        order by available desc
        limit 1
     )
    returning id, warehouse_id, available, reserved
  `);

  const row = result.rows?.[0];
  if (row) {
    return {
      reserved: true,
      tracked: true,
      availableAfter: Number(row.available),
      warehouseId: row.warehouse_id,
    };
  }

  const existing = await tx.execute<{ count: number }>(sql`
    select count(*)::int as count from inventory_levels where variant_id = ${variantId}::uuid
  `);

  const tracked = Number(existing.rows?.[0]?.count ?? 0) > 0;
  return { reserved: !tracked, tracked, availableAfter: 0, warehouseId: null };
}

/** Puts reserved stock back — used when an order is cancelled before dispatch. */
export async function releaseStock(
  tx: TenantExecutor,
  variantId: string,
  quantity: number,
): Promise<{ released: boolean; availableAfter: number; warehouseId: string | null }> {
  const result = await tx.execute<{ warehouse_id: string; available: number }>(sql`
    update inventory_levels
       set available = available + ${quantity},
           reserved  = greatest(reserved - ${quantity}, 0),
           updated_at = now()
     where id = (
       select id from inventory_levels
        where variant_id = ${variantId}::uuid
        order by reserved desc
        limit 1
     )
    returning warehouse_id, available
  `);

  const row = result.rows?.[0];
  return row
    ? { released: true, availableAfter: Number(row.available), warehouseId: row.warehouse_id }
    : { released: false, availableAfter: 0, warehouseId: null };
}

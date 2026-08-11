import type { OrderDetail, OrderSummary, OrderTimelineEntry } from '@/types';
import { MOCK_PRODUCTS, PRODUCT_BY_ID, rngFor } from './fixtures';

/**
 * Orders, in the fixture layer.
 *
 * Placed orders are held in memory for the life of the server process, which is
 * enough for the flow to be walkable end to end — place an order, land on the
 * confirmation, find it in the account, track it, request a return — without
 * pretending to be a database. A restart forgets them, and that is fine for
 * fixtures and would not be for anything else.
 *
 * The important property is that **the price is computed here, from the
 * catalogue**, never taken from the request. That mirrors what the real API
 * does and is the reason the checkout payload has nowhere to put a price.
 */

interface PlaceOrderInput {
  email: string;
  phone: string;
  lines: { productId: string; variantId: string; quantity: number }[];
  shippingAddress: {
    fullName: string;
    phone: string;
    addressLine1: string;
    addressLine2?: string | null;
    city: string;
    state?: string | null;
    postalCode?: string | null;
    country: string;
  };
  shippingMethodId: string;
  paymentProvider: string;
  couponCode?: string | null;
  notes?: string | null;
}

/**
 * Placed orders, held on `globalThis`.
 *
 * A plain module-level `Map` is not enough: a route handler and a page are
 * separate module instances in Next's server runtime (and every edit re-
 * evaluates the module in development), so an order placed through
 * `/api/checkout` was invisible to the confirmation and tracking pages that
 * rendered a moment later.
 *
 * Keying off the global object is the usual escape hatch for a development
 * singleton. It is only ever reached on the fixture branch — the live path has
 * a database and needs none of this.
 */
const ORDER_STORE = Symbol.for('storefront.mock.orders');

const globalStore = globalThis as unknown as Record<symbol, Map<string, OrderDetail> | undefined>;
const placed: Map<string, OrderDetail> = (globalStore[ORDER_STORE] ??= new Map());

const COUPON_PERCENT: Record<string, number> = { WELCOME20: 20, URBAN20: 20, SAVE10: 10 };

const SHIPPING_LABELS: Record<string, string> = {
  standard: 'Standard delivery',
  express: 'Express delivery',
};

const PAYMENT_LABELS: Record<string, string> = {
  cod: 'Cash on Delivery',
  bkash: 'bKash',
  nagad: 'Nagad',
  card: 'Card',
};

const minor = (amount: string) => Math.round(Number.parseFloat(amount) * 100);
const decimal = (value: number) => (value / 100).toFixed(2);

function timeline(status: string, placedAt: string): OrderTimelineEntry[] {
  const steps = [
    { status: 'pending', label: 'Order placed' },
    { status: 'confirmed', label: 'Confirmed' },
    { status: 'processing', label: 'Processing' },
    { status: 'shipped', label: 'Shipped' },
    { status: 'delivered', label: 'Delivered' },
  ];

  const reachedIndex = steps.findIndex((step) => step.status === status);

  return steps.map((step, index) => ({
    status: step.status,
    label: step.label,
    at: index === 0 ? placedAt : index <= reachedIndex ? placedAt : null,
    reached: index <= (reachedIndex === -1 ? 0 : reachedIndex),
  }));
}

export async function mockPlaceOrder(input: PlaceOrderInput): Promise<{
  orderNumber: string;
  paymentRedirectUrl: string | null;
  paymentStatus: string;
}> {
  /*
   * Prices are read from the catalogue by id. Whatever the browser believed the
   * total was is irrelevant — this is the mock's version of the server being
   * the only authority on money.
   */
  const lines = input.lines
    .map((line) => {
      const product = PRODUCT_BY_ID.get(line.productId);
      if (!product) return null;

      const unit = product.salePrice ?? product.price;
      return {
        name: product.name,
        variantTitle: null,
        sku: null,
        imageUrl: product.primaryImage?.url ?? null,
        quantity: line.quantity,
        unitPrice: unit,
        lineTotal: decimal(minor(unit) * line.quantity),
        productSlug: product.slug,
      };
    })
    .filter((line): line is NonNullable<typeof line> => line !== null);

  if (lines.length === 0) throw new Error('No purchasable lines');

  const currency = MOCK_PRODUCTS[0]?.currency ?? 'USD';
  const subtotal = lines.reduce((total, line) => total + minor(line.lineTotal), 0);

  const percent = input.couponCode ? (COUPON_PERCENT[input.couponCode.toUpperCase()] ?? 0) : 0;
  const discount = Math.round((subtotal * percent) / 100);
  const shipping = input.shippingMethodId === 'express' ? 260 : 120;
  const tax = 0;

  // Deterministic order number, so the same basket does not produce a different
  // reference on every render in development.
  const rng = rngFor(`order:${input.email}:${subtotal}:${lines.length}`);
  const orderNumber = `ORD-${String(rng.int(100000, 999999))}`;
  const placedAt = new Date().toISOString();

  const order: OrderDetail = {
    orderNumber,
    placedAt,
    status: 'pending',
    paymentStatus: input.paymentProvider === 'cod' ? 'pending' : 'paid',
    itemCount: lines.reduce((count, line) => count + line.quantity, 0),
    total: decimal(subtotal - discount + shipping + tax),
    currency,
    email: input.email,
    customerName: input.shippingAddress.fullName,
    lines,
    totals: {
      subtotal: decimal(subtotal),
      discount: decimal(discount),
      shipping: decimal(shipping),
      tax: decimal(tax),
      total: decimal(subtotal - discount + shipping + tax),
      currency,
    },
    shippingAddress: {
      fullName: input.shippingAddress.fullName,
      phone: input.shippingAddress.phone,
      addressLine1: input.shippingAddress.addressLine1,
      addressLine2: input.shippingAddress.addressLine2 ?? null,
      city: input.shippingAddress.city,
      state: input.shippingAddress.state ?? null,
      postalCode: input.shippingAddress.postalCode ?? null,
      country: input.shippingAddress.country,
    },
    billingAddress: null,
    paymentMethodLabel: PAYMENT_LABELS[input.paymentProvider] ?? input.paymentProvider,
    shippingMethodLabel: SHIPPING_LABELS[input.shippingMethodId] ?? input.shippingMethodId,
    shippingStatus: 'pending',
    tracking: null,
    timeline: timeline('pending', placedAt),
    estimatedDeliveryAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    canCancel: true,
    canRequestReturn: false,
    invoiceUrl: null,
  };

  placed.set(orderNumber.toLowerCase(), order);

  return {
    orderNumber,
    // Cash on delivery needs no redirect; everything else would bounce through
    // a provider. The mock returns null and the confirmation page handles both.
    paymentRedirectUrl: null,
    paymentStatus: order.paymentStatus,
  };
}

/** Pre-seeded history, so the account area is not empty on a fresh browser. */
const SEEDED: OrderDetail[] = (() => {
  const rng = rngFor('seed-orders');
  const statuses = ['delivered', 'shipped', 'processing'] as const;

  return statuses.map((status, index) => {
    const products = rng.sample(MOCK_PRODUCTS.filter((p) => p.inStock), 2);
    const lines = products.map((product) => {
      const unit = product.salePrice ?? product.price;
      const quantity = rng.int(1, 2);
      return {
        name: product.name,
        variantTitle: null,
        sku: null,
        imageUrl: product.primaryImage?.url ?? null,
        quantity,
        unitPrice: unit,
        lineTotal: decimal(minor(unit) * quantity),
        productSlug: product.slug,
      };
    });

    const subtotal = lines.reduce((total, line) => total + minor(line.lineTotal), 0);
    const shipping = 120;
    const placedAt = new Date(Date.parse('2026-06-20T10:00:00.000Z') - index * 12 * 86_400_000).toISOString();
    const orderNumber = `ORD-${100200 + index}`;

    return {
      orderNumber,
      placedAt,
      status,
      paymentStatus: 'paid',
      itemCount: lines.reduce((count, line) => count + line.quantity, 0),
      total: decimal(subtotal + shipping),
      currency: products[0]?.currency ?? 'USD',
      email: 'you@example.com',
      customerName: 'Sample Customer',
      lines,
      totals: {
        subtotal: decimal(subtotal),
        discount: '0.00',
        shipping: decimal(shipping),
        tax: '0.00',
        total: decimal(subtotal + shipping),
        currency: products[0]?.currency ?? 'USD',
      },
      shippingAddress: {
        fullName: 'Sample Customer',
        phone: '+880 1700 000000',
        addressLine1: 'House 12, Road 7',
        addressLine2: null,
        city: 'Dhaka',
        state: null,
        postalCode: '1212',
        country: 'Bangladesh',
      },
      billingAddress: null,
      paymentMethodLabel: 'Card',
      shippingMethodLabel: 'Standard delivery',
      shippingStatus: status === 'delivered' ? 'delivered' : status,
      tracking:
        status === 'delivered' || status === 'shipped'
          ? { carrier: 'Pathao Courier', number: `PC${400100 + index}`, url: null }
          : null,
      timeline: timeline(status, placedAt),
      estimatedDeliveryAt: null,
      canCancel: status === 'processing',
      canRequestReturn: status === 'delivered',
      invoiceUrl: null,
    } satisfies OrderDetail;
  });
})();

export async function mockOrders(): Promise<OrderSummary[]> {
  return [...placed.values(), ...SEEDED]
    .sort((a, b) => Date.parse(b.placedAt) - Date.parse(a.placedAt))
    .map((order) => ({
      orderNumber: order.orderNumber,
      placedAt: order.placedAt,
      status: order.status,
      paymentStatus: order.paymentStatus,
      itemCount: order.itemCount,
      total: order.total,
      currency: order.currency,
    }));
}

export async function mockOrder(orderNumber: string): Promise<OrderDetail | null> {
  const key = orderNumber.toLowerCase();
  return (
    placed.get(key) ??
    SEEDED.find((order) => order.orderNumber.toLowerCase() === key) ??
    null
  );
}

/**
 * Cancels an order, if it is still cancellable.
 *
 * The state check is here rather than in the caller for the same reason the
 * real API keeps it: whether an order can still be stopped depends on where it
 * is in the warehouse, and the browser's copy of that is always a moment stale.
 */
export async function mockCancelOrder(orderNumber: string): Promise<boolean> {
  const order = await mockOrder(orderNumber);
  if (!order || !order.canCancel) return false;

  const cancelled: OrderDetail = {
    ...order,
    status: 'cancelled',
    canCancel: false,
    canRequestReturn: false,
    timeline: order.timeline.map((entry) => ({ ...entry, reached: entry.status === 'pending' })),
  };

  placed.set(order.orderNumber.toLowerCase(), cancelled);
  return true;
}

/**
 * Guest order lookup.
 *
 * Requires the order number **and** the email it was placed with. An order
 * number alone is guessable, and order numbers are printed on packaging.
 */
export async function mockTrackOrder(
  orderNumber: string,
  email: string,
): Promise<OrderDetail | null> {
  const order = await mockOrder(orderNumber);
  if (!order) return null;
  return order.email.toLowerCase() === email.trim().toLowerCase() ? order : null;
}

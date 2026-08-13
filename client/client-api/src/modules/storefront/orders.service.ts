import { and, asc, eq, sql } from 'drizzle-orm';
import type { TenantDb, TenantExecutor } from '../../db/tenant-manager';
import {
  orderAddresses,
  orderItems,
  orderStatusHistory,
  orders,
  products,
} from '../../db/schema/index';
import type { OrderStatus } from '../../lib/constants';
import { ORDER_TRANSITIONS } from '../../lib/constants';
import { sequentialRef } from '../../lib/utils';

/**
 * The five steps a customer is shown, in order.
 *
 * The storefront renders `label` verbatim and treats the last `reached` entry as
 * where the order is, so the API owns the wording and always sends all five —
 * a progress bar that grows entries as it advances reads as a bug. The database
 * has twelve statuses; several of them collapse onto one step here because
 * "packed" and "processing" are the same fact to somebody waiting for a parcel.
 */
const TIMELINE_STEPS = [
  { status: 'pending', label: 'Order placed' },
  { status: 'confirmed', label: 'Confirmed' },
  { status: 'processing', label: 'Processing' },
  { status: 'shipped', label: 'Shipped' },
  { status: 'delivered', label: 'Delivered' },
] as const;

/** Which of the five steps a database status has reached. */
const STEP_RANK: Record<OrderStatus, number> = {
  new: 0,
  pending: 0,
  confirmed: 1,
  processing: 2,
  packed: 2,
  shipped: 3,
  out_for_delivery: 3,
  delivered: 4,
  // An order that ended early keeps only its first step lit; the status badge
  // beside the timeline is what says what actually happened to it.
  cancelled: 0,
  failed: 0,
  returned: 4,
  refunded: 4,
};

/** Statuses from which a customer — not staff — may still cancel. */
const CUSTOMER_CANCELLABLE = new Set<OrderStatus>(['new', 'pending', 'confirmed', 'processing']);

export interface TimelineEntry {
  status: string;
  label: string;
  at: string | null;
  reached: boolean;
}

export function buildTimeline(
  status: OrderStatus,
  placedAt: Date,
  history: { toStatus: string; createdAt: Date }[],
): TimelineEntry[] {
  const reachedIndex = STEP_RANK[status] ?? 0;

  // First time each step was entered, so a status that was set twice does not
  // move its own timestamp forward.
  const firstAt = new Map<string, Date>();
  for (const entry of history) {
    if (!firstAt.has(entry.toStatus)) firstAt.set(entry.toStatus, entry.createdAt);
  }

  return TIMELINE_STEPS.map((step, index) => {
    const at = index === 0 ? placedAt : (firstAt.get(step.status) ?? null);
    return {
      status: step.status,
      label: step.label,
      at: index <= reachedIndex ? (at ?? placedAt).toISOString() : null,
      reached: index <= reachedIndex,
    };
  });
}

export function canCustomerCancel(status: OrderStatus): boolean {
  return CUSTOMER_CANCELLABLE.has(status) && ORDER_TRANSITIONS[status].includes('cancelled');
}

/**
 * Whether the customer may still start a return.
 *
 * Delivered only, inside the window, and only while some quantity is left
 * un-returned — the storefront renders the button off this flag alone, and the
 * endpoint re-checks it, because a stale page must not be able to open a second
 * return on the same line.
 */
export function canRequestReturn(
  status: OrderStatus,
  deliveredAt: Date | null,
  windowDays: number,
  hasReturnableQuantity: boolean,
): boolean {
  if (status !== 'delivered' || !hasReturnableQuantity) return false;
  if (!deliveredAt) return false;

  const closesAt = new Date(deliveredAt);
  closesAt.setDate(closesAt.getDate() + windowDays);
  return closesAt >= new Date();
}

/**
 * A human-facing reference: `ORD-20260812-0004`, `RET-20260812-0003`.
 *
 * Sequential within the day rather than random, because these are numbers a
 * customer reads out on the phone and a shop owner sorts by. Two simultaneous
 * checkouts will occasionally compute the same sequence — the unique index is
 * the real guard, and this retries around it. Five attempts, because past that
 * the collision is not a race and a failure is the honest answer.
 */
export async function claimDailyRef(
  prefix: string,
  countToday: () => Promise<number>,
  isTaken: (candidate: string) => Promise<boolean>,
): Promise<string> {
  const base = await countToday();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = sequentialRef(prefix, base + 1 + attempt);
    if (!(await isTaken(candidate))) return candidate;
  }

  throw new Error(`Could not allocate a ${prefix} reference`);
}

/** The order-number flavour of `claimDailyRef`. */
export async function claimOrderNumber(tx: TenantExecutor): Promise<string> {
  return claimDailyRef(
    'ORD',
    async () => {
      const [row] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(sql`${orders.placedAt} >= date_trunc('day', now())`);
      return Number(row?.count ?? 0);
    },
    async (candidate) => {
      const [taken] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.orderNumber, candidate))
        .limit(1);
      return Boolean(taken);
    },
  );
}

export interface OrderLineView {
  name: string;
  variantTitle: string | null;
  sku: string | null;
  imageUrl: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  productSlug: string | null;
}

export interface OrderSummaryView {
  orderNumber: string;
  placedAt: string;
  status: string;
  paymentStatus: string;
  itemCount: number;
  total: string;
  currency: string;
}

export interface OrderDetailView extends OrderSummaryView {
  email: string;
  customerName: string;
  lines: OrderLineView[];
  totals: {
    subtotal: string;
    discount: string;
    shipping: string | null;
    tax: string;
    total: string;
    currency: string;
  };
  shippingAddress: AddressBlock | null;
  billingAddress: AddressBlock | null;
  paymentMethodLabel: string | null;
  shippingMethodLabel: string | null;
  shippingStatus: string;
  tracking: { carrier: string | null; number: string | null; url: string | null } | null;
  timeline: TimelineEntry[];
  estimatedDeliveryAt: string | null;
  canCancel: boolean;
  canRequestReturn: boolean;
  invoiceUrl: string | null;
}

interface AddressBlock {
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string;
}

/**
 * Loads one order in full.
 *
 * Takes an already-authorised order id: this function never decides *whether*
 * the caller may read it, so a route cannot get authorisation right by accident
 * — it has to do it itself before calling.
 */
export async function loadOrderDetail(db: TenantDb, orderId: string): Promise<OrderDetailView | null> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return null;

  const [lines, addresses, history, shipment] = await Promise.all([
    db
      .select({
        name: orderItems.productName,
        variantTitle: orderItems.variantTitle,
        sku: orderItems.sku,
        imageUrl: orderItems.imageUrl,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
        unitSalePrice: orderItems.unitSalePrice,
        lineTotal: orderItems.lineTotal,
        returnedQuantity: orderItems.returnedQuantity,
        productSlug: products.slug,
      })
      .from(orderItems)
      .leftJoin(products, eq(products.id, orderItems.productId))
      .where(eq(orderItems.orderId, orderId))
      .orderBy(asc(orderItems.createdAt)),

    db.select().from(orderAddresses).where(eq(orderAddresses.orderId, orderId)),

    db
      .select({ toStatus: orderStatusHistory.toStatus, createdAt: orderStatusHistory.createdAt })
      .from(orderStatusHistory)
      .where(
        and(eq(orderStatusHistory.orderId, orderId), eq(orderStatusHistory.isCustomerVisible, true)),
      )
      .orderBy(asc(orderStatusHistory.createdAt)),

    db.execute<{ carrier: string | null; tracking_number: string | null; tracking_url: string | null }>(
      sql`select carrier, tracking_number, tracking_url from shipments
          where order_id = ${orderId} order by created_at desc limit 1`,
    ),
  ]);

  const block = (type: 'shipping' | 'billing'): AddressBlock | null => {
    const row = addresses.find((entry) => entry.type === type);
    if (!row) return null;
    return {
      fullName: row.fullName,
      phone: row.phone,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      city: row.city,
      state: row.state,
      postalCode: row.postalCode,
      country: row.country,
    };
  };

  const track = shipment.rows?.[0];
  const status = order.status as OrderStatus;

  return {
    orderNumber: order.orderNumber,
    placedAt: order.placedAt.toISOString(),
    status: order.status,
    paymentStatus: order.paymentStatus,
    itemCount: lines.reduce((total, line) => total + line.quantity, 0),
    total: order.grandTotal,
    currency: order.currency,
    email: order.email,
    customerName: order.customerName,
    lines: lines.map((line) => ({
      name: line.name,
      variantTitle: line.variantTitle,
      sku: line.sku,
      imageUrl: line.imageUrl,
      quantity: line.quantity,
      // The price actually charged, not the list price — a receipt that shows
      // what something normally costs is not a receipt.
      unitPrice: line.unitSalePrice ?? line.unitPrice,
      lineTotal: line.lineTotal,
      productSlug: line.productSlug,
    })),
    totals: {
      subtotal: order.subtotal,
      discount: order.discountTotal,
      shipping: order.shippingTotal,
      tax: order.taxTotal,
      total: order.grandTotal,
      currency: order.currency,
    },
    shippingAddress: block('shipping'),
    billingAddress: block('billing'),
    paymentMethodLabel: order.paymentMethodLabel,
    shippingMethodLabel: order.shippingMethodLabel,
    shippingStatus: order.shippingStatus,
    tracking: track
      ? { carrier: track.carrier, number: track.tracking_number, url: track.tracking_url }
      : null,
    timeline: buildTimeline(status, order.placedAt, history),
    estimatedDeliveryAt: order.estimatedDeliveryAt?.toISOString() ?? null,
    canCancel: canCustomerCancel(status),
    canRequestReturn: canRequestReturn(
      status,
      order.deliveredAt,
      DEFAULT_RETURN_WINDOW_DAYS,
      lines.some((line) => line.quantity > line.returnedQuantity),
    ),
    // No invoice renderer exists yet; null is honest and the storefront hides
    // the button rather than linking to a 404.
    invoiceUrl: null,
  };
}

/** Until a per-store setting exists, every store gets the same return window. */
export const DEFAULT_RETURN_WINDOW_DAYS = 7;

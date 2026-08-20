/**
 * The detail endpoints behind the store admin panel's **View** panels.
 *
 * Every list in the panel now opens the record itself in a side panel instead of
 * sending the reader to the storefront, and each panel claims to show everything
 * the database holds on that row. This is what proves the claim: for each
 * endpoint it asserts the fields the panel renders are actually present — not
 * merely that a 200 came back, which a handler returning `{}` would also manage.
 *
 * It also asserts the two things that must *not* be present. `password_hash` on
 * a customer and `unsubscribe_token_hash` on a subscriber are credentials, and a
 * panel that displays everything is exactly the change most likely to leak one.
 *
 * Read-only: it creates nothing, changes nothing and deletes nothing, so it is
 * safe against `e-comarch` — unlike `verify-commerce.ts` and `verify-admin.ts`.
 * Where a store has no row of some kind (no refunds, no returns) the checks for
 * it report as skipped rather than failing, since an empty shop is not a bug.
 *
 * Usage:
 *   npx tsx scripts/verify-detail-views.ts --password 'secret'
 *   npx tsx scripts/verify-detail-views.ts --slug other-shop --email a@b.c --password '…'
 */

const args = process.argv.slice(2);

function arg(name: string, fallback?: string): string | undefined {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
}

const BASE = arg('base', 'http://localhost:4100')!;
const SLUG = arg('slug', process.env.DEV_STORE_SLUG ?? 'e-comarch')!;
const EMAIL = arg('email', 'redoyahmed198@gmail.com')!;
const PASSWORD = arg('password');

if (!PASSWORD) {
  console.error('Pass the store admin password: --password \'…\'');
  process.exit(1);
}

let passed = 0;
let failed = 0;
let skipped = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function skip(label: string, why: string): void {
  skipped += 1;
  console.log(`  skip ${label} — ${why}`);
}

/**
 * Present means "the key is there", not "the value is truthy".
 *
 * The distinction is the whole point: a nullable column that came back null is
 * correct, and a column the handler forgot to select is not — and both read as
 * falsy. Only `undefined` says the field was never sent.
 */
function has(payload: Record<string, unknown>, ...fields: string[]): string[] {
  return fields.filter((field) => payload[field] === undefined);
}

let cookie = '';

async function call<T>(path: string): Promise<{ status: number; body: T }> {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'X-Store-Slug': SLUG, Accept: 'application/json', ...(cookie ? { cookie } : {}) },
  });
  const body = (await response.json().catch(() => null)) as { data?: T } | null;
  return { status: response.status, body: (body?.data ?? body) as T };
}

async function signIn(): Promise<void> {
  const response = await fetch(`${BASE}/api/v1/admin/auth/login`, {
    method: 'POST',
    // No `Origin` on purpose. `plugins/security.ts` allows an originless request
    // — curl, server-to-server — and refuses any origin that is not an admin
    // surface for this store, which a script has no honest way to name.
    headers: { 'Content-Type': 'application/json', 'X-Store-Slug': SLUG },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sign-in failed (${response.status}): ${body}`);
  }

  cookie = (response.headers.getSetCookie?.() ?? [])
    .map((entry) => entry.split(';')[0])
    .join('; ');

  if (!cookie) throw new Error('Sign-in returned no session cookie.');
}

/** The first row of a list, or null when the shop has none of that thing. */
async function firstOf<T extends { id: string }>(path: string): Promise<T | null> {
  const { body } = await call<T[]>(`${path}${path.includes('?') ? '&' : '?'}pageSize=1`);
  return Array.isArray(body) && body[0] ? body[0] : null;
}

async function main(): Promise<void> {
  console.log(`\nDetail views · ${SLUG} · ${BASE}\n`);
  await signIn();
  console.log(`Signed in as ${EMAIL}\n`);

  // ------------------------------------------------------------- product ----
  console.log('GET /admin/products/:id');
  const product = await firstOf<{ id: string }>('/api/v1/admin/products');
  if (!product) {
    skip('product detail', 'this store has no products');
  } else {
    const { status, body } = await call<Record<string, unknown>>(`/api/v1/admin/products/${product.id}`);
    check('answers 200', status === 200, `got ${status}`);
    const missing = has(
      body,
      'id', 'name', 'slug', 'status', 'type', 'categoryId', 'brandId', 'shortDescription',
      'description', 'priceFrom', 'salePriceFrom', 'isFeatured', 'isNewArrival', 'videoUrl',
      'trackInventory', 'soldCount', 'viewCount', 'ratingAverage', 'ratingCount',
      'returnWindowDays', 'isReturnable', 'minOrderQuantity', 'maxOrderQuantity', 'seoTitle',
      'seoDescription', 'publishedAt', 'createdAt', 'updatedAt', 'variants', 'defaultVariant',
      'media', 'specifications', 'attributeValueIds', 'bundleProductIds',
    );
    check('carries every products column the panel shows', missing.length === 0, `missing ${missing.join(', ')}`);
    check('variants are a list', Array.isArray(body.variants));
    check('gallery is a list', Array.isArray(body.media));
  }

  // ------------------------------------------------------------ customer ----
  console.log('\nGET /admin/customers/:id');
  const customer = await firstOf<{ id: string }>('/api/v1/admin/customers');
  if (!customer) {
    skip('customer detail', 'this store has no customers');
  } else {
    const { status, body } = await call<Record<string, unknown>>(`/api/v1/admin/customers/${customer.id}`);
    check('answers 200', status === 200, `got ${status}`);
    const missing = has(
      body,
      'id', 'email', 'fullName', 'phone', 'status', 'customerType', 'emailVerified',
      'emailVerifiedAt', 'acceptsMarketing', 'failedLoginCount', 'lockedUntil', 'isLocked',
      'lastLoginAt', 'lastLoginIp', 'passwordChangedAt', 'hasPassword', 'adminNote',
      'createdAt', 'updatedAt', 'stats', 'orders', 'addresses', 'sessions',
    );
    check('carries every customers column but the hash', missing.length === 0, `missing ${missing.join(', ')}`);

    // The one that matters. A panel showing "everything" must still not show this.
    check('never sends passwordHash', body.passwordHash === undefined);
    check('never sends password_hash', (body as Record<string, unknown>).password_hash === undefined);

    const stats = body.stats as Record<string, unknown> | undefined;
    check(
      'lifetime figures are computed',
      stats !== undefined && has(stats, 'orderCount', 'totalSpent', 'refundedTotal', 'reviewCount', 'wishlistCount').length === 0,
    );
    check('sessions omit the token hash', Array.isArray(body.sessions) &&
      (body.sessions as Record<string, unknown>[]).every((row) => row.tokenHash === undefined));
  }

  // --------------------------------------------------------------- order ----
  console.log('\nGET /admin/orders/:id');
  const order = await firstOf<{ id: string }>('/api/v1/admin/orders');
  if (!order) {
    skip('order detail', 'this store has no orders');
  } else {
    const { status, body } = await call<Record<string, unknown>>(`/api/v1/admin/orders/${order.id}`);
    check('answers 200', status === 200, `got ${status}`);
    const missing = has(
      body,
      'id', 'orderNumber', 'status', 'paymentStatus', 'shippingStatus', 'subtotal', 'discountTotal',
      'taxTotal', 'shippingTotal', 'grandTotal', 'refundedTotal', 'couponCode', 'couponId',
      'paymentProvider', 'paymentMethodLabel', 'shippingMethodId', 'shippingMethodLabel',
      'estimatedDeliveryAt', 'customerNote', 'adminNote', 'cancelReason', 'cancelledAt',
      'inventoryReleased', 'placedAt', 'confirmedAt', 'shippedAt', 'deliveredAt', 'ipAddress',
      'metadata', 'createdAt', 'updatedAt', 'lines', 'addresses', 'history', 'payments',
      'shipments', 'customer', 'refunds', 'returns', 'allowedTransitions',
    );
    check('carries every orders column plus its relations', missing.length === 0, `missing ${missing.join(', ')}`);
    check('refunds raised against it are listed', Array.isArray(body.refunds));
    check('returns raised against it are listed', Array.isArray(body.returns));
  }

  // -------------------------------------------------------------- review ----
  console.log('\nGET /admin/reviews/:id');
  const review = await firstOf<{ id: string }>('/api/v1/admin/reviews');
  if (!review) {
    skip('review detail', 'this store has no reviews');
  } else {
    const { status, body } = await call<Record<string, unknown>>(`/api/v1/admin/reviews/${review.id}`);
    check('answers 200', status === 200, `got ${status}`);
    const missing = has(
      body,
      'id', 'productId', 'customerId', 'orderId', 'customerName', 'rating', 'body', 'status',
      'verifiedPurchase', 'helpfulCount', 'adminReply', 'adminRepliedAt', 'moderatedBy',
      'moderatedAt', 'createdAt', 'updatedAt', 'productName', 'productSlug', 'productStatus',
      'orderNumber', 'customerEmail', 'customerStatus', 'images',
    );
    check('carries the whole row and what it points at', missing.length === 0, `missing ${missing.join(', ')}`);
    check('images are a list', Array.isArray(body.images));
  }

  // -------------------------------------------------------------- refund ----
  console.log('\nGET /admin/refunds/:id');
  const refund = await firstOf<{ id: string }>('/api/v1/admin/refunds');
  if (!refund) {
    skip('refund detail', 'this store has no refunds');
  } else {
    const { status, body } = await call<Record<string, unknown>>(`/api/v1/admin/refunds/${refund.id}`);
    check('answers 200', status === 200, `got ${status}`);
    const missing = has(
      body,
      'id', 'refundNumber', 'orderId', 'returnId', 'customerId', 'paymentId', 'status', 'amount',
      'currency', 'reason', 'method', 'providerReference', 'failureReason', 'approvedBy',
      'approvedAt', 'completedAt', 'metadata', 'createdAt', 'updatedAt', 'allowedTransitions',
      'order', 'returnNumber', 'returnStatus', 'customerEmail', 'remainingOnOrder', 'payments',
    );
    check('carries the whole row, the order and the payments', missing.length === 0, `missing ${missing.join(', ')}`);
    check('what is still refundable is computed', typeof body.remainingOnOrder === 'string');
  }

  // -------------------------------------------------------------- return ----
  console.log('\nGET /admin/returns/:id');
  const ret = await firstOf<{ id: string }>('/api/v1/admin/returns');
  if (!ret) {
    skip('return detail', 'this store has no returns');
  } else {
    const { status, body } = await call<Record<string, unknown>>(`/api/v1/admin/returns/${ret.id}`);
    check('answers 200', status === 200, `got ${status}`);
    const missing = has(
      body,
      'id', 'returnNumber', 'orderId', 'customerId', 'status', 'resolution', 'reason',
      'description', 'refundableAmount', 'reviewedAt', 'reviewedBy', 'rejectionReason',
      'receivedAt', 'completedAt', 'adminNote', 'createdAt', 'updatedAt', 'orderNumber',
      'orderStatus', 'customerName', 'email', 'phone', 'currency', 'orderTotal',
      'orderRefundedTotal', 'orderPlacedAt', 'items', 'history', 'attachments', 'refunds',
      'allowedTransitions',
    );
    check('carries the whole row, its evidence and its trail', missing.length === 0, `missing ${missing.join(', ')}`);
    check('attachments are a list', Array.isArray(body.attachments));
  }

  // ----------------------------------------------------------- inventory ----
  console.log('\nGET /admin/inventory/:id');
  const level = await firstOf<{ id: string }>('/api/v1/admin/inventory');
  if (!level) {
    skip('inventory detail', 'this store has no stock records');
  } else {
    const { status, body } = await call<Record<string, unknown>>(`/api/v1/admin/inventory/${level.id}`);
    check('answers 200', status === 200, `got ${status}`);
    const missing = has(
      body,
      'id', 'variantId', 'warehouseId', 'available', 'reserved', 'returnPending', 'damaged',
      'incoming', 'lowStockThreshold', 'updatedAt', 'onHand', 'variant', 'product', 'warehouse',
      'otherWarehouses', 'transactions',
    );
    check('carries the level, the variant, the product and the shelf', missing.length === 0, `missing ${missing.join(', ')}`);

    const buckets = body as Record<string, number>;
    check(
      'onHand is the four physical buckets added up',
      buckets.onHand === buckets.available + buckets.reserved + buckets.returnPending + buckets.damaged,
      `onHand ${buckets.onHand}`,
    );

    const linked = body.product as Record<string, unknown> | undefined;
    check(
      "the product's own trackInventory comes with it",
      linked !== undefined && typeof linked.trackInventory === 'boolean',
    );
  }

  // -------------------------------------------------------------- coupon ----
  console.log('\nGET /admin/coupons/:id');
  const coupon = await firstOf<{ id: string }>('/api/v1/admin/coupons');
  if (!coupon) {
    skip('coupon detail', 'this store has no coupons');
  } else {
    const { status, body } = await call<Record<string, unknown>>(`/api/v1/admin/coupons/${coupon.id}`);
    check('answers 200', status === 200, `got ${status}`);
    const missing = has(
      body,
      'id', 'code', 'description', 'type', 'value', 'maxDiscountAmount', 'minOrderAmount',
      'scope', 'targetIds', 'usageLimit', 'perCustomerLimit', 'usedCount', 'startsAt', 'endsAt',
      'status', 'isStackable', 'createdAt', 'updatedAt', 'redemptionCount', 'totalDiscounted',
      'redemptions',
    );
    check('carries every rule plus its redemptions', missing.length === 0, `missing ${missing.join(', ')}`);
    check('redemptions are a list', Array.isArray(body.redemptions));
  }

  // -------------------------------------------------------------- banner ----
  console.log('\nGET /admin/banners/:id');
  const { body: banners } = await call<{ id: string }[]>('/api/v1/admin/banners');
  const banner = Array.isArray(banners) ? banners[0] : null;
  if (!banner) {
    skip('banner detail', 'this store has no banners');
  } else {
    const { status, body } = await call<Record<string, unknown>>(`/api/v1/admin/banners/${banner.id}`);
    check('answers 200', status === 200, `got ${status}`);
    const missing = has(
      body,
      'id', 'title', 'subtitle', 'imageUrl', 'mobileImageUrl', 'linkUrl', 'buttonLabel',
      'position', 'categoryId', 'categoryName', 'categorySlug', 'startsAt', 'endsAt',
      'isActive', 'sortOrder', 'createdAt', 'updatedAt',
    );
    check('carries the whole row and its category', missing.length === 0, `missing ${missing.join(', ')}`);
  }

  // ---------------------------------------------------------- subscriber ----
  console.log('\nGET /admin/newsletter/:id');
  const subscriber = await firstOf<{ id: string }>('/api/v1/admin/newsletter');
  if (!subscriber) {
    skip('subscriber detail', 'nobody has signed up to this store');
  } else {
    const { status, body } = await call<Record<string, unknown>>(`/api/v1/admin/newsletter/${subscriber.id}`);
    check('answers 200', status === 200, `got ${status}`);
    const missing = has(
      body,
      'id', 'email', 'status', 'customerId', 'source', 'subscribedAt', 'unsubscribedAt',
      'hasUnsubscribeToken', 'customerName', 'customerEmail', 'customerStatus', 'acceptsMarketing',
    );
    check('carries the row and any account behind it', missing.length === 0, `missing ${missing.join(', ')}`);

    // The unsubscribe token is a credential: reporting that one exists is fine,
    // sending it would hand the reader the power to unsubscribe that address.
    check('never sends unsubscribeTokenHash', body.unsubscribeTokenHash === undefined);
    check('reports whether a token exists instead', typeof body.hasUnsubscribeToken === 'boolean');
  }

  // ------------------------------------------------------------- message ----
  console.log('\nGET /admin/contact-messages/:id');
  const message = await firstOf<{ id: string }>('/api/v1/admin/contact-messages');
  if (!message) {
    skip('message detail', 'this store has no contact messages');
  } else {
    const { status, body } = await call<Record<string, unknown>>(
      `/api/v1/admin/contact-messages/${message.id}`,
    );
    check('answers 200', status === 200, `got ${status}`);
    const missing = has(
      body,
      'id', 'name', 'email', 'phone', 'subject', 'message', 'status', 'ipAddress',
      'repliedAt', 'createdAt', 'account',
    );
    check('carries the whole row and any matching account', missing.length === 0, `missing ${missing.join(', ')}`);
  }

  // --------------------------------------------------------- not found ------
  console.log('\nA row that does not exist');
  const ghost = '00000000-0000-4000-8000-000000000000';
  for (const path of [
    `/api/v1/admin/reviews/${ghost}`,
    `/api/v1/admin/refunds/${ghost}`,
    `/api/v1/admin/coupons/${ghost}`,
    `/api/v1/admin/banners/${ghost}`,
    `/api/v1/admin/newsletter/${ghost}`,
    `/api/v1/admin/contact-messages/${ghost}`,
    `/api/v1/admin/inventory/${ghost}`,
  ]) {
    const { status } = await call(path);
    check(`404s ${path.replace('/api/v1/admin', '')}`, status === 404, `got ${status}`);
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('\nverify-detail-views failed to run:', error instanceof Error ? error.message : error);
  process.exit(1);
});

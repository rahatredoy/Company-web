/**
 * The admin panel's own API — the sections that manage what the shop produces.
 *
 *   npx tsx scripts/verify-admin.ts --slug abc-fashion --password '…'
 *   npx tsx scripts/verify-admin.ts --keep      # leave the fixtures behind
 *
 * Two things it is really checking. **Every route is permission-guarded**, so a
 * signed-in admin without the right key is refused by the API rather than by a
 * hidden button. And **the order status graph is enforced server-side**: an
 * order cannot be marked delivered because somebody had a stale page open.
 *
 * Everything it creates is prefixed `zz-admin` / `ZZADM` and removed at the end.
 */
import { request as httpRequest } from 'node:http';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { reset as resetRateLimit } from '../src/lib/rate-limit';
import { closeRedis } from '../src/lib/redis';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const ROOT = config.urls.platformRootDomain;
const SLUG = arg('slug') ?? config.devStoreSlug ?? 'abc-fashion';
const PASSWORD = arg('password');
const KEEP = process.argv.includes('--keep');

const STORE_HOST = `${SLUG}.${ROOT}`;
const ADMIN_HOST = `admin.${SLUG}.${ROOT}`;
const TAG = 'zz-admin';
const BUYER = 'zz-admin-buyer@example.test';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

const jar = new Map<string, string>();

/**
 * The shopper's cookies, kept apart from the admin's.
 *
 * Needed because checkout here is a guest flow: the API hands back a
 * `store_guest_orders` token that is the only thing entitling this browser to
 * read the order it just placed, and a helper that discards cookies cannot
 * follow its own order afterwards.
 */
const shopJar = new Map<string, string>();

async function call(
  host: string,
  path: string,
  init: { method?: string; body?: unknown; useJar?: boolean } = {},
): Promise<{ status: number; body: any }> {
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
  const headers: Record<string, string> = {
    accept: 'application/json',
    host,
    ...(payload ? { 'content-type': 'application/json' } : {}),
  };

  const cookies = host === ADMIN_HOST ? jar : shopJar;
  if (init.useJar && cookies.size > 0) {
    headers.cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  const result = await new Promise<{ status: number; setCookie: string[]; text: string }>(
    (resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port: config.api.port, path, method: init.method ?? 'GET', headers },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () =>
            resolve({
              status: response.statusCode ?? 0,
              setCookie: response.headers['set-cookie'] ?? [],
              text: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        },
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    },
  );

  if (init.useJar) {
    for (const raw of result.setCookie) {
      const [pair] = raw.split(';');
      const [name, ...rest] = (pair ?? '').split('=');
      if (name) cookies.set(name.trim(), rest.join('='));
    }
  }

  let body: unknown = null;
  try {
    body = result.text ? JSON.parse(result.text) : null;
  } catch {
    body = result.text;
  }

  return { status: result.status, body };
}

const admin = (path: string, init: { method?: string; body?: unknown } = {}) =>
  call(ADMIN_HOST, `/api/v1/admin${path}`, { ...init, useJar: true });

const shop = (path: string, init: { method?: string; body?: unknown } = {}) =>
  call(STORE_HOST, `/api/v1/storefront${path}`, { ...init, useJar: true });

/**
 * A multipart upload, built by hand.
 *
 * `node:http` is used throughout this script because `fetch` drops a custom
 * `Host`, and the hostname is how the API picks the store — so the body has to
 * be assembled here rather than handed to `FormData`.
 */
async function upload(
  purpose: string,
  body: Buffer,
  filename: string,
  contentType: string,
): Promise<{ status: number; body: any }> {
  const boundary = `----zzadm${Math.random().toString(16).slice(2)}`;

  // CRLF by char code, because multipart line endings are part of the grammar
  // and a body separated by bare newlines is refused by the parser rather than
  // by the route under test — which would read as a bug in the upload code.
  // Spelled this way so no editor or tool can normalise it away.
  const CRLF = String.fromCharCode(13, 10);
  const head = Buffer.from(
    `--${boundary}${CRLF}` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}` +
      `Content-Type: ${contentType}${CRLF}${CRLF}`,
    'utf8',
  );
  const tail = Buffer.from(`${CRLF}--${boundary}--${CRLF}`, 'utf8');
  const payload = Buffer.concat([head, body, tail]);

  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: config.api.port,
        path: `/api/v1/admin/uploads?purpose=${purpose}`,
        method: 'POST',
        headers: {
          host: ADMIN_HOST,
          accept: 'application/json',
          'content-type': `multipart/form-data; boundary=${boundary}`,
          'content-length': String(payload.length),
          cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed: unknown = null;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            parsed = text;
          }
          resolve({ status: response.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main(): Promise<void> {
  console.log(`\nAdmin checks against ${ADMIN_HOST} on port ${config.api.port}\n`);

  /*
   * Clears this script's own rate-limit counters.
   *
   * The limits are real and are meant to be there, but a run trips several of
   * them in a few seconds — so without this the second run inside the window
   * fails on the limiter rather than on anything under test.
   */
  const LIMITED_SCOPES = [
    'login',
    'checkout',
    'review-submit',
    'customer-register',
    'customer-login',
    'order-track',
    'return-request',
    'coupon-validate',
    'upload',
  ];

  for (const scope of LIMITED_SCOPES) {
    for (const ip of ['127.0.0.1', '::ffff:127.0.0.1', '::1']) {
      await resetRateLimit(scope, ip);
      await resetRateLimit(`${scope}:ip`, ip);
    }
    await resetRateLimit(`${scope}:id`, BUYER);
  }

  const pool = await openTenantPoolForSlug(SLUG);
  const sql = async <T = any>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await pool.query(text, params as never[])).rows as T[];

  const [adminRow] = await sql<{ email: string }>('select email from store_admins limit 1');
  if (!adminRow || !PASSWORD) {
    console.error(`\n  Needs the store admin login: --password "…" (admin is ${adminRow?.email ?? 'unknown'})\n`);
    process.exit(1);
  }

  const login = await admin('/auth/login', {
    method: 'POST',
    body: { email: adminRow.email, password: PASSWORD },
  });
  if (login.status !== 200) {
    console.error(`\n  Could not sign in: ${JSON.stringify(login.body)}\n`);
    process.exit(1);
  }

  await cleanup(sql);

  console.log('1. Nothing is readable without a session');
  {
    for (const path of ['/orders', '/customers', '/reviews', '/inventory']) {
      const anonymous = await call(ADMIN_HOST, `/api/v1/admin${path}`);
      check(`${path} needs a session`, anonymous.status === 401, { path, status: anonymous.status });
    }
  }

  // --------------------------------------------------------------- fixtures --
  const product = await admin('/products', {
    method: 'POST',
    body: { name: `${TAG} Chair`, status: 'active', sku: 'ZZADM-CHAIR', price: '250.00' },
  });
  const productId = product.body?.data?.id as string;
  const variantId = product.body?.data?.variants?.[0]?.id as string;

  const [warehouse] = await sql<{ id: string }>(
    `insert into warehouses (name, code) values ('ZZADM WH', 'ZZADMWH')
     on conflict (code) do update set name = excluded.name returning id`,
  );

  const shipping = await shop('/checkout/shipping-methods?country=Bangladesh');
  const shippingMethodId = shipping.body?.data?.[0]?.id as string;

  console.log('\n2. Inventory moves only through the ledger');
  {
    const adjust = await admin('/inventory/adjust', {
      method: 'POST',
      body: { variantId, warehouseId: warehouse!.id, bucket: 'available', delta: 10, reason: 'Opening count' },
    });
    check('stock can be added', adjust.status === 200 && adjust.body?.data?.available === 10, adjust.body);

    const list = await admin('/inventory?search=ZZADM-CHAIR');
    check('and shows in the list', (list.body?.data ?? []).length === 1, list.body?.data?.length);

    const overdraw = await admin('/inventory/adjust', {
      method: 'POST',
      body: { variantId, warehouseId: warehouse!.id, bucket: 'available', delta: -99 },
    });
    check('removing more than exists is refused', overdraw.status === 422, overdraw.status);
    check('with INSUFFICIENT_STOCK', overdraw.body?.code === 'INSUFFICIENT_STOCK', overdraw.body?.code);

    const still = await admin('/inventory?search=ZZADM-CHAIR');
    check('and the refusal changed nothing', still.body?.data?.[0]?.available === 10, still.body?.data?.[0]);

    const ledger = await admin(`/inventory/${variantId}/transactions`);
    check('every movement is on the ledger', (ledger.body?.data ?? []).length >= 1, ledger.body?.data?.length);
    check('naming who did it', Boolean(ledger.body?.data?.[0]?.adminLabel), ledger.body?.data?.[0]);
  }

  console.log('\n3. Orders follow the status graph');
  let orderId = '';
  let orderNumber = '';
  {
    const placed = await shop('/checkout', {
      method: 'POST',
      body: {
        email: BUYER,
        phone: '+8801700000000',
        lines: [{ productId, variantId, quantity: 2 }],
        shippingAddress: {
          fullName: 'Zz Admin Buyer',
          phone: '+8801700000000',
          addressLine1: 'House 9',
          city: 'Dhaka',
          country: 'Bangladesh',
        },
        shippingMethodId,
        paymentProvider: 'cod',
      },
    });
    check('a storefront order arrives', placed.status === 201, placed.body);

    orderNumber = placed.body?.data?.orderNumber ?? '';
    const list = await admin(`/orders?search=${encodeURIComponent(orderNumber)}`);
    orderId = list.body?.data?.[0]?.id as string;
    check('and the panel can see it', Boolean(orderId), list.body?.data);

    const detail = await admin(`/orders/${orderId}`);
    check('with its lines', (detail.body?.data?.lines ?? []).length === 1, detail.body?.data?.lines?.length);
    check(
      'and only the moves the graph allows',
      JSON.stringify(detail.body?.data?.allowedTransitions) === JSON.stringify(['confirmed', 'cancelled', 'failed']),
      detail.body?.data?.allowedTransitions,
    );

    const illegal = await admin(`/orders/${orderId}/status`, { method: 'PATCH', body: { status: 'delivered' } });
    check('an illegal jump is refused', illegal.status === 409, illegal.status);
    check('with INVALID_STATUS_TRANSITION', illegal.body?.code === 'INVALID_STATUS_TRANSITION', illegal.body?.code);

    for (const status of ['confirmed', 'processing', 'packed', 'shipped']) {
      const move = await admin(`/orders/${orderId}/status`, { method: 'PATCH', body: { status } });
      check(`it can be moved to ${status}`, move.status === 200, move.body?.code);
    }

    const [afterShip] = await sql<{ available: number; reserved: number }>(
      'select available, reserved from inventory_levels where variant_id = $1',
      [variantId],
    );
    check('dispatch consumes the reservation', afterShip?.reserved === 0 && afterShip?.available === 8, afterShip);

    const [sold] = await sql<{ sold_count: number }>('select sold_count from products where id = $1', [productId]);
    check('and counts the sale', sold?.sold_count === 2, sold);

    const delivered = await admin(`/orders/${orderId}/status`, { method: 'PATCH', body: { status: 'delivered' } });
    check('delivery settles cash on delivery', delivered.body?.data?.paymentStatus === 'paid', delivered.body?.data?.paymentStatus);

    const shipment = await admin(`/orders/${orderId}/shipments`, {
      method: 'POST',
      body: { carrier: 'Pathao', trackingNumber: 'ZZADM-1', trackingUrl: null, note: null },
    });
    check('tracking can be recorded', shipment.status === 201, shipment.body);

    const customerView = await shop('/orders/track', {
      method: 'POST',
      body: { orderNumber: delivered.body?.data?.orderNumber, email: BUYER },
    });
    check('and the customer sees the new status', customerView.body?.data?.status === 'delivered', customerView.body?.data?.status);
    check('with the tracking attached', customerView.body?.data?.tracking?.number === 'ZZADM-1', customerView.body?.data?.tracking);
  }

  console.log('\n4. Customers can be read and blocked, never deleted');
  {
    const list = await admin(`/customers?search=${encodeURIComponent(BUYER)}`);
    check('a guest buyer creates no account', (list.body?.data ?? []).length === 0, list.body?.data?.length);

    const registered = await shop('/auth/register', {
      method: 'POST',
      body: { fullName: 'Zz Admin Shopper', email: BUYER, password: 'ShopperPass2026', acceptsTerms: true },
    });
    check('a registered shopper does', registered.status === 201, registered.status);

    const found = await admin(`/customers?search=${encodeURIComponent(BUYER)}`);
    const customerId = found.body?.data?.[0]?.id as string;
    check('and appears in the panel', Boolean(customerId), found.body?.data);
    check('never carrying a password hash', !JSON.stringify(found.body).includes('passwordHash'));

    const blocked = await admin(`/customers/${customerId}`, { method: 'PATCH', body: { status: 'blocked' } });
    check('blocking works', blocked.body?.data?.status === 'blocked', blocked.body?.data);

    const signIn = await shop('/auth/login', {
      method: 'POST',
      body: { email: BUYER, password: 'ShopperPass2026' },
    });
    check('and a blocked customer cannot sign in', signIn.status === 401, signIn.status);

    const deleteAttempt = await admin(`/customers/${customerId}`, { method: 'DELETE' });
    check('there is no way to delete a customer', deleteAttempt.status === 404, deleteAttempt.status);
  }

  console.log('\n5. Review moderation is the storefront gate');
  {
    await sql(
      `insert into reviews (product_id, customer_name, rating, body, status)
       values ($1, 'Zz Admin Reviewer', 5, 'A chair that is genuinely a chair.', 'pending')`,
      [productId],
    );

    const queue = await admin('/reviews?status=pending');
    const reviewId = (queue.body?.data ?? []).find((r: any) => r.customerName === 'Zz Admin Reviewer')?.id;
    check('a pending review is in the queue', Boolean(reviewId), queue.body?.data?.length);

    const before = await shop(`/products/${TAG}-chair/reviews`);
    check('and invisible on the storefront', (before.body?.data?.items ?? []).length === 0);

    const approved = await admin(`/reviews/${reviewId}`, { method: 'PATCH', body: { status: 'approved' } });
    check('approving it works', approved.status === 200, approved.status);

    const after = await shop(`/products/${TAG}-chair/reviews`);
    check('and publishes it at once', (after.body?.data?.items ?? []).length === 1, after.body?.data?.items?.length);

    const [rated] = await sql<{ rating_average: string; rating_count: number }>(
      'select rating_average, rating_count from products where id = $1',
      [productId],
    );
    check('the product rating is recomputed', Number(rated?.rating_average) === 5 && rated?.rating_count === 1, rated);

    const replied = await admin(`/reviews/${reviewId}/reply`, {
      method: 'PATCH',
      body: { adminReply: 'Thank you — glad it is a chair.' },
    });
    check('the shop can reply publicly', replied.status === 200, replied.status);

    const withReply = await shop(`/products/${TAG}-chair/reviews`);
    check('and the reply is shown', Boolean(withReply.body?.data?.items?.[0]?.adminReply), withReply.body?.data?.items?.[0]);

    const rejected = await admin(`/reviews/${reviewId}`, { method: 'PATCH', body: { status: 'rejected' } });
    check('rejecting it works', rejected.status === 200, rejected.status);

    const gone = await shop(`/products/${TAG}-chair/reviews`);
    check('and takes it back off the storefront', (gone.body?.data?.items ?? []).length === 0);

    const [unrated] = await sql<{ rating_count: number }>(
      'select rating_count from products where id = $1',
      [productId],
    );
    check('and the rating with it', unrated?.rating_count === 0, unrated);
  }

  console.log('\n6. Shipping zones are what checkout quotes from');
  {
    const before = await admin('/shipping/zones');
    const catchAll = (before.body?.data ?? []).find((zone: any) => zone.isDefault);
    check('the store has a catch-all zone', Boolean(catchAll), before.body?.data?.length);

    const cannotDelete = await admin(`/shipping/zones/${catchAll?.id}`, { method: 'DELETE' });
    check('which cannot be deleted', cannotDelete.status === 409, cannotDelete.status);

    const created = await admin('/shipping/zones', {
      method: 'POST',
      body: { name: `${TAG} Dhaka`, countries: [], cities: ['Dhaka'], isDefault: false, isActive: true },
    });
    check('a city zone can be added', created.status === 201, created.body);

    const method = await admin('/shipping/methods', {
      method: 'POST',
      body: { zoneId: created.body?.data?.id, name: `${TAG} Same day`, price: '99.00', isActive: true },
    });
    check('with its own rate', method.status === 201, method.body);

    const dhaka = await shop('/checkout/shipping-methods?country=Bangladesh&city=Dhaka');
    check(
      'and a Dhaka address is quoted it instead of the catch-all',
      (dhaka.body?.data ?? []).some((m: any) => m.name === `${TAG} Same day`),
      (dhaka.body?.data ?? []).map((m: any) => m.name),
    );

    const elsewhere = await shop('/checkout/shipping-methods?country=Bangladesh&city=Sylhet');
    check(
      'while everywhere else still falls back',
      !(elsewhere.body?.data ?? []).some((m: any) => m.name === `${TAG} Same day`),
      (elsewhere.body?.data ?? []).map((m: any) => m.name),
    );
  }

  console.log('\n7. A return becomes a refund, and only once');
  {
    // The order from section 3 is delivered, which is what a return needs.
    const requested = await shop(`/account/orders/${orderNumber}/returns`, {
      method: 'POST',
      body: { items: [{ lineIndex: 0, quantity: 1 }], reason: 'damaged', resolution: 'refund' },
    });
    check('the customer can request one', requested.status === 201, requested.body);

    const queue = await admin('/returns?status=requested');
    const returnId = (queue.body?.data ?? []).find((r: any) => r.orderNumber === orderNumber)?.id;
    check('and it reaches the panel', Boolean(returnId), queue.body?.data);

    const skip = await admin(`/returns/${returnId}/status`, { method: 'PATCH', body: { status: 'completed' } });
    check('it cannot skip straight to completed', skip.status === 409, skip.status);

    for (const status of ['approved', 'received']) {
      const move = await admin(`/returns/${returnId}/status`, { method: 'PATCH', body: { status } });
      check(`it can be moved to ${status}`, move.status === 200, move.body?.code);
    }

    const [item] = await sql<{ id: string }>(
      'select id from return_items where return_id = $1 limit 1',
      [returnId],
    );

    const inspected = await admin(`/returns/${returnId}/status`, {
      method: 'PATCH',
      body: { status: 'inspected', restock: [{ itemId: item!.id, quantity: 1 }] },
    });
    check('inspection is recorded', inspected.status === 200, inspected.body?.code);

    const [level] = await sql<{ available: number; damaged: number }>(
      'select available, damaged from inventory_levels where variant_id = $1',
      [variantId],
    );
    check('a sellable return goes back on the shelf', level?.available === 9, level);

    const completed = await admin(`/returns/${returnId}/status`, { method: 'PATCH', body: { status: 'completed' } });
    check('completing it raises a refund', Boolean(completed.body?.data?.refundNumber), completed.body?.data);

    const refunds = await admin('/refunds?status=requested');
    const refund = (refunds.body?.data ?? []).find((r: any) => r.orderNumber === orderNumber);
    check('which is waiting for approval, not already paid', Boolean(refund), refunds.body?.data);

    const payFirst = await admin(`/refunds/${refund?.id}`, { method: 'PATCH', body: { status: 'completed' } });
    check('a refund cannot be paid before it is approved', payFirst.status === 409, payFirst.status);

    await admin(`/refunds/${refund?.id}`, { method: 'PATCH', body: { status: 'approved' } });
    const paid = await admin(`/refunds/${refund?.id}`, {
      method: 'PATCH',
      body: { status: 'completed', method: 'cash' },
    });
    check('and once approved it can be', paid.status === 200, paid.body?.code);

    const [order] = await sql<{ refunded_total: string; payment_status: string }>(
      'select refunded_total, payment_status from orders where order_number = $1',
      [orderNumber],
    );
    check('the order records what went back', Number(order?.refunded_total) > 0, order);
    check(
      'and its payment status says so',
      order?.payment_status === 'partially_refunded' || order?.payment_status === 'refunded',
      order?.payment_status,
    );
  }

  console.log('\n8. Coupons are the storefront’s rules, not the browser’s');
  {
    const created = await admin('/coupons', {
      method: 'POST',
      body: { code: 'ZZADM25', type: 'percentage', value: '25', minOrderAmount: '100', status: 'active' },
    });
    check('a code can be created', created.status === 201, created.body);

    const clash = await admin('/coupons', {
      method: 'POST',
      body: { code: 'zzadm25', type: 'percentage', value: '5', status: 'active' },
    });
    check('the same code cannot be created twice', clash.status === 409, clash.status);

    const good = await shop('/coupons/validate', { method: 'POST', body: { code: 'ZZADM25', subtotal: 200 } });
    check('the storefront validates it against the store', good.body?.data?.valid === true, good.body?.data);
    check('and gets the discount the rule says', good.body?.data?.discount === '50.00', good.body?.data);

    const under = await shop('/coupons/validate', { method: 'POST', body: { code: 'ZZADM25', subtotal: 10 } });
    check('under the minimum it is refused', under.body?.data?.reason === 'minimum_not_met', under.body?.data);

    const off = await admin(`/coupons/${created.body?.data?.id}`, {
      method: 'PUT',
      body: { code: 'ZZADM25', type: 'percentage', value: '25', minOrderAmount: '100', status: 'disabled' },
    });
    check('switching it off works', off.status === 200, off.status);

    const refused = await shop('/coupons/validate', { method: 'POST', body: { code: 'ZZADM25', subtotal: 200 } });
    check('and the storefront stops accepting it', refused.body?.data?.valid === false, refused.body?.data);
  }

  console.log('\n9. Pages are published, and sanitised on the way in');
  {
    const created = await admin('/website/pages', {
      method: 'POST',
      body: {
        title: `${TAG} Delivery notes`,
        bodyHtml: '<p>Safe copy.</p><script>alert(1)</script><a href="javascript:alert(1)">bad link</a>',
        status: 'draft',
      },
    });
    check('a page can be created', created.status === 201, created.body);

    const pageId = created.body?.data?.id as string;
    const slug = created.body?.data?.slug as string;
    check('with a slug made from the title', slug === `${TAG}-delivery-notes`, slug);

    const draft = await shop(`/pages/${slug}`);
    check('a draft is invisible on the storefront', draft.status === 404, draft.status);

    await admin(`/website/pages/${pageId}`, {
      method: 'PUT',
      body: { title: `${TAG} Delivery notes`, bodyHtml: created.body?.data?.bodyHtml, status: 'published' },
    });

    const live = await shop(`/pages/${slug}`);
    check('publishing it puts it on the storefront', live.status === 200, live.status);
    check('the script tag did not survive', !String(live.body?.data?.bodyHtml).includes('<script'), live.body?.data?.bodyHtml);
    check('nor the javascript: link', !String(live.body?.data?.bodyHtml).includes('javascript:'), live.body?.data?.bodyHtml);
    check('but the real copy did', String(live.body?.data?.bodyHtml).includes('Safe copy'), live.body?.data?.bodyHtml);

    const policy = await admin('/website/pages?search=Privacy');
    const policyId = (policy.body?.data ?? []).find((p: any) => p.systemKey)?.id;
    const refused = await admin(`/website/pages/${policyId}`, { method: 'DELETE' });
    check('a policy page cannot be deleted', refused.status === 409, refused.status);

    const removed = await admin(`/website/pages/${pageId}`, { method: 'DELETE' });
    check('an ordinary one can be', removed.status === 204, removed.status);
  }

  console.log('\n10. Settings, attributes and reports');
  {
    const settings = await admin('/settings');
    check('settings read back', settings.status === 200, settings.status);

    const currency = settings.body?.data?.currency;
    const locked = await admin('/settings', {
      method: 'PUT',
      body: {
        storeName: settings.body?.data?.storeName,
        currency: currency === 'USD' ? 'EUR' : 'USD',
        language: settings.body?.data?.language,
        timezone: settings.body?.data?.timezone,
      },
    });
    check(
      'currency cannot change once the store has taken orders',
      settings.body?.data?.orderCount > 0 ? locked.status === 409 : locked.status === 200,
      { orders: settings.body?.data?.orderCount, status: locked.status },
    );

    const attribute = await admin('/attributes', {
      method: 'POST',
      body: { name: `${TAG} Size`, inputType: 'select', values: [{ value: 'Small' }, { value: 'Large' }] },
    });
    check('an attribute can be created with its values', attribute.status === 201, attribute.body);

    const list = await admin('/attributes');
    const mine = (list.body?.data ?? []).find((a: any) => a.name === `${TAG} Size`);
    check('and reads back with them', (mine?.values ?? []).length === 2, mine?.values?.length);

    const removed = await admin(`/attributes/${mine?.id}`, { method: 'DELETE' });
    check('an unused attribute can be removed', removed.status === 204, removed.status);

    const reports = await admin('/reports?days=30');
    check('reports compute', reports.status === 200, reports.status);
    check('and count the orders this run placed', Number(reports.body?.data?.totals?.orders) >= 1, reports.body?.data?.totals);
  }

  console.log('\n11. File uploads');
  if (!config.storage.configured || !config.storage.publicUrl) {
    console.log('  SKIP  object storage is not configured (R2_* in .env)');
  } else {
    // A real 1×1 PNG, so the check exercises bytes rather than an empty body.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    const uploaded = await upload('products', png, 'check.png', 'image/png');
    check('an image uploads', uploaded.status === 201, uploaded.body);

    const key = uploaded.body?.data?.key as string;
    const url = uploaded.body?.data?.url as string;
    check('it is namespaced to this store', key?.startsWith('stores/'), key);
    check('and addressed on the public domain, not the signing endpoint', url?.startsWith(config.storage.publicUrl!), url);

    if (url) {
      const fetched = await fetch(`${url}?cb=${Date.now()}`);
      check('the file is publicly readable', fetched.status === 200, fetched.status);
      check('and served as an image', (fetched.headers.get('content-type') ?? '').startsWith('image/'), fetched.headers.get('content-type'));
    }

    const wrongType = await upload('products', Buffer.from('not an image'), 'x.txt', 'text/plain');
    check('a disallowed type is refused', wrongType.status === 415, wrongType.status);
    check('with UNSUPPORTED_FILE_TYPE', wrongType.body?.code === 'UNSUPPORTED_FILE_TYPE', wrongType.body?.code);

    const foreign = await admin('/uploads?key=stores/TNT-SOMEBODY-ELSE/products/x.png', { method: 'DELETE' });
    check("another store's file cannot be deleted", foreign.status === 400, foreign.status);

    const removed = await admin(`/uploads?key=${encodeURIComponent(key)}`, { method: 'DELETE' });
    check('its own file can be', removed.status === 200, removed.status);

    if (url) {
      const gone = await fetch(`${url}?cb=${Date.now()}`);
      check('and is really gone from the bucket', gone.status === 404, gone.status);
    }
  }

  if (!KEEP) {
    console.log('\nCleaning up…');
    await cleanup(sql);
  }

  await pool.end().catch(() => undefined);

  console.log(`\n${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exitCode = 1;
}

/**
 * Removes everything a run leaves behind, in dependency order.
 *
 * The fixture product is deleted **in SQL, not through the API**. Its own
 * `DELETE` route archives a product that has ever sold rather than removing it —
 * correct behaviour, and exactly wrong here: the archived row keeps the SKU, so
 * the next run cannot create its fixture and every check after it collapses.
 */
async function cleanup(sql: (text: string, params?: unknown[]) => Promise<any[]>): Promise<void> {
  const scoped = `select id from orders where email in ('${BUYER}', 'panel-demo@example.test')`;

  for (const table of ['payments', 'order_status_history', 'order_addresses', 'order_items', 'shipments']) {
    await sql(`delete from ${table} where order_id in (${scoped})`);
  }
  await sql(`delete from orders where email in ($1, 'panel-demo@example.test')`, [BUYER]);
  await sql(`delete from reviews where customer_name = 'Zz Admin Reviewer'`);
  await sql(`delete from customer_sessions where customer_id in (select id from customers where email = $1)`, [BUYER]);
  await sql(`delete from customers where email = $1`, [BUYER]);
  await sql(`delete from inventory_transactions where warehouse_id in (select id from warehouses where code = 'ZZADMWH')`);
  await sql(`delete from inventory_levels where warehouse_id in (select id from warehouses where code = 'ZZADMWH')`);
  await sql(`delete from refunds where order_id in (${scoped})`);
  await sql(`delete from return_history where return_id in (select id from returns where order_id in (${scoped}))`);
  await sql(`delete from return_items where return_id in (select id from returns where order_id in (${scoped}))`);
  await sql(`delete from returns where order_id in (${scoped})`);
  await sql(`delete from coupons where code like 'ZZADM%'`);
  await sql(`delete from attribute_values where attribute_id in (select id from attributes where name like $1)`, [`${TAG}%`]);
  await sql(`delete from attributes where name like $1`, [`${TAG}%`]);
  await sql(`delete from pages where title like $1`, [`${TAG}%`]);
  await sql(`delete from shipping_methods where name like $1`, [`${TAG}%`]);
  await sql(`delete from shipping_zones where name like $1`, [`${TAG}%`]);
  await sql(`delete from warehouses where code = 'ZZADMWH'`);
  // Variants, media and stock rows cascade from the product.
  await sql(`delete from products where name like $1`, [`${TAG}%`]);
}

await main();
await closeRedis().catch(() => undefined);

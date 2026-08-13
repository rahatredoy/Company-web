/**
 * The commerce write path — accounts, checkout, orders, returns, reviews.
 *
 *   npx tsx scripts/verify-commerce.ts --slug abc-fashion --password '…' --other e-comarch
 *   npx tsx scripts/verify-commerce.ts --keep      # leave the fixtures behind
 *
 * What it is really proving is that the **server** decides what an order costs.
 * The basket lives in the customer's own browser, so every price, discount and
 * shipping rate in it is a number they could have edited; if any of them reached
 * an order, the shop could be robbed with a devtools console.
 *
 * Everything it creates is prefixed `zz-commerce` / `ZZCOM` and removed at the
 * end, so it is safe to run against a store with real orders in it.
 *
 * `node:http` rather than `fetch`, because `fetch` drops a custom `Host` and the
 * hostname is how the API decides which store it is serving.
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
const OTHER = arg('other') ?? (SLUG === 'abc-fashion' ? (config.devStoreSlug ?? '') : 'abc-fashion');
const PASSWORD = arg('password');
const KEEP = process.argv.includes('--keep');

const STORE_HOST = `${SLUG}.${ROOT}`;
const ADMIN_HOST = `admin.${SLUG}.${ROOT}`;
const TAG = 'zz-commerce';
const SHOPPER_EMAIL = 'zz-commerce-shopper@example.test';
const SHOPPER_PASSWORD = 'ShopperPass2026';

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

interface Res {
  status: number;
  body: any;
  location?: string;
}

/** One cookie jar per actor, so an admin cookie can never authorise a shopper. */
type Jar = Map<string, string>;
const adminJar: Jar = new Map();
const shopperJar: Jar = new Map();
const guestJar: Jar = new Map();

async function call(
  host: string,
  path: string,
  init: { method?: string; body?: unknown; jar?: Jar } = {},
): Promise<Res> {
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
  const headers: Record<string, string> = {
    accept: 'application/json',
    host,
    ...(payload ? { 'content-type': 'application/json' } : {}),
  };

  if (init.jar && init.jar.size > 0) {
    headers.cookie = [...init.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  const result = await new Promise<{ status: number; setCookie: string[]; text: string; location?: string }>(
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
              location: response.headers.location,
            }),
          );
        },
      );
      req.on('error', reject);
      if (payload) req.write(payload);
      req.end();
    },
  );

  if (init.jar) {
    for (const raw of result.setCookie) {
      const [pair] = raw.split(';');
      const [name, ...rest] = (pair ?? '').split('=');
      if (name) init.jar.set(name.trim(), rest.join('='));
    }
  }

  let body: unknown = null;
  try {
    body = result.text ? JSON.parse(result.text) : null;
  } catch {
    body = result.text;
  }

  return { status: result.status, body, location: result.location };
}

const shop = (path: string, init: { method?: string; body?: unknown; jar?: Jar } = {}) =>
  call(STORE_HOST, `/api/v1/storefront${path}`, init);

const admin = (path: string, init: { method?: string; body?: unknown } = {}) =>
  call(ADMIN_HOST, `/api/v1/admin${path}`, { ...init, jar: adminJar });

/**
 * Clears this script's own rate-limit counters.
 *
 * The limits it trips are the real ones and they are meant to be there — sign
 * in, register, track an order, request a return are all things a stranger
 * should not be able to hammer. But a run does every one of them several times
 * in a few seconds, so the second run inside the window would fail on the
 * limiter rather than on anything under test.
 *
 * Cleared for this machine's IP and the test identities only, exactly as the
 * `zz-` prefix keeps its rows to itself.
 */
async function clearOwnRateLimits(): Promise<void> {
  const scopes = [
    'customer-register',
    'customer-login',
    'customer-forgot',
    'customer-reset',
    'coupon-validate',
    'checkout',
    'order-track',
    'return-request',
    'review-submit',
    'login',
  ];

  const identities = [SHOPPER_EMAIL, 'zz-guest@example.test', 'nobody-here@example.test'];
  const ips = ['127.0.0.1', '::ffff:127.0.0.1', '::1'];

  for (const scope of scopes) {
    for (const ip of ips) {
      await resetRateLimit(scope, ip);
      await resetRateLimit(`${scope}:ip`, ip);
    }
    for (const identity of identities) {
      await resetRateLimit(`${scope}:id`, identity.toLowerCase());
    }
  }
}

async function main(): Promise<void> {
  console.log(`\nCommerce checks against ${STORE_HOST} on port ${config.api.port}\n`);
  await clearOwnRateLimits();

  const pool = await openTenantPoolForSlug(SLUG);
  const sql = async <T = any>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await pool.query(text, params as never[])).rows as T[];

  // ---------------------------------------------------------------- set-up --
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
    console.error(`\n  Could not sign in as ${adminRow.email}: ${JSON.stringify(login.body)}\n`);
    process.exit(1);
  }

  await cleanup(sql);

  const product = await admin('/products', {
    method: 'POST',
    body: { name: `${TAG} Lamp`, status: 'active', sku: 'ZZCOM-LAMP', price: '100.00' },
  });
  const productId = product.body?.data?.id as string;
  const variantId = product.body?.data?.variants?.[0]?.id as string;
  check('a product to sell exists', product.status === 201 && Boolean(variantId), product.body);

  // Stock has to be tracked for the oversell checks to mean anything — an
  // untracked variant is deliberately always sellable.
  const [warehouse] = await sql<{ id: string }>(
    `insert into warehouses (name, code, is_default) values ('ZZCOM WH', 'ZZCOMWH', false)
     on conflict (code) do update set name = excluded.name returning id`,
  );
  await sql(
    `insert into inventory_levels (variant_id, warehouse_id, available, low_stock_threshold)
     values ($1, $2, 3, 2)
     on conflict (variant_id, warehouse_id) do update set available = 3`,
    [variantId, warehouse!.id],
  );

  await sql(
    `insert into payment_methods (provider, label, is_enabled, sort_order)
     values ('mock', 'Test Card', true, 5)
     on conflict (provider) do update set is_enabled = true, label = excluded.label`,
  );

  await sql(
    `insert into coupons (code, description, type, value, min_order_amount, status)
     values ('ZZCOM20', '20% off', 'percentage', 20, 50, 'active')
     on conflict (code) do update set value = 20, min_order_amount = 50, status = 'active'`,
  );
  await sql(
    `insert into coupons (code, description, type, value, status, ends_at)
     values ('ZZCOMOLD', 'expired', 'percentage', 50, 'active', now() - interval '1 day')
     on conflict (code) do update set ends_at = now() - interval '1 day'`,
  );

  const shipping = await shop('/checkout/shipping-methods?country=Bangladesh');
  const shippingMethodId = shipping.body?.data?.[0]?.id as string;
  check('the store quotes a delivery option', Boolean(shippingMethodId), shipping.body);

  const address = {
    fullName: 'Zz Commerce',
    phone: '+8801700000000',
    addressLine1: 'House 1, Road 1',
    city: 'Dhaka',
    country: 'Bangladesh',
  };
  const line = { productId, variantId, quantity: 1 };

  console.log('\n1. Accounts');
  {
    const register = await shop('/auth/register', {
      method: 'POST',
      jar: shopperJar,
      body: {
        fullName: 'Zz Shopper',
        email: SHOPPER_EMAIL,
        password: SHOPPER_PASSWORD,
        acceptsTerms: true,
      },
    });
    check('a shopper can register', register.status === 201, register.body);
    check('and is signed in straight away', shopperJar.has('store_customer_session'));

    const twice = await shop('/auth/register', {
      method: 'POST',
      body: { fullName: 'Zz Again', email: SHOPPER_EMAIL, password: SHOPPER_PASSWORD, acceptsTerms: true },
    });
    check('the same address cannot register twice', twice.status === 409, twice.status);

    const me = await shop('/account/me', { jar: shopperJar });
    check('the account reads back', me.body?.data?.email === SHOPPER_EMAIL, me.body);
    check('and never leaks the password hash', !JSON.stringify(me.body).includes('passwordHash'));

    const anonymous = await shop('/account/me');
    check('signed out is 404, not 401 — the storefront redirects on null', anonymous.status === 404, anonymous.status);

    const wrong = await shop('/auth/login', {
      method: 'POST',
      body: { email: SHOPPER_EMAIL, password: 'not-the-password' },
    });
    const unknown = await shop('/auth/login', {
      method: 'POST',
      body: { email: 'nobody-here@example.test', password: 'not-the-password' },
    });
    check(
      'a wrong password and an unknown address answer identically',
      wrong.status === unknown.status && wrong.body?.message === unknown.body?.message,
      { wrong: wrong.body?.message, unknown: unknown.body?.message },
    );

    const orders = await shop('/account/orders');
    check('the order list needs a session', orders.status === 401, orders.status);
  }

  console.log('\n2. The server prices the basket, not the browser');
  {
    const valid = await shop('/coupons/validate', { method: 'POST', body: { code: 'ZZCOM20', subtotal: 100 } });
    check('a good coupon validates', valid.body?.data?.valid === true, valid.body);
    check('and is worth what the rule says', valid.body?.data?.discount === '20.00', valid.body?.data);

    const under = await shop('/coupons/validate', { method: 'POST', body: { code: 'ZZCOM20', subtotal: 10 } });
    check('under the minimum it is refused', under.body?.data?.reason === 'minimum_not_met', under.body?.data);

    const expired = await shop('/coupons/validate', { method: 'POST', body: { code: 'ZZCOMOLD', subtotal: 100 } });
    check('an expired coupon is refused', expired.body?.data?.reason === 'expired', expired.body?.data);

    const nonsense = await shop('/coupons/validate', { method: 'POST', body: { code: 'NOPE', subtotal: 100 } });
    check('an unknown coupon is refused', nonsense.body?.data?.reason === 'unknown', nonsense.body?.data);

    const order = await shop('/checkout', {
      method: 'POST',
      jar: guestJar,
      body: {
        email: 'zz-guest@example.test',
        phone: '+8801700000000',
        lines: [line],
        shippingAddress: address,
        shippingMethodId,
        paymentProvider: 'cod',
        couponCode: 'ZZCOM20',
      },
    });
    check('a guest can check out', order.status === 201, order.body);

    const number = order.body?.data?.orderNumber as string;
    const detail = await shop(`/account/orders/${number}`, { jar: guestJar });
    check('the guest can read their own receipt', detail.status === 200, detail.status);
    check('priced from the database, not the request', detail.body?.data?.totals?.subtotal === '100.00', detail.body?.data?.totals);
    check('the coupon was applied server-side', detail.body?.data?.totals?.discount === '20.00', detail.body?.data?.totals);
    check('and the total adds up', detail.body?.data?.totals?.total === '80.00', detail.body?.data?.totals);

    const stranger = await shop(`/account/orders/${number}`);
    check('another browser cannot read it by order number alone', stranger.status === 404, stranger.status);

    const timeline = detail.body?.data?.timeline ?? [];
    check('the timeline always carries all five steps', timeline.length === 5, timeline.length);
    check('with only the reached ones lit', timeline.filter((t: any) => t.reached).length === 1);

    const badCoupon = await shop('/checkout', {
      method: 'POST',
      body: {
        email: 'zz-guest@example.test',
        phone: '+8801700000000',
        lines: [line],
        shippingAddress: address,
        shippingMethodId,
        paymentProvider: 'cod',
        couponCode: 'ZZCOMOLD',
      },
    });
    check('checkout refuses an expired coupon', badCoupon.status === 422, badCoupon.status);

    const badMethod = await shop('/checkout', {
      method: 'POST',
      body: {
        email: 'zz-guest@example.test',
        phone: '+8801700000000',
        lines: [line],
        shippingAddress: address,
        shippingMethodId,
        paymentProvider: 'stripe',
        couponCode: null,
      },
    });
    check('and a payment method the store has not switched on', badMethod.status === 422, badMethod.status);
  }

  console.log('\n3. Stock is real');
  {
    const [level] = await sql<{ available: number; reserved: number }>(
      'select available, reserved from inventory_levels where variant_id = $1',
      [variantId],
    );
    check('the first order reserved a unit', level?.available === 2 && level?.reserved === 1, level);

    const greedy = await shop('/checkout', {
      method: 'POST',
      body: {
        email: 'zz-guest@example.test',
        phone: '+8801700000000',
        lines: [{ ...line, quantity: 99 }],
        shippingAddress: address,
        shippingMethodId,
        paymentProvider: 'cod',
      },
    });
    check('an oversell is refused', greedy.status === 422, greedy.status);
    check('with INSUFFICIENT_STOCK', greedy.body?.code === 'INSUFFICIENT_STOCK', greedy.body?.code);

    const [after] = await sql<{ available: number }>(
      'select available from inventory_levels where variant_id = $1',
      [variantId],
    );
    check('and the refused order left stock untouched', after?.available === 2, after);
  }

  console.log('\n4. Paying, cancelling, returning');
  {
    const paid = await shop('/checkout', {
      method: 'POST',
      jar: shopperJar,
      body: {
        email: SHOPPER_EMAIL,
        phone: '+8801700000000',
        lines: [line],
        shippingAddress: address,
        shippingMethodId,
        paymentProvider: 'mock',
      },
    });
    const number = paid.body?.data?.orderNumber as string;
    check('a card order returns a gateway URL', typeof paid.body?.data?.paymentRedirectUrl === 'string', paid.body?.data);

    const settle = await call(STORE_HOST, `/api/v1/storefront/payments/mock/${number}?outcome=paid`, {
      jar: shopperJar,
    });
    check('the gateway settles and redirects back', settle.status === 303, settle.status);

    const afterPay = await shop(`/account/orders/${number}`, { jar: shopperJar });
    check('the order is now paid', afterPay.body?.data?.paymentStatus === 'paid', afterPay.body?.data?.paymentStatus);
    check('and confirmed', afterPay.body?.data?.status === 'confirmed', afterPay.body?.data?.status);

    const replay = await call(STORE_HOST, `/api/v1/storefront/payments/mock/${number}?outcome=failed`, {
      jar: shopperJar,
    });
    const afterReplay = await shop(`/account/orders/${number}`, { jar: shopperJar });
    check(
      'settling again cannot unpay it',
      replay.status === 303 && afterReplay.body?.data?.paymentStatus === 'paid',
      afterReplay.body?.data?.paymentStatus,
    );

    const mine = await shop('/account/orders', { jar: shopperJar });
    check('it appears in the account order list', (mine.body?.data ?? []).some((o: any) => o.orderNumber === number));

    const cancel = await shop(`/account/orders/${number}/cancel`, {
      method: 'POST',
      jar: shopperJar,
      body: { reason: 'changed_mind', notes: null },
    });
    check('the customer can cancel it', cancel.status === 204, cancel.status);

    const [restocked] = await sql<{ available: number }>(
      'select available from inventory_levels where variant_id = $1',
      [variantId],
    );
    check('cancelling puts the stock back', restocked?.available === 2, restocked);

    const again = await shop(`/account/orders/${number}/cancel`, {
      method: 'POST',
      jar: shopperJar,
      body: { reason: 'changed_mind' },
    });
    check('and it cannot be cancelled twice', again.status === 422, again.status);

    // A return needs a delivered order; the admin side that moves an order
    // through fulfilment is the next slice, so this plants the state directly.
    const delivered = await shop('/checkout', {
      method: 'POST',
      jar: shopperJar,
      body: {
        email: SHOPPER_EMAIL,
        phone: '+8801700000000',
        lines: [line],
        shippingAddress: address,
        shippingMethodId,
        paymentProvider: 'cod',
      },
    });
    const deliveredNumber = delivered.body?.data?.orderNumber as string;
    await sql(
      `update orders set status = 'delivered', delivered_at = now() where order_number = $1`,
      [deliveredNumber],
    );

    const beforeWindow = await shop(`/account/orders/${deliveredNumber}`, { jar: shopperJar });
    check('a delivered order offers a return', beforeWindow.body?.data?.canRequestReturn === true, beforeWindow.body?.data?.canRequestReturn);

    const tooMany = await shop(`/account/orders/${deliveredNumber}/returns`, {
      method: 'POST',
      jar: shopperJar,
      body: { items: [{ lineIndex: 0, quantity: 9 }], reason: 'damaged', resolution: 'refund' },
    });
    check('returning more than was bought is refused', tooMany.status === 422, tooMany.status);

    const requested = await shop(`/account/orders/${deliveredNumber}/returns`, {
      method: 'POST',
      jar: shopperJar,
      body: { items: [{ lineIndex: 0, quantity: 1 }], reason: 'damaged', resolution: 'refund' },
    });
    check('a return is accepted', requested.status === 201, requested.body);
    check('and gets a reference', typeof requested.body?.data?.returnNumber === 'string', requested.body?.data);

    const twice = await shop(`/account/orders/${deliveredNumber}/returns`, {
      method: 'POST',
      jar: shopperJar,
      body: { items: [{ lineIndex: 0, quantity: 1 }], reason: 'damaged', resolution: 'refund' },
    });
    check('the same line cannot be returned twice', twice.status === 422, twice.status);

    const list = await shop('/account/returns', { jar: shopperJar });
    check('the return shows in the account', (list.body?.data ?? []).length >= 1, list.body?.data?.length);
  }

  console.log('\n5. Guest tracking');
  {
    const [row] = await sql<{ order_number: string }>(
      `select order_number from orders where email = 'zz-guest@example.test' order by placed_at desc limit 1`,
    );

    const right = await shop('/orders/track', {
      method: 'POST',
      body: { orderNumber: row!.order_number, email: 'zz-guest@example.test' },
    });
    check('order number plus the right email finds it', right.status === 200, right.status);

    const wrong = await shop('/orders/track', {
      method: 'POST',
      body: { orderNumber: row!.order_number, email: 'someone-else@example.test' },
    });
    check('the wrong email does not', wrong.status === 404, wrong.status);
    check('and answers exactly as an unknown order does', wrong.body?.code === 'NOT_FOUND', wrong.body?.code);
  }

  console.log('\n6. Reviews wait for moderation');
  {
    const submit = await shop(`/products/${TAG}-lamp/reviews`, {
      method: 'POST',
      jar: shopperJar,
      body: { rating: 5, body: 'Genuinely a very good lamp indeed.' },
    });
    check('a signed-in customer can review', submit.status === 202, submit.body);
    check('and it lands pending', submit.body?.data?.status === 'pending', submit.body?.data);

    const anonymous = await shop(`/products/${TAG}-lamp/reviews`, {
      method: 'POST',
      body: { rating: 1, body: 'Anonymous spam, at some length.' },
    });
    check('an anonymous review is refused', anonymous.status === 401, anonymous.status);

    const before = await shop(`/products/${TAG}-lamp/reviews`);
    check('a pending review is invisible on the storefront', (before.body?.data?.items ?? []).length === 0, before.body?.data?.items?.length);

    await sql(`update reviews set status = 'approved' where customer_name = 'Zz Shopper'`);

    const after = await shop(`/products/${TAG}-lamp/reviews`);
    check('approving it publishes it', (after.body?.data?.items ?? []).length === 1, after.body?.data?.items?.length);
    check('marked as a verified purchase', after.body?.data?.items?.[0]?.verifiedPurchase === true, after.body?.data?.items?.[0]);
  }

  console.log('\n7. Isolation');
  if (!OTHER || OTHER === SLUG) {
    console.log('  SKIP  no second store given; pass --other <slug>');
  } else {
    const otherHost = `${OTHER}.${ROOT}`;
    const theirs = await call(otherHost, '/api/v1/storefront/account/me', { jar: shopperJar });
    check(`this store's customer session does nothing on ${OTHER}`, theirs.status === 404, theirs.status);

    const [row] = await sql<{ order_number: string }>(
      `select order_number from orders where email = 'zz-guest@example.test' order by placed_at desc limit 1`,
    );
    const order = await call(otherHost, `/api/v1/storefront/orders/track`, {
      method: 'POST',
      body: { orderNumber: row!.order_number, email: 'zz-guest@example.test' },
    });
    check(`and its orders are unreachable from ${OTHER}`, order.status === 404, order.status);
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
 * Removes everything a previous run left, in dependency order.
 *
 * The fixture product goes in SQL rather than through the API: its `DELETE`
 * route archives anything that has ever sold, and an archived row keeps its SKU,
 * which would stop the next run creating its own fixture.
 */
async function cleanup(sql: (text: string, params?: unknown[]) => Promise<any[]>): Promise<void> {
  await sql(`delete from return_items where return_id in (
               select r.id from returns r join orders o on o.id = r.order_id
               where o.email in ($1, $2))`, [SHOPPER_EMAIL, 'zz-guest@example.test']);
  await sql(`delete from return_history where return_id in (
               select r.id from returns r join orders o on o.id = r.order_id
               where o.email in ($1, $2))`, [SHOPPER_EMAIL, 'zz-guest@example.test']);
  await sql(`delete from returns where order_id in (select id from orders where email in ($1, $2))`, [SHOPPER_EMAIL, 'zz-guest@example.test']);
  await sql(`delete from coupon_redemptions where order_id in (select id from orders where email in ($1, $2))`, [SHOPPER_EMAIL, 'zz-guest@example.test']);
  await sql(`delete from payments where order_id in (select id from orders where email in ($1, $2))`, [SHOPPER_EMAIL, 'zz-guest@example.test']);
  await sql(`delete from order_status_history where order_id in (select id from orders where email in ($1, $2))`, [SHOPPER_EMAIL, 'zz-guest@example.test']);
  await sql(`delete from order_addresses where order_id in (select id from orders where email in ($1, $2))`, [SHOPPER_EMAIL, 'zz-guest@example.test']);
  await sql(`delete from order_items where order_id in (select id from orders where email in ($1, $2))`, [SHOPPER_EMAIL, 'zz-guest@example.test']);
  await sql(`delete from orders where email in ($1, $2)`, [SHOPPER_EMAIL, 'zz-guest@example.test']);
  await sql(`delete from reviews where customer_name = 'Zz Shopper'`);
  await sql(`delete from customer_sessions where customer_id in (select id from customers where email = $1)`, [SHOPPER_EMAIL]);
  await sql(`delete from customers where email = $1`, [SHOPPER_EMAIL]);
  await sql(`delete from coupons where code in ('ZZCOM20', 'ZZCOMOLD')`);
  await sql(`delete from inventory_transactions where warehouse_id in (select id from warehouses where code = 'ZZCOMWH')`);
  await sql(`delete from inventory_levels where warehouse_id in (select id from warehouses where code = 'ZZCOMWH')`);
  await sql(`delete from warehouses where code = 'ZZCOMWH'`);
  await sql(`delete from payment_methods where provider = 'mock'`);
  // Variants, media and stock rows cascade from the product.
  await sql(`delete from products where name like $1`, [`${TAG}%`]);
}

await main();
await closeRedis().catch(() => undefined);

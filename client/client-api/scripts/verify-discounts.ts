/**
 * Discounts, end to end.
 *
 * The engine's whole risk is a rule that is accepted by the panel, shown by the
 * basket and then not honoured at the till — or honoured differently. So every
 * check here goes through the same doors a shop and a shopper use: the admin API
 * writes the rule, `POST /storefront/discounts/quote` prices a basket the way the
 * cart does, and `POST /storefront/checkout` places a real order whose totals,
 * line discounts and redemption ledger are then read back.
 *
 * Covered: every value type (percentage with a cap, fixed amount, fixed price,
 * buy X get Y in one pool and across two, bundle, free delivery), product scope
 * and exclusions, minimum order and quantity, required items, automatic
 * discounts and the store strategy, combination rules, schedules by date, day
 * and hour, customer conditions (sign-in, first order), payment and bank-card
 * offers, vouchers (assigned, spent, handed back on cancel), per-customer limits,
 * cooldowns, usage limits, the ledger, archiving, duplication, reward vouchers on
 * registration and on a birthday, and the storefront's "Coupon Available" filter.
 *
 * It **creates and removes its own fixtures** — two categories, two brands,
 * three products, two shoppers, a bank's card prefixes and every discount — so
 * it is safe against `e-comarch`. The orders it places are cancelled and then
 * deleted with the rest, unless `--keep`.
 *
 * Usage:
 *   npx tsx scripts/verify-discounts.ts --password '…'
 */
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { reset as resetRateLimit } from '../src/lib/rate-limit';
import { closeRedis } from '../src/lib/redis';

const args = process.argv.slice(2);
const arg = (name: string, fallback?: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const BASE = arg('base', 'http://localhost:4100')!;
const SLUG = arg('slug', process.env.DEV_STORE_SLUG ?? 'e-comarch')!;
const EMAIL = arg('email', 'redoyahmed198@gmail.com')!;
const PASSWORD = arg('password');
const KEEP = args.includes('--keep');

if (!PASSWORD) {
  console.error("Pass the store admin password: --password '…'");
  process.exit(1);
}

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
  }
}

type Jar = { cookie: string };
const adminJar: Jar = { cookie: '' };

async function call<T = any>(
  path: string,
  init: { method?: string; body?: unknown; jar?: Jar } = {},
): Promise<{ status: number; body: T; raw: any }> {
  const send = () =>
    fetch(`${BASE}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        'X-Store-Slug': SLUG,
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.jar?.cookie ? { cookie: init.jar.cookie } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });

  /*
   * `npm run dev` restarts the API whenever a source file changes. A request that
   * never arrived, or one that is safe to repeat (a read, a quote), waits for the
   * restart and goes again; anything else fails loudly, because repeating an
   * order that may already have been placed would test something else.
   */
  let response: Response;
  try {
    response = await send();
  } catch (error) {
    const refused = String((error as { cause?: { code?: string } }).cause?.code) === 'ECONNREFUSED';
    const repeatable = (init.method ?? 'GET') === 'GET' || path.endsWith('/discounts/quote');
    if (!refused && !repeatable) throw error;
    await waitForApi();
    response = await send();
  }

  const set = response.headers.getSetCookie?.() ?? [];
  if (init.jar && set.length) {
    const jar = new Map(init.jar.cookie ? init.jar.cookie.split('; ').map((pair) => pair.split('=') as [string, string]) : []);
    for (const entry of set) {
      const [pair] = entry.split(';');
      const [name, ...rest] = (pair ?? '').split('=');
      if (name) jar.set(name.trim(), rest.join('='));
    }
    init.jar.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return {
    status: response.status,
    body: (payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload) as T,
    raw: payload,
  };
}

async function waitForApi(): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const healthy = await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false);
    if (healthy) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('The API did not come back.');
}

const admin = <T = any>(path: string, init: { method?: string; body?: unknown } = {}) =>
  call<T>(`/api/v1/admin${path}`, { ...init, jar: adminJar });
const shop = <T = any>(path: string, init: { method?: string; body?: unknown; jar?: Jar } = {}) =>
  call<T>(`/api/v1/storefront${path}`, init);

const cancel = (orderId: string) =>
  admin(`/orders/${orderId}/status`, { method: 'PATCH', body: { status: 'cancelled', note: 'verify-discounts' } });

const stamp = process.pid.toString(36).toUpperCase();
const TAG = `zz-disc-${stamp.toLowerCase()}`;
const CODE = (name: string) => `ZZ${stamp}${name}`.slice(0, 40);

/**
 * Clears this suite's own rate-limit keys. It quotes, registers and checks out
 * far faster than a shopper, which is exactly what the limiter exists to stop.
 */
async function unthrottle(): Promise<void> {
  const ips = ['127.0.0.1', '::ffff:127.0.0.1', '::1'];
  for (const scope of ['discount-quote', 'checkout', 'customer-register:ip', 'login:ip']) {
    for (const ip of ips) await resetRateLimit(scope, ip);
  }
  await resetRateLimit('login:id', EMAIL.toLowerCase());
  for (const label of ['a', 'b', 'c']) await resetRateLimit('customer-register:id', `${TAG}-${label}@example.test`);
}

/**
 * Removes every fixture this suite has ever left behind, including a run that
 * was interrupted — they all carry the `zz-disc-` prefix, whichever run made them.
 */
async function sweepFixtures(sql: <T = any>(text: string, params?: unknown[]) => Promise<T[]>): Promise<void> {
  const orders = await sql<{ id: string }>(`select id from orders where email like 'zz-disc-%'`);
  const ids = orders.map((row) => row.id);
  if (ids.length) {
    await sql(`update discount_customers set order_id = null where order_id = any($1::uuid[])`, [ids]);
    for (const table of ['discount_redemptions', 'payments', 'order_status_history', 'order_addresses', 'order_items']) {
      await sql(`delete from ${table} where order_id = any($1::uuid[])`, [ids]);
    }
    await sql(`delete from orders where id = any($1::uuid[])`, [ids]);
  }
  await sql(`delete from discounts where name like 'zz-disc-%' or code like 'ZZ%' and name like 'zz%'`);
  await sql(`delete from customers where email like 'zz-disc-%'`);
  await sql(`delete from products where name like 'zz-disc-%'`);
  await sql(`delete from categories where slug like 'zz-disc-%'`);
  await sql(`delete from brands where slug like 'zz-disc-%'`);
  await sql(`delete from payment_banks where name like 'zz-disc-%'`);
}

async function main(): Promise<void> {
  console.log(`\nDiscounts · ${SLUG} · ${BASE}\n`);
  await unthrottle();

  const pool = await openTenantPoolForSlug(SLUG);
  const sql = async <T = any>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await pool.query(text, params as never[])).rows as T[];

  await sweepFixtures(sql);

  const login = await admin('/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  if (login.status !== 200) throw new Error(`Admin sign-in failed (${login.status}): ${JSON.stringify(login.raw)}`);

  const discountIds: string[] = [];
  const orderIds: string[] = [];
  const customerEmails: string[] = [];
  let bankId = '';
  let productIds: string[] = [];
  let pausedForFilter: string[] = [];

  try {
    // ------------------------------------------------------------ fixtures --
    const [catA] = await sql<{ id: string }>(`insert into categories (name, slug) values ($1, $2) returning id`, [`${TAG} Phones`, `${TAG}-phones`]);
    const [catB] = await sql<{ id: string }>(`insert into categories (name, slug) values ($1, $2) returning id`, [`${TAG} Extras`, `${TAG}-extras`]);
    const [brandA] = await sql<{ id: string }>(`insert into brands (name, slug) values ($1, $2) returning id`, [`${TAG} Maker`, `${TAG}-maker`]);
    const [brandB] = await sql<{ id: string }>(`insert into brands (name, slug) values ($1, $2) returning id`, [`${TAG} Other`, `${TAG}-other`]);

    const makeProduct = async (name: string, body: Record<string, unknown>) => {
      const created = await admin<{ id: string; variants: { id: string }[] }>('/products', {
        method: 'POST',
        body: { name: `${TAG} ${name}`, status: 'active', stockQuantity: 500, ...body },
      });
      if (created.status !== 201) throw new Error(`Could not create ${name}: ${JSON.stringify(created.raw)}`);
      return { productId: created.body.id, variantId: created.body.variants[0]!.id };
    };
    const phone = await makeProduct('Phone', { price: '100.00', categoryId: catA!.id, brandId: brandA!.id });
    const casing = await makeProduct('Case', { price: '20.00', categoryId: catB!.id, brandId: brandB!.id });
    const cable = await makeProduct('Cable', { price: '10.00', salePrice: '8.00', categoryId: catB!.id, brandId: brandB!.id });
    productIds = [phone.productId, casing.productId, cable.productId];

    const line = (item: { productId: string; variantId: string }, quantity = 1) => ({ ...item, quantity });

    const create = async (body: Record<string, unknown>) => {
      const created = await admin('/discounts', {
        method: 'POST',
        body: { name: `${TAG} ${body.code ?? body.kind}`, status: 'active', ...body },
      });
      if (created.status === 201) discountIds.push(created.body.id);
      return created;
    };

    const quote = (lines: unknown[], codes: string[] = [], extra: Record<string, unknown> = {}, jar?: Jar) =>
      shop('/discounts/quote', { method: 'POST', body: { lines, codes, ...extra }, jar });

    const address = { fullName: 'Zz Discount', phone: '+8801711000000', addressLine1: 'House 1, Road 1', city: 'Dhaka', country: 'Bangladesh' };

    const register = async (label: string) => {
      const jar: Jar = { cookie: '' };
      const email = `${TAG}-${label}@example.test`;
      customerEmails.push(email);
      const result = await shop('/auth/register', {
        method: 'POST',
        jar,
        body: { fullName: `Zz ${label}`, email, password: 'ShopperPass2026', acceptsTerms: true },
      });
      if (result.status !== 201) throw new Error(`Could not register ${label}: ${JSON.stringify(result.raw)}`);
      return { jar, email, id: result.body.customer.id as string };
    };

    const checkout = async (jar: Jar, email: string, lines: unknown[], codes: string[], payment: Record<string, unknown> = { paymentProvider: 'cod' }) => {
      const placed = await shop<{ orderNumber: string }>('/checkout', {
        method: 'POST',
        jar,
        body: {
          email,
          phone: address.phone,
          lines,
          shippingAddress: address,
          couponCodes: codes,
          ...payment,
        },
      });
      let orderId = '';
      if (placed.status === 201) {
        const found = await admin<{ id: string; orderNumber: string }[]>(`/orders?search=${encodeURIComponent(placed.body.orderNumber)}&pageSize=5`);
        orderId = found.body.find((row) => row.orderNumber === placed.body.orderNumber)?.id ?? '';
        if (orderId) orderIds.push(orderId);
      }
      return { ...placed, orderId };
    };

    // --------------------------------------------------------- the panel ----
    console.log('\nThe panel refuses what cannot work');
    {
      const noCode = await admin('/discounts', { method: 'POST', body: { kind: 'coupon', name: 'zz', valueType: 'percentage', value: '10' } });
      check('a coupon without a code is refused per field', noCode.status === 422 && Boolean(noCode.raw?.details?.code), noCode.raw);

      const tooMuch = await admin('/discounts', { method: 'POST', body: { kind: 'coupon', code: CODE('PCT'), name: 'zz', valueType: 'percentage', value: '150' } });
      check('a percentage over 100 is refused', tooMuch.status === 422 && Boolean(tooMuch.raw?.details?.value), tooMuch.raw);

      const created = await create({ kind: 'coupon', code: CODE('DUP'), valueType: 'percentage', value: '10' });
      check('a plain coupon is created', created.status === 201, created.raw);
      const clash = await admin('/discounts', { method: 'POST', body: { kind: 'coupon', code: CODE('DUP').toLowerCase(), name: 'zz', valueType: 'percentage', value: '5' } });
      check('its code cannot be taken again, in any case', clash.status === 409 && clash.raw?.code === 'DISCOUNT_CODE_TAKEN', clash.raw);

      // A bank of the suite's own: the store's list is the owner's, and a check
      // that removes a bank must never remove one of theirs.
      const bank = await admin<{ id: string; name: string }>('/discounts/banks', {
        method: 'POST',
        body: { name: `${TAG} Bank`, shortName: 'ZZB', cardPrefixes: [] },
      });
      check('a bank can be added to the list', bank.status === 201, bank.raw);
      bankId = bank.body.id;

      const unverifiable = await admin('/discounts', {
        method: 'POST',
        body: { kind: 'bank_offer', code: CODE('BANKX'), name: 'zz', valueType: 'percentage', value: '10', paymentRules: { bankIds: [bankId] } },
      });
      check(
        'a bank offer naming a bank with no card prefixes is refused',
        unverifiable.status === 422 && unverifiable.raw?.code === 'DISCOUNT_BANK_UNVERIFIABLE',
        unverifiable.raw,
      );

      const saved = await admin(`/discounts/banks/${bankId}`, {
        method: 'PUT',
        body: { name: bank.body.name, cardPrefixes: [{ prefix: '999911', cardType: 'credit' }, { prefix: '999922', cardType: 'debit' }] },
      });
      check('a bank’s card prefixes can be saved', saved.status === 200 && saved.body.cardPrefixes.length === 2, saved.raw);
    }

    // --------------------------------------------------------- value types --
    console.log('\nWhat each kind of discount takes off');
    await unthrottle();
    {
      await create({
        kind: 'coupon',
        code: CODE('CAT'),
        valueType: 'percentage',
        value: '50',
        maxDiscountAmount: '30.00',
        productRules: { appliesTo: 'specific', categoryIds: [catA!.id] },
      });
      const scoped = await quote([line(phone), line(casing)], [CODE('CAT')]);
      check('a category coupon applies', scoped.body?.applied?.length === 1, scoped.raw);
      check('it is capped at its maximum', scoped.body?.itemDiscount === '30.00', scoped.body?.itemDiscount);
      check(
        'only the line in that category is discounted',
        scoped.body?.lines?.[0]?.discount === '30.00' && scoped.body?.lines?.[1]?.discount === '0.00',
        scoped.body?.lines,
      );
      const outside = await quote([line(casing)], [CODE('CAT')]);
      check(
        'a basket with nothing in scope is told so',
        outside.body?.refused?.[0]?.reason === 'nothing_eligible',
        outside.body?.refused,
      );

      await create({ kind: 'coupon', code: CODE('MIN'), valueType: 'fixed_amount', value: '15.00', minOrderAmount: '150.00' });
      const short = await quote([line(phone)], [CODE('MIN')]);
      check('a minimum order is explained in money', /Minimum order amount is \$150\./.test(short.body?.refused?.[0]?.message ?? ''), short.body?.refused);
      const enough = await quote([line(phone, 2)], [CODE('MIN')]);
      check('and clears once the basket does', enough.body?.itemDiscount === '15.00', enough.body);

      await create({ kind: 'coupon', code: CODE('QTY'), valueType: 'percentage', value: '10', minQuantity: 3 });
      const few = await quote([line(casing, 2)], [CODE('QTY')]);
      check('a minimum quantity says how many more', /Add 1 more eligible item/.test(few.body?.refused?.[0]?.message ?? ''), few.body?.refused);

      await create({ kind: 'coupon', code: CODE('REQ'), valueType: 'fixed_amount', value: '5.00', purchaseRules: { requiredProductIds: [phone.productId] } });
      const missing = await quote([line(casing)], [CODE('REQ')]);
      check('a required product is named', (missing.body?.refused?.[0]?.message ?? '').includes(`${TAG} Phone`), missing.body?.refused);

      await create({
        kind: 'coupon',
        code: CODE('NOSALE'),
        valueType: 'percentage',
        value: '50',
        productRules: { appliesTo: 'all', excludeSaleItems: true, excludeBrandIds: [brandA!.id] },
      });
      const excluded = await quote([line(phone), line(casing), line(cable)], [CODE('NOSALE')]);
      check(
        'sale items and an excluded brand are left alone',
        excluded.body?.lines?.map((entry: { discount: string }) => entry.discount).join(',') === '0.00,10.00,0.00',
        excluded.body?.lines,
      );

      await create({ kind: 'coupon', code: CODE('PRICE'), valueType: 'fixed_price', value: '12.00', productRules: { appliesTo: 'specific', productIds: [casing.productId] } });
      const fixed = await quote([line(casing, 2)], [CODE('PRICE')]);
      check('a fixed price takes each unit down to it', fixed.body?.itemDiscount === '16.00', fixed.body?.itemDiscount);

      await create({
        kind: 'coupon',
        code: CODE('B2G1'),
        valueType: 'buy_x_get_y',
        rewardRules: { buyQuantity: 2, getQuantity: 1, getDiscountPercent: 100, buyCategoryIds: [catB!.id] },
      });
      const bogo = await quote([line(casing, 2), line(cable, 1)], [CODE('B2G1')]);
      check('buy 2 get 1 gives the cheapest of the three free', bogo.body?.itemDiscount === '8.00', bogo.body);
      const twoOnly = await quote([line(casing, 2)], [CODE('B2G1')]);
      check('with two in the basket it asks for the third', twoOnly.body?.refused?.[0]?.reason === 'reward_missing', twoOnly.body?.refused);

      await create({
        kind: 'coupon',
        code: CODE('BUYGET'),
        valueType: 'buy_x_get_y',
        rewardRules: { buyQuantity: 1, buyProductIds: [phone.productId], getQuantity: 1, getProductIds: [casing.productId], getDiscountPercent: 50 },
      });
      const across = await quote([line(phone), line(casing, 2)], [CODE('BUYGET')]);
      check('buy a phone, get one case at half price', across.body?.itemDiscount === '10.00', across.body);
      const noReward = await quote([line(phone)], [CODE('BUYGET')]);
      check('without the case it says to add it', (noReward.body?.refused?.[0]?.message ?? '').includes(`${TAG} Case`), noReward.body?.refused);

      await create({ kind: 'coupon', code: CODE('BUNDLE'), valueType: 'bundle', value: '110.00', productRules: { appliesTo: 'specific', productIds: [phone.productId, casing.productId] } });
      const bundle = await quote([line(phone), line(casing)], [CODE('BUNDLE')]);
      check('a bundle is sold for its bundle price', bundle.body?.itemDiscount === '10.00', bundle.body);
      check(
        'and its saving is shared across both lines to the cent',
        bundle.body?.lines?.map((entry: { discount: string }) => entry.discount).join(',') === '8.33,1.67',
        bundle.body?.lines,
      );

      const freeShipping = await create({ kind: 'coupon', code: CODE('SHIP'), valueType: 'free_shipping' });
      check('free delivery is no longer a discount type', freeShipping.status === 422, freeShipping.raw);
    }

    // ------------------------------------------------ automatic & combining --
    console.log('\nAutomatic discounts, the strategy and combining');
    await unthrottle();
    {
      const autoA = await create({
        kind: 'automatic',
        name: `${TAG} auto 10`,
        valueType: 'percentage',
        value: '10',
        productRules: { appliesTo: 'specific', categoryIds: [catA!.id] },
        priority: 2,
      });
      const autoB = await create({
        kind: 'automatic',
        name: `${TAG} auto 5`,
        valueType: 'fixed_amount',
        value: '5.00',
        productRules: { appliesTo: 'specific', categoryIds: [catA!.id] },
        priority: 1,
        combinationRules: { mode: 'all' },
      });
      check('automatic discounts are saved with no code', autoA.status === 201 && autoA.body.code === null, autoA.raw);

      await admin('/discounts/settings', { method: 'PUT', body: { strategy: 'best' } });
      const best = await quote([line(phone)]);
      check('“best” applies the one worth most, without a code', best.body?.applied?.length === 1 && best.body?.itemDiscount === '10.00', best.body?.applied);
      check('and says it was applied automatically', /\$10 discount automatically applied\./.test(best.body?.applied?.[0]?.message ?? ''), best.body?.applied);

      await admin('/discounts/settings', { method: 'PUT', body: { strategy: 'priority' } });
      const priority = await quote([line(phone)]);
      check('“priority” applies the lowest priority number', priority.body?.itemDiscount === '5.00', priority.body?.applied);

      await admin(`/discounts/${autoA.body.id}`, {
        method: 'PUT',
        body: { kind: 'automatic', name: `${TAG} auto 10`, valueType: 'percentage', value: '10', productRules: { appliesTo: 'specific', categoryIds: [catA!.id] }, priority: 2, combinationRules: { mode: 'selected', with: ['automatic'] } },
      });
      await admin('/discounts/settings', { method: 'PUT', body: { strategy: 'stack' } });
      const stacked = await quote([line(phone)]);
      check(
        '“stack” applies both, each on what the other left',
        stacked.body?.applied?.length === 2 && stacked.body?.itemDiscount === '14.50',
        stacked.body?.applied,
      );

      const refusedCode = await quote([line(phone)], [CODE('MIN')]);
      check(
        'a code that does not apply leaves the automatic discounts in place',
        refusedCode.body?.refused?.[0]?.reason === 'minimum_not_met' && refusedCode.body?.itemDiscount === '14.50',
        refusedCode.body,
      );
      const chosen = await quote([line(phone, 2)], [CODE('MIN')]);
      check(
        'a code that combines with nothing is the shopper’s choice over them',
        chosen.body?.applied?.length === 1 && chosen.body?.applied?.[0]?.code === CODE('MIN') && chosen.body?.itemDiscount === '15.00',
        chosen.body?.applied,
      );

      const both = await quote([line(phone, 2)], [CODE('MIN'), CODE('SHIP')]);
      check('two codes that do not combine: the second is refused by name', (both.body?.refused?.[0]?.message ?? '').includes(`cannot be combined with ${CODE('MIN')}`), both.body?.refused);

      await admin(`/discounts/${autoA.body.id}/status`, { method: 'PATCH', body: { status: 'paused' } });
      await admin(`/discounts/${autoB.body.id}/status`, { method: 'PATCH', body: { status: 'paused' } });
      const paused = await quote([line(phone)]);
      check('a paused automatic discount stops applying', paused.body?.applied?.length === 0, paused.body?.applied);
      await admin('/discounts/settings', { method: 'PUT', body: { strategy: 'best' } });
    }

    // ------------------------------------------------------------- the clock --
    console.log('\nThe clock');
    await unthrottle();
    {
      const pad = (value: number) => String(value).padStart(2, '0');
      const inDays = (days: number) => {
        const at = new Date(Date.now() + days * 86_400_000);
        return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}T00:00`;
      };
      await create({ kind: 'coupon', code: CODE('SOON'), valueType: 'percentage', value: '10', startsAt: inDays(3), timezone: 'UTC' });
      const soon = await quote([line(casing)], [CODE('SOON')]);
      check('a scheduled code says when it starts', soon.body?.refused?.[0]?.reason === 'not_started' && /starts on/.test(soon.body?.refused?.[0]?.message), soon.body?.refused);

      await create({ kind: 'coupon', code: CODE('OLD'), valueType: 'percentage', value: '10', startsAt: inDays(-5), endsAt: inDays(-1), timezone: 'UTC' });
      const old = await quote([line(casing)], [CODE('OLD')]);
      check('an ended code has expired', old.body?.refused?.[0]?.message === 'This coupon has expired.', old.body?.refused);

      const listed = await admin<{ code: string; state: string }[]>(`/discounts?status=scheduled&search=${CODE('SOON')}`);
      check('the list reads “scheduled” off the clock', listed.body?.[0]?.state === 'scheduled', listed.body);

      const today = new Date().getUTCDay();
      await create({ kind: 'coupon', code: CODE('DAY'), valueType: 'percentage', value: '10', timezone: 'UTC', scheduleRules: { days: [(today + 2) % 7] } });
      const day = await quote([line(casing)], [CODE('DAY')]);
      check('a day restriction names the day', day.body?.refused?.[0]?.reason === 'wrong_day' && /only available on/.test(day.body?.refused?.[0]?.message), day.body?.refused);

      const hour = new Date().getUTCHours();
      const window = { startTime: `${pad((hour + 3) % 24)}:00`, endTime: `${pad((hour + 4) % 24)}:00` };
      await create({ kind: 'coupon', code: CODE('HOUR'), valueType: 'percentage', value: '10', timezone: 'UTC', scheduleRules: window });
      const late = await quote([line(casing)], [CODE('HOUR')]);
      check('a time window says when it opens', late.body?.refused?.[0]?.reason === 'wrong_time', late.body?.refused);
    }

    // ---------------------------------------------------------- customers --
    console.log('\nCustomers, payment and vouchers');
    await unthrottle();
    const shopperA = await register('a');
    const shopperB = await register('b');
    {
      await create({ kind: 'coupon', code: CODE('FIRST'), valueType: 'percentage', value: '10', customerRules: { segment: 'new' } });
      const guest = await quote([line(casing)], [CODE('FIRST')]);
      check('a first-order code asks a guest to sign in', guest.body?.refused?.[0]?.message === 'Sign in to use this coupon.', guest.body?.refused);
      const first = await quote([line(casing)], [CODE('FIRST')], {}, shopperA.jar);
      check('and applies to a shopper with no orders', first.body?.applied?.length === 1, first.body);

      await create({ kind: 'payment_offer', code: CODE('BKASH'), valueType: 'fixed_amount', value: '3.00', paymentRules: { channels: ['bkash'] } });
      const basket = await quote([line(casing)], [CODE('BKASH')], {}, shopperA.jar);
      check(
        'a bKash offer in the basket is kept, waiting for payment',
        basket.body?.refused?.[0]?.reason === 'payment_required' && basket.body?.refused?.[0]?.retainable === true,
        basket.body?.refused,
      );
      const withCard = await quote([line(casing)], [CODE('BKASH')], { paymentProvider: 'mock', paymentChannel: 'card' }, shopperA.jar);
      check('paying by card does not qualify', withCard.body?.refused?.[0]?.reason === 'payment_method', withCard.body?.refused);
      const withBkash = await quote([line(casing)], [CODE('BKASH')], { paymentProvider: 'mock', paymentChannel: 'bkash' }, shopperA.jar);
      check('paying by bKash does', withBkash.body?.itemDiscount === '3.00', withBkash.body);

      await create({ kind: 'bank_offer', code: CODE('IBBL'), valueType: 'percentage', value: '15', paymentRules: { bankIds: [bankId], cardTypes: ['credit'] } });
      const noBin = await quote([line(phone)], [CODE('IBBL')], { paymentProvider: 'mock', paymentChannel: 'card' }, shopperA.jar);
      check('a bank offer asks for the card’s first digits', noBin.body?.refused?.[0]?.reason === 'card_required', noBin.body?.refused);
      const debit = await quote([line(phone)], [CODE('IBBL')], { paymentProvider: 'mock', paymentChannel: 'card', cardBin: '999922' }, shopperA.jar);
      check('a debit card of that bank is refused for a credit-card offer', /available only with eligible .* credit cards\./.test(debit.body?.refused?.[0]?.message ?? ''), debit.body?.refused);
      const credit = await quote([line(phone)], [CODE('IBBL')], { paymentProvider: 'mock', paymentChannel: 'card', cardBin: '99991134' }, shopperA.jar);
      check('its credit card qualifies', credit.body?.itemDiscount === '15.00', credit.body);

      const wrongPay = await checkout(shopperA.jar, shopperA.email, [line(phone)], [CODE('IBBL')], { paymentProvider: 'cod' });
      check('checkout refuses a bank offer on cash on delivery, in words', wrongPay.status === 422 && wrongPay.raw?.code === 'DISCOUNT_NOT_APPLICABLE', wrongPay.raw);

      // A real order: the bank offer, on a card, with delivery.
      const order = await checkout(shopperA.jar, shopperA.email, [line(phone, 2)], [CODE('IBBL')], {
        paymentProvider: 'mock',
        paymentChannel: 'card',
        cardBin: '999911',
      });
      check('an order with a bank offer is placed', order.status === 201 && Boolean(order.orderId), order.raw);
      if (order.orderId) {
        const detail = await admin(`/orders/${order.orderId}`);
        check('its discount total is the offer’s', detail.body.discountTotal === '30.00', detail.body.discountTotal);
        check('each line carries its share', detail.body.lines?.[0]?.lineDiscount === '30.00', detail.body.lines?.[0]);
        check('the channel and card prefix are kept for the gateway', detail.body.paymentChannel === 'card' && detail.body.cardBin === '999911', detail.body);
        check('the order lists the discount it used', detail.body.discounts?.[0]?.code === CODE('IBBL'), detail.body.discounts);
        const [ledger] = await sql(`select original_amount, discount_amount, final_amount from discount_redemptions where order_id = $1`, [order.orderId]);
        check(
          'the ledger records the order either side of it',
          ledger && Number(ledger.original_amount) - Number(ledger.discount_amount) === Number(ledger.final_amount),
          ledger,
        );

        const again = await quote([line(casing)], [CODE('FIRST')], {}, shopperA.jar);
        check('after an order, the first-order code is refused', again.body?.refused?.[0]?.message === 'This coupon is available for first orders only.', again.body?.refused);

        await cancel(order.orderId);
        const freed = await quote([line(casing)], [CODE('FIRST')], {}, shopperA.jar);
        check('a cancelled order does not count as a first order', freed.body?.applied?.length === 1, freed.body);
      }

      // Per-customer limit, cooldown and usage limit.
      await unthrottle();
      await create({ kind: 'coupon', code: CODE('ONCE'), valueType: 'fixed_amount', value: '2.00', perCustomerLimit: 1 });
      await create({ kind: 'coupon', code: CODE('COOL'), valueType: 'fixed_amount', value: '2.00', cooldownAmount: 30, cooldownUnit: 'day', combinationRules: { mode: 'all' } });
      await create({ kind: 'coupon', code: CODE('LAST'), valueType: 'fixed_amount', value: '1.00', usageLimit: 1, combinationRules: { mode: 'all' } });

      const once = await checkout(shopperB.jar, shopperB.email, [line(casing)], [CODE('ONCE')]);
      check('a once-per-customer code is used', once.status === 201, once.raw);
      const twice = await quote([line(casing)], [CODE('ONCE')], {}, shopperB.jar);
      check('and refused the second time', twice.body?.refused?.[0]?.message === 'You have already used this coupon.', twice.body?.refused);
      if (once.orderId) await cancel(once.orderId);
      const handedBack = await quote([line(casing)], [CODE('ONCE')], {}, shopperB.jar);
      check('cancelling the order hands the use back', handedBack.body?.applied?.length === 1, handedBack.body);

      const cooled = await checkout(shopperB.jar, shopperB.email, [line(casing)], [CODE('COOL'), CODE('LAST')]);
      check('two combinable codes go on one order', cooled.status === 201, cooled.raw);
      const cooling = await quote([line(casing)], [CODE('COOL')], {}, shopperB.jar);
      check('a cooldown says when it can be used again', /can be used again after/.test(cooling.body?.refused?.[0]?.message ?? ''), cooling.body?.refused);
      const claimed = await quote([line(casing)], [CODE('LAST')], {}, shopperA.jar);
      check('a code at its usage limit is fully claimed for everybody', claimed.body?.refused?.[0]?.reason === 'usage_limit', claimed.body?.refused);
      const counted = await sql<{ used_count: number }>(`select used_count from discounts where upper(code) = $1`, [CODE('LAST')]);
      check('the counter moved exactly once', counted[0]?.used_count === 1, counted);

      // Vouchers.
      await unthrottle();
      const voucher = await create({ kind: 'voucher', name: `${TAG} voucher`, valueType: 'fixed_amount', value: '4.00', customerIds: [shopperA.id], perCustomerLimit: null });
      check('a voucher gets a code of its own', voucher.status === 201 && /^V-/.test(voucher.body.code ?? ''), voucher.raw);
      const code = voucher.body.code as string;
      const notMine = await quote([line(casing)], [code], {}, shopperB.jar);
      check('somebody else’s voucher is refused', notMine.body?.refused?.[0]?.message === 'This voucher is not in your account.', notMine.body?.refused);
      const wallet = await shop<{ code: string; state: string }[]>('/account/vouchers', { jar: shopperA.jar });
      check('the holder sees it in their account', wallet.body?.some((entry) => entry.code === code && entry.state === 'available'), wallet.body);
      const spent = await checkout(shopperA.jar, shopperA.email, [line(casing)], [code]);
      check('the holder can spend it', spent.status === 201, spent.raw);
      const spentAgain = await quote([line(casing)], [code], {}, shopperA.jar);
      check('a spent voucher says so', spentAgain.body?.refused?.[0]?.message === 'This voucher has already been used.', spentAgain.body?.refused);
      if (spent.orderId) await cancel(spent.orderId);
      const returned = await shop<{ code: string; state: string }[]>('/account/vouchers', { jar: shopperA.jar });
      check('cancelling the order puts the voucher back', returned.body?.some((entry) => entry.code === code && entry.state === 'available'), returned.body);
    }

    // ------------------------------------------------------------- rewards --
    console.log('\nVouchers that issue themselves');
    await unthrottle();
    {
      await create({ kind: 'voucher', name: `${TAG} welcome`, valueType: 'fixed_amount', value: '5.00', issueRules: { event: 'registration', validDays: 30 } });
      await create({ kind: 'voucher', name: `${TAG} birthday`, valueType: 'percentage', value: '20', issueRules: { event: 'birthday' }, customerRules: { birthdayWindowDays: 3 } });

      const newcomer = await register('c');
      const welcome = await shop<{ label: string; expiresAt: string | null }[]>('/account/vouchers', { jar: newcomer.jar });
      check(
        'signing up issues the welcome voucher, with its own expiry',
        welcome.body?.some((entry) => entry.label === '$5 off' && entry.expiresAt !== null),
        welcome.body,
      );

      const today = new Date();
      const birthday = `1990-${String(today.getUTCMonth() + 1).padStart(2, '0')}-${String(today.getUTCDate()).padStart(2, '0')}`;
      const profile = await shop('/account/me', { method: 'PUT', jar: newcomer.jar, body: { birthDate: birthday } });
      check('a customer can save their birthday', profile.body?.birthDate === birthday, profile.raw);
      const party = await shop<{ label: string }[]>('/account/vouchers', { jar: newcomer.jar });
      check('the birthday voucher arrives on their next visit', party.body?.some((entry) => entry.label === '20% off'), party.body);
      const partyAgain = await shop<{ label: string }[]>('/account/vouchers', { jar: newcomer.jar });
      check('and only once per birthday', partyAgain.body?.filter((entry) => entry.label === '20% off').length === 1, partyAgain.body);
    }

    // ---------------------------------------------------------- the panel --
    console.log('\nThe panel’s reads and writes');
    await unthrottle();
    {
      const summary = await admin('/discounts/summary');
      check('the summary counts scheduled and expired discounts', summary.body.scheduled >= 1 && summary.body.expired >= 1, summary.body);

      const bankList = await admin<{ id: string }[]>(`/discounts?payment=bank&search=${CODE('IBBL')}`);
      check('the list filters to bank offers', bankList.body?.length === 1, bankList.body);

      const [row] = await sql<{ id: string }>(`select id from discounts where upper(code) = $1`, [CODE('IBBL')]);
      const detail = await admin(`/discounts/${row!.id}`);
      check('a discount’s detail names its bank', Object.values(detail.body.labels ?? {}).some((entry: any) => entry.label === `${TAG} Bank`), detail.body.labels);

      const bankInUse = await admin(`/discounts/banks/${bankId}`, { method: 'DELETE' });
      check('a bank a live offer names cannot be removed', bankInUse.status === 409 && bankInUse.raw?.code === 'BANK_IN_USE', bankInUse.raw);
      check('and carries its analytics', detail.body.analytics?.voidedUses === 1 && detail.body.redemptions?.length === 1, detail.body.analytics);

      const copy = await admin(`/discounts/${row!.id}/duplicate`, { method: 'POST' });
      if (copy.status === 201) discountIds.push(copy.body.id);
      check('duplicating makes a draft copy with its own code', copy.status === 201 && copy.body.status === 'draft' && copy.body.code === `${CODE('IBBL')}-COPY`, copy.raw);

      const usedDelete = await admin(`/discounts/${row!.id}`, { method: 'DELETE' });
      check('deleting a used discount archives it', usedDelete.status === 200 && usedDelete.body.archived === true, usedDelete.raw);
      const gone = await quote([line(phone)], [CODE('IBBL')], { paymentProvider: 'mock', paymentChannel: 'card', cardBin: '999911' }, shopperA.jar);
      check('and its code stops working', gone.body?.refused?.[0]?.reason === 'unknown', gone.body?.refused);
      const reuse = await admin('/discounts', { method: 'POST', body: { kind: 'coupon', code: CODE('IBBL'), name: 'zz', valueType: 'percentage', value: '5' } });
      check('while staying reserved', reuse.status === 409, reuse.raw);

      const unusedDelete = await admin(`/discounts/${copy.body.id}`, { method: 'DELETE' });
      check('an unused discount is deleted outright', unusedDelete.status === 204, unusedDelete.status);

      const bankFree = await admin(`/discounts/banks/${bankId}`, { method: 'DELETE' });
      check('once the offer is archived, the bank can be removed', bankFree.status === 204, bankFree.raw);
    }

    // ---------------------------------------------------------- the filter --
    console.log('\nThe storefront’s “Coupon Available” filter');
    await unthrottle();
    {
      // Only the category coupon may be live for this, so the store's own codes
      // are paused for the moment and put back exactly as they were.
      pausedForFilter = (
        await sql<{ id: string }>(
          `update discounts set status = 'paused' where status = 'active' and code is not null and upper(code) <> $1 returning id`,
          [CODE('CAT')],
        )
      ).map((row) => row.id);
      const listing = await shop<{ items: { id: string }[] }>(`/products?offer=coupon&search=${encodeURIComponent(TAG)}&pageSize=10`);
      const ids = listing.body?.items?.map((entry) => entry.id) ?? [];
      check('a category coupon marks that category’s product', ids.includes(phone.productId), ids);
      check('and not a product outside it', !ids.includes(casing.productId), ids);
    }
  } finally {
    if (!KEEP) {
      console.log('\nCleaning up');
      if (pausedForFilter.length) {
        await sql(`update discounts set status = 'active' where id = any($1::uuid[])`, [pausedForFilter]);
      }
      await sql(`update store_settings set preferences = jsonb_set(coalesce(preferences, '{}'::jsonb), '{discountStrategy}', '"best"')`);
      for (const orderId of orderIds) await cancel(orderId).catch(() => undefined);
      await sweepFixtures(sql);
    }
    await pool.end();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

await main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
await closeRedis().catch(() => undefined);

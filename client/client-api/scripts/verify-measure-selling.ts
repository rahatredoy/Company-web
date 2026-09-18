/**
 * Selling by weight or volume, end to end.
 *
 * The feature's whole risk is arithmetic that disagrees with itself: a price
 * shown on a card, a different one charged at the till, and a third amount taken
 * off the shelf. So this creates a real product priced per kilo, reads it back
 * through the storefront the way a card does, buys some of it, and asserts that
 * the three numbers are the same three numbers — including the one nobody sees,
 * which is how much stock moved.
 *
 * It also asserts the refusals, because a measure that is merely *accepted* is
 * how a shop ends up selling 3kg of something at the 300g price: a size that is
 * not on the product's list, and a basket under the shop's minimum, both have to
 * be rejected rather than adjusted.
 *
 * It **creates and deletes its own fixtures**, so it is safe to run against
 * `e-comarch` — but it does place a real order, which cannot be deleted, so the
 * order it leaves behind is cancelled rather than removed.
 *
 * Usage:
 *   npx tsx scripts/verify-measure-selling.ts --password '…'
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
const KEEP = args.includes('--keep');

if (!PASSWORD) {
  console.error("Pass the store admin password: --password '…'");
  process.exit(1);
}

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

let cookie = '';

async function call<T>(
  path: string,
  init: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${BASE}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'X-Store-Slug': SLUG,
      Accept: 'application/json',
      ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(init.auth === false ? {} : cookie ? { cookie } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = text;
  }
  const envelope = payload as { data?: T } | null;
  return { status: response.status, body: (envelope && 'data' in envelope ? envelope.data : payload) as T };
}

async function signIn(): Promise<void> {
  const response = await fetch(`${BASE}/api/v1/admin/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Store-Slug': SLUG },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  if (!response.ok) throw new Error(`Sign-in failed (${response.status}): ${await response.text()}`);

  cookie = (response.headers.getSetCookie?.() ?? []).map((entry) => entry.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Sign-in returned no session cookie.');
}

const stamp = process.pid.toString(36);

interface MeasureBlock {
  unit: string;
  pricingMeasure: number;
  pricingLabel: string;
  minMeasure: number | null;
  options: { label: string; measure: number }[];
}

/** The storefront's own view of a product, which is what a card renders from. */
async function storefrontProduct(slug: string) {
  return call<{
    price: string;
    inStock: boolean;
    measure: MeasureBlock | null;
    defaultVariantId: string | null;
  }>(`/api/v1/storefront/products/${slug}`, { auth: false });
}

const OPENING_STOCK = 40_000; // 40kg of it, in grams.

async function main(): Promise<void> {
  console.log(`\nMeasure selling · ${SLUG} · ${BASE}\n`);
  await signIn();
  console.log(`Signed in as ${EMAIL}\n`);

  let productId = '';
  let variantId = '';
  let orderId = '';
  const productSlug = `zz-measure-${stamp}`;

  try {
    // ------------------------------------------------------- the product ----
    console.log('A product priced per kilo');

    const created = await call<{ id: string; slug: string; variants: { id: string }[] }>(
      '/api/v1/admin/products',
      {
        method: 'POST',
        body: {
          name: `zz measure ${stamp}`,
          slug: productSlug,
          sku: `ZZ-MEASURE-${stamp.toUpperCase()}`,
          // 40 per kilo, which is what every figure below is derived from.
          price: '40.00',
          status: 'active',
          stockQuantity: OPENING_STOCK,
          sellBy: 'measure',
          measureUnit: 'g',
          pricingMeasure: 1000,
          minMeasure: 350,
          measureOptions: [
            { label: '1kg', measure: 1000 },
            { label: '500gm', measure: 500 },
            { label: '250gm', measure: 250 },
            { label: '100gm', measure: 100 },
          ],
        },
      },
    );

    check('a product can be created sold by measure', created.status === 201, `got ${created.status}`);
    if (created.status !== 201) return;

    productId = created.body.id;
    variantId = created.body.variants[0]!.id;

    const stored = await call<Record<string, unknown>>(`/api/v1/admin/products/${productId}`);
    check('the mode saved', stored.body.sellBy === 'measure', String(stored.body.sellBy));
    check('the base unit saved', stored.body.measureUnit === 'g', String(stored.body.measureUnit));
    check('the pricing measure saved', stored.body.pricingMeasure === 1000, String(stored.body.pricingMeasure));
    check('the minimum saved', stored.body.minMeasure === 350, String(stored.body.minMeasure));
    check(
      'the size list saved, biggest first',
      Array.isArray(stored.body.measureOptions) &&
        (stored.body.measureOptions as { measure: number }[]).map((o) => o.measure).join(',') ===
          '1000,500,250,100',
      JSON.stringify(stored.body.measureOptions),
    );

    // ---------------------------------------------------- what a card sees ---
    console.log('\nWhat the storefront card is given');

    const shopped = await storefrontProduct(productSlug);
    check('the storefront serves it', shopped.status === 200, `got ${shopped.status}`);
    check('it carries a measure block', shopped.body.measure !== null);
    check('the rate is the stored price', shopped.body.price === '40.00', shopped.body.price);
    check(
      'the card can print a rate label',
      typeof shopped.body.measure?.pricingLabel === 'string' && shopped.body.measure.pricingLabel.length > 0,
      shopped.body.measure?.pricingLabel,
    );
    check('the floor reaches the card', shopped.body.measure?.minMeasure === 350, String(shopped.body.measure?.minMeasure));
    check(
      'every size the panel set is offered',
      shopped.body.measure?.options.map((option) => option.measure).join(',') === '1000,500,250,100',
      JSON.stringify(shopped.body.measure?.options),
    );

    // ------------------------------------------------------- the refusals ----
    console.log('\nWhat checkout refuses');

    const buy = (lines: { quantity: number; measure?: number }[]) =>
      call<{ orderNumber?: string; message?: string }>('/api/v1/storefront/checkout', {
        method: 'POST',
        auth: false,
        body: {
          email: `zz-measure-${stamp}@example.test`,
          phone: '01700000000',
          lines: lines.map((line) => ({ productId, variantId, ...line })),
          shippingAddress: {
            fullName: 'Measure Test',
            phone: '01700000000',
            addressLine1: 'House 61, Road 1',
            city: 'Dhaka',
            country: 'Bangladesh',
          },
          paymentProvider: 'cod',
        },
      });

    const unknownSize = await buy([{ quantity: 1, measure: 750 }]);
    check(
      'a size that is not on the list is refused',
      unknownSize.status === 422,
      `got ${unknownSize.status}`,
    );

    const belowFloor = await buy([{ quantity: 1, measure: 100 }]);
    check(
      'a basket under the shop’s minimum is refused',
      belowFloor.status === 422,
      `got ${belowFloor.status}`,
    );

    const clearsFloor = await buy([{ quantity: 4, measure: 100 }]);
    check(
      'four of the same size clears the minimum',
      clearsFloor.status === 200 || clearsFloor.status === 201,
      `got ${clearsFloor.status}: ${JSON.stringify(clearsFloor.body)}`,
    );

    /*
     * Checkout answers with the order *number*, not its id — a customer-facing
     * handle rather than a database one — so the admin list is what turns it
     * into the row this script then reads.
     */
    const placedNumber = clearsFloor.body?.orderNumber ?? '';
    if (placedNumber) {
      const found = await call<{ id: string; orderNumber: string }[]>(
        `/api/v1/admin/orders?search=${encodeURIComponent(placedNumber)}&pageSize=5`,
      );
      orderId = found.body?.find((row) => row.orderNumber === placedNumber)?.id ?? '';
      check('the placed order can be found in the panel', Boolean(orderId), placedNumber);
    }

    // ------------------------------------------------------- the arithmetic --
    console.log('\nWhat it charges, and what it takes off the shelf');

    const order = await call<{
      lines: { quantity: number; measureLabel: string | null; measure: number | null; unitPrice: string; lineTotal: string }[];
      subtotal: string;
    }>(`/api/v1/admin/orders/${orderId}`);

    const line = order.body.lines?.[0];
    check('the order recorded the size', line?.measure === 100, String(line?.measure));
    check('the order recorded its label', line?.measureLabel === '100gm', String(line?.measureLabel));
    check('the quantity is the count of sizes', line?.quantity === 4, String(line?.quantity));

    /*
     * 40 per kilo, so 100g is 4.00 and four of them is 16.00 — and the unit
     * price stored is the price of one 100g lot, never the kilo rate. Getting
     * this wrong by storing the rate would show a 40.00 unit price against a
     * 16.00 line, which is the discrepancy a customer photographs.
     */
    check('one size is priced from the rate', line?.unitPrice === '4.00', line?.unitPrice);
    check('the line total is the size times the count', line?.lineTotal === '16.00', line?.lineTotal);

    // The inventory list is searched by SKU, which is the handle it offers —
    // there is no per-variant filter on it, by design.
    const level = await call<{ available: number; sku: string | null }[]>(
      `/api/v1/admin/inventory?search=${encodeURIComponent(`ZZ-MEASURE-${stamp.toUpperCase()}`)}&pageSize=5`,
    );
    const available = level.body?.[0]?.available;

    /*
     * The number nobody sees and the one that matters: four hundred grams left
     * the shelf, not four. Reserving the quantity instead would have taken four
     * grams and let the shop sell the same pumpkin a hundred times over.
     */
    check(
      'stock moved by the measure, not the count',
      available === OPENING_STOCK - 400,
      `available ${available}, expected ${OPENING_STOCK - 400}`,
    );

    // --------------------------------------------------- switching it off ----
    console.log('\nSwitching the mode off');

    const off = await call(`/api/v1/admin/products/${productId}`, {
      method: 'PATCH',
      body: { sellBy: 'unit' },
    });
    check('the mode can be switched off', off.status === 200, `got ${off.status}`);

    const plain = await call<Record<string, unknown>>(`/api/v1/admin/products/${productId}`);
    check('the rate is cleared with it', plain.body.pricingMeasure === null, String(plain.body.pricingMeasure));
    check('the floor is cleared with it', plain.body.minMeasure === null, String(plain.body.minMeasure));
    check('the size list is cleared with it', plain.body.measureOptions === null, JSON.stringify(plain.body.measureOptions));

    const plainShop = await storefrontProduct(productSlug);
    check('the card stops showing a picker', plainShop.body.measure === null, JSON.stringify(plainShop.body.measure));
  } finally {
    if (!KEEP) {
      console.log('\nCleaning up');
      if (orderId) {
        // An order cannot be deleted — it is somebody's history — so the fixture
        // is cancelled, which is also what puts the reserved stock back.
        const cancelled = await call(`/api/v1/admin/orders/${orderId}/status`, {
          method: 'PATCH',
          body: { status: 'cancelled', note: 'verify-measure-selling fixture' },
        });
        console.log(`  order cancelled (${cancelled.status})`);
      }
      if (productId) {
        const removed = await call(`/api/v1/admin/products/${productId}`, { method: 'DELETE' });
        console.log(`  product removed (${removed.status})`);
      }
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

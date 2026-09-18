/**
 * Keyset pagination, checked against the live API.
 *
 * The claim under test is not "a cursor returns rows" — it is that walking a
 * list by cursor visits **every row exactly once**, in the same order a single
 * large read would give. That is the property offset paging quietly did not
 * have here: every one of these lists was ordered by a column with ties and no
 * tiebreaker, so a row on a page boundary could arrive twice and its neighbour
 * never. The comparison below is what makes the difference visible.
 *
 *   npx tsx scripts/verify-cursor-pagination.ts --password '…'
 *
 * Reads only. Safe against `e-comarch`; needs client-api on 4100.
 */
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const arg = (name: string, fallback?: string): string | undefined => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const BASE = arg('base', 'http://localhost:4100')!;
const SLUG = arg('slug', process.env.DEV_STORE_SLUG ?? 'e-comarch')!;
const EMAIL = arg('email', 'redoyahmed198@gmail.com')!;
const PASSWORD = arg('password', 'Secret@2026')!;
const ADMIN_ORIGIN = arg('origin', 'http://localhost:3002')!;
/** Small on purpose: a tiny batch crosses many more boundaries per row read. */
const BATCH = Number(arg('batch', '3'));
/**
 * How far the walk goes on a list too large to walk whole. The interesting part
 * of a keyset is the boundaries, and six hundred rows in batches of three is two
 * hundred of them — a demo store's ten thousand reviews would only add more of
 * the same at the cost of ten thousand requests.
 */
const WALK_BUDGET = Number(arg('budget', '600'));

let cookie = '';
let passed = 0;
let failed = 0;

function check(ok: boolean, label: string, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  [32m✓[0m ${label}`);
  } else {
    failed += 1;
    console.log(`  [31m✗[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

interface Listed {
  data: { id: string }[];
  meta: { pageSize: number; nextCursor: string | null; hasMore: boolean; total?: number };
}

async function call(path: string, query: Record<string, string | number | undefined> = {}) {
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  }

  const response = await fetch(url, {
    headers: { 'X-Store-Slug': SLUG, Accept: 'application/json', ...(cookie ? { cookie } : {}) },
  });

  const body = (await response.json().catch(() => null)) as (Listed & { code?: string; message?: string }) | null;
  return { status: response.status, body, response };
}

async function signIn() {
  const response = await fetch(new URL('/api/v1/admin/auth/login', BASE), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Store-Slug': SLUG,
      // The admin panel's own origin. The CSRF hook checks it on every write,
      // sign-in included, and `localhost:4100` is the API's own origin rather
      // than a surface the panel is ever served from.
      Origin: ADMIN_ORIGIN,
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });

  const raw = response.headers.getSetCookie?.() ?? [];
  cookie = raw.map((value) => value.split(';')[0]).join('; ');

  if (!response.ok || !cookie) {
    const body = await response.text();
    throw new Error(`Sign-in failed (${response.status}): ${body.slice(0, 200)}`);
  }
}

/** Every row, followed by cursor from the start. Returns the ids in order. */
async function walkByCursor(path: string, query: Record<string, string | number | undefined>) {
  const ids: string[] = [];
  let cursor: string | undefined;
  let batches = 0;
  let firstTotal: number | undefined;

  while (ids.length < WALK_BUDGET) {
    const { status, body } = await call(path, { ...query, pageSize: BATCH, cursor });
    if (status !== 200 || !body) throw new Error(`${path} answered ${status}`);

    if (batches === 0) firstTotal = body.meta.total;
    ids.push(...body.data.map((row) => row.id));
    batches += 1;

    if (!body.meta.hasMore || !body.meta.nextCursor) return { ids, batches, firstTotal, done: true };
    cursor = body.meta.nextCursor;
  }

  return { ids, batches, firstTotal, done: false };
}

/** The same list in one read, which is the order the cursor walk must reproduce. */
async function readWhole(path: string, query: Record<string, string | number | undefined>) {
  const { status, body } = await call(path, { ...query, pageSize: 100 });
  if (status !== 200 || !body) throw new Error(`${path} answered ${status}`);
  return body;
}

async function verifyList(label: string, path: string, query: Record<string, string | number | undefined> = {}) {
  console.log(`\n${label}`);

  const whole = await readWhole(path, query);
  const total = whole.meta.total;

  check(total !== undefined, 'counts the list on an uncursored read', 'meta.total was absent');

  if ((total ?? 0) === 0) {
    console.log('  · empty list — the walk has nothing to prove here');
    return;
  }

  // A store this size fits in one 100-row read, so that read *is* the answer the
  // walk has to match. A larger one would need the walk on both sides.
  if (whole.meta.hasMore) {
    console.log(`  · ${total} rows, more than one 100-row read — comparing the first 100 only`);
  }

  const walk = await walkByCursor(path, query);

  // Termination is only a claim about a list the walk was allowed to finish. On
  // a longer one the budget stops it, and that is the budget working.
  if ((total ?? 0) <= WALK_BUDGET) {
    check(walk.done, 'the walk terminates', `stopped after ${walk.batches} batches`);
  } else {
    console.log(`  · walked the first ${walk.ids.length} of ${total} — the budget, not the cursor, stopped it`);
  }

  const unique = new Set(walk.ids);
  check(unique.size === walk.ids.length, 'no row arrives twice', `${walk.ids.length - unique.size} repeated`);

  const expected = whole.data.map((row) => row.id);
  const reached = walk.ids.slice(0, expected.length);

  check(
    reached.length === expected.length,
    'the walk reaches every row',
    `walked ${walk.ids.length}, one read gave ${expected.length}`,
  );

  const firstDrift = expected.findIndex((id, index) => reached[index] !== id);
  check(firstDrift === -1, 'in the same order as one large read', firstDrift === -1 ? '' : `diverges at row ${firstDrift}`);

  if (!whole.meta.hasMore && (total ?? 0) <= WALK_BUDGET) {
    check(
      walk.ids.length === total,
      'the walk length equals the count the API reported',
      `walked ${walk.ids.length}, counted ${total}`,
    );
  }

  check(
    walk.batches >= 2 || (total ?? 0) <= BATCH,
    'the walk actually crossed a batch boundary',
    `${walk.batches} batch(es) for ${total} rows`,
  );

  // A cursor batch must not pay for the count again.
  const second = await call(path, { ...query, pageSize: BATCH });
  const cursorBatch = second.body?.meta.nextCursor
    ? await call(path, { ...query, pageSize: BATCH, cursor: second.body.meta.nextCursor })
    : null;

  if (cursorBatch?.body) {
    check(cursorBatch.body.meta.total === undefined, 'a cursored batch omits the count');
  }
}

async function verifyBadCursor(path: string) {
  console.log('\nA cursor that is not one');
  const { status, body } = await call(path, { cursor: 'not-a-cursor', pageSize: BATCH });
  check(status === 400, 'is refused rather than silently restarting the list', `answered ${status}`);
  check(
    (body as unknown as { code?: string })?.code === 'INVALID_CURSOR',
    'with INVALID_CURSOR',
    `code was ${(body as unknown as { code?: string })?.code}`,
  );
}

async function main() {
  console.log(`Keyset pagination · ${BASE} · store ${SLUG} · batches of ${BATCH}`);
  await signIn();
  console.log('  signed in\n');

  const lists: [string, string, Record<string, string | number | undefined>?][] = [
    ['Products (default sort: newest first)', '/api/v1/admin/products'],
    ['Products sorted by name, ascending', '/api/v1/admin/products', { sort: 'name', order: 'asc' }],
    // The one that was most exposed: `price_from` is nullable, and an unpriced
    // product used to fall out of every batch after the first.
    ['Products sorted by price', '/api/v1/admin/products', { sort: 'price', order: 'asc' }],
    ['Products sorted by stock (a computed column)', '/api/v1/admin/products', { sort: 'stock', order: 'desc' }],
    ['Orders', '/api/v1/admin/orders'],
    ['Orders sorted by total', '/api/v1/admin/orders', { sort: 'grandTotal', order: 'desc' }],
    ['Customers', '/api/v1/admin/customers'],
    ['Customers sorted by spend (a correlated subquery)', '/api/v1/admin/customers', { sort: 'totalSpent', order: 'desc' }],
    // Every seeded row shares sort_order = 0, so this is the list where a
    // missing tiebreaker showed up first.
    ['Categories (all tied on sort_order)', '/api/v1/admin/categories'],
    ['Brands', '/api/v1/admin/brands'],
    ['Inventory (emptiest first)', '/api/v1/admin/inventory'],
    ['Reviews', '/api/v1/admin/reviews'],
    ['Returns', '/api/v1/admin/returns'],
    ['Refunds', '/api/v1/admin/refunds'],
    ['Discounts', '/api/v1/admin/discounts'],
    ['Contact messages', '/api/v1/admin/contact-messages'],
    ['Website pages', '/api/v1/admin/website/pages'],
  ];

  for (const [label, path, query] of lists) {
    await verifyList(label, path, query ?? {});
    await sleep(20); // the rate limiter is not what is under test
  }

  await verifyBadCursor('/api/v1/admin/products');

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

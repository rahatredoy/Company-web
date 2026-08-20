/**
 * Products list + stats, against the live API and the real tenant database.
 *
 * Signs in without a password: a store-admin session row is planted for the
 * store's existing admin and removed at the end, so nobody's login is disturbed
 * and no credential has to be known. Everything else is the real route — the
 * guard, the tenant resolution, the SQL.
 *
 *   npx tsx <this file> [--slug e-comarch]
 */
import { randomBytes, createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { config } from '../src/config/index';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const SLUG = arg('slug') ?? config.devStoreSlug ?? 'e-comarch';

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

let cookie = '';

async function call(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-store-slug': SLUG,
    ...(payload ? { 'content-type': 'application/json' } : {}),
    ...(cookie ? { cookie } : {}),
  };

  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: 4100, path, method: init.method ?? 'GET', headers },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let body: unknown = null;
          try {
            body = raw ? JSON.parse(raw) : null;
          } catch {
            body = raw;
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const { openTenantPoolForSlug } = await import(
    '../src/db/tenant-manager'
  );
  const { closeRedis } = await import('../src/lib/redis');

  const pool = await openTenantPoolForSlug(SLUG);

  const admin = (await pool.query<{ id: string; email: string }>('select id, email from store_admins limit 1')).rows[0];
  if (!admin) throw new Error(`No store admin in ${SLUG}.`);

  const refRow = (
    await pool.query<{ tenant_ref: string }>('select tenant_ref from admin_sessions order by created_at desc limit 1')
  ).rows[0];

  let tenantRef = refRow?.tenant_ref;
  if (!tenantRef) {
    const sync = await pool
      .query<{ value: string }>(`select value from platform_sync where key = 'tenant_ref' limit 1`)
      .catch(() => ({ rows: [] as { value: string }[] }));
    tenantRef = sync.rows[0]?.value;
  }
  if (!tenantRef) throw new Error('Could not work out this store’s tenantRef — sign in to the panel once, then re-run.');

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const session = (
    await pool.query<{ id: string }>(
      `insert into admin_sessions (admin_id, token_hash, tenant_ref, mfa_verified, remember, expires_at)
       values ($1, $2, $3, true, false, now() + interval '30 minutes')
       returning id`,
      [admin.id, tokenHash, tenantRef],
    )
  ).rows[0]!;

  cookie = `store_admin_session=${token}`;
  console.log(`\n  store ${SLUG} · admin ${admin.email} · tenantRef ${tenantRef}\n`);

  try {
    // ---------------------------------------------------------------- session
    const me = await call('/api/v1/admin/auth/session');
    check('planted session authenticates', me.status === 200 && me.body?.data?.authenticated === true, me.body);

    // ------------------------------------------------------------------- list
    const list = await call('/api/v1/admin/products?pageSize=5');
    check('GET /products → 200', list.status === 200, list.body);
    const rows: any[] = list.body?.data ?? [];
    check('list carries meta', typeof list.body?.meta?.total === 'number', list.body?.meta);

    if (rows.length) {
      const row = rows[0];
      check('row has imageUrl key', 'imageUrl' in row, Object.keys(row));
      check('row has numeric stock', typeof row.stock === 'number', row.stock);
      check('row has stockRecords', typeof row.stockRecords === 'number', row.stockRecords);
      check('row has lowStockThreshold', typeof row.lowStockThreshold === 'number', row.lowStockThreshold);
      check('row has variantCount ≥ 1', typeof row.variantCount === 'number' && row.variantCount >= 1, row.variantCount);
      check('row has isNewArrival', typeof row.isNewArrival === 'boolean', row.isNewArrival);
      check('row has updatedAt', Boolean(row.updatedAt), row.updatedAt);
    } else {
      console.log('  SKIP  row shape — the store has no products');
    }

    // ------------------------------------------------------------------ stats
    const stats = await call('/api/v1/admin/products/stats');
    check('GET /products/stats → 200', stats.status === 200, stats.body);
    const s = stats.body?.data ?? {};
    check(
      'stats are all numbers',
      ['total', 'active', 'draft', 'inactive', 'featured', 'addedThisMonth', 'outOfStock', 'lowStock', 'untracked', 'unitsInStock'].every(
        (key) => typeof s[key] === 'number',
      ),
      s,
    );
    check('stats.total matches the unfiltered list total', s.total === list.body?.meta?.total, {
      stats: s.total,
      list: list.body?.meta?.total,
    });
    check('active + draft + inactive = total', s.active + s.draft + s.inactive === s.total, s);

    // stats.stats is a static route, so it must not have been swallowed by :id
    check('stats route is not treated as an id', stats.status !== 400 && stats.status !== 404, stats.status);

    // ---------------------------------------------------------------- filters
    for (const bucket of ['in_stock', 'low', 'out', 'untracked'] as const) {
      const filtered = await call(`/api/v1/admin/products?stock=${bucket}&pageSize=100`);
      check(`stock=${bucket} → 200`, filtered.status === 200, filtered.body);
      const kept: any[] = filtered.body?.data ?? [];
      const honest = kept.every((row) =>
        bucket === 'untracked'
          ? row.stockRecords === 0
          : bucket === 'out'
            ? row.stockRecords > 0 && row.stock <= 0
            : bucket === 'low'
              ? row.stock > 0 && row.stock <= row.lowStockThreshold
              : row.stock > row.lowStockThreshold,
      );
      check(`stock=${bucket} rows all belong in that bucket (${kept.length})`, honest, kept.slice(0, 3));
    }

    const buckets = await Promise.all(
      (['in_stock', 'low', 'out', 'untracked'] as const).map((bucket) =>
        call(`/api/v1/admin/products?stock=${bucket}&pageSize=1`).then((r) => r.body?.meta?.total ?? 0),
      ),
    );
    check(
      'the four stock buckets partition the catalogue',
      buckets.reduce((a, b) => a + b, 0) === s.total,
      { buckets, total: s.total },
    );
    check('stats.lowStock agrees with the low filter', buckets[1] === s.lowStock, { filter: buckets[1], stats: s.lowStock });
    check('stats.outOfStock agrees with the out filter', buckets[2] === s.outOfStock, {
      filter: buckets[2],
      stats: s.outOfStock,
    });
    check('stats.untracked agrees with the untracked filter', buckets[3] === s.untracked, {
      filter: buckets[3],
      stats: s.untracked,
    });

    const active = await call('/api/v1/admin/products?status=active&pageSize=1');
    check('status=active total agrees with stats.active', active.body?.meta?.total === s.active, {
      list: active.body?.meta?.total,
      stats: s.active,
    });

    const featured = await call('/api/v1/admin/products?featured=yes&pageSize=1');
    check('featured=yes total agrees with stats.featured', featured.body?.meta?.total === s.featured, {
      list: featured.body?.meta?.total,
      stats: s.featured,
    });

    // ------------------------------------------------------------------- sort
    const bySold = await call('/api/v1/admin/products?sort=stock&order=desc&pageSize=100');
    check('sort=stock → 200', bySold.status === 200, bySold.body);
    const stockOrder: number[] = (bySold.body?.data ?? []).map((row: any) => row.stock);
    check(
      'sort=stock really is descending',
      stockOrder.every((value, index) => index === 0 || stockOrder[index - 1]! >= value),
      stockOrder.slice(0, 8),
    );

    const byName = await call('/api/v1/admin/products?sort=name&order=asc&pageSize=100');
    // Compared with punctuation stripped: Postgres's default collation ignores it
    // and `localeCompare` does not, so "4K Streaming" vs "4-Person" disagree
    // without the two ever being out of order.
    const names: string[] = (byName.body?.data ?? []).map((row: any) =>
      String(row.name).toLowerCase().replace(/[^a-z0-9]/g, ''),
    );
    check(
      'sort=name really is ascending',
      names.every((value, index) => index === 0 || names[index - 1]! <= value),
      names.slice(0, 5),
    );

    const byUpdated = await call('/api/v1/admin/products?sort=updatedAt&order=desc&pageSize=5');
    check('sort=updatedAt → 200', byUpdated.status === 200, byUpdated.body);

    // ----------------------------------------------------------------- search
    if (rows.length && rows[0].sku) {
      const bySku = await call(`/api/v1/admin/products?search=${encodeURIComponent(rows[0].sku)}`);
      const found: any[] = bySku.body?.data ?? [];
      check(
        'search matches a SKU',
        found.some((row) => row.id === rows[0].id),
        { sku: rows[0].sku, got: found.map((r) => r.sku) },
      );
    }

    // ------------------------------------------------------- a write, restored
    if (rows.length) {
      const target = rows[0];
      const flip = await call(`/api/v1/admin/products/${target.id}`, {
        method: 'PATCH',
        body: { isFeatured: !target.isFeatured },
      });
      check('PATCH /products/:id → 200', flip.status === 200, flip.body);
      check('PATCH flipped isFeatured', flip.body?.data?.isFeatured === !target.isFeatured, flip.body?.data?.isFeatured);

      const back = await call(`/api/v1/admin/products/${target.id}`, {
        method: 'PATCH',
        body: { isFeatured: target.isFeatured },
      });
      check('PATCH restored isFeatured', back.body?.data?.isFeatured === target.isFeatured, back.body?.data?.isFeatured);
    }

    // ------------------------------------------------------------ bad requests
    // 422 with a per-field `details` map — this API's own validation convention.
    const badStock = await call('/api/v1/admin/products?stock=nonsense');
    check('an unknown stock bucket is refused', badStock.status === 422, badStock.status);
    check('the refusal names the field', Boolean(badStock.body?.details?.stock), badStock.body);
  } finally {
    await pool.query('delete from admin_sessions where id = $1', [session.id]);
    await pool.end();
    await closeRedis().catch(() => {});
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Renders the orders list against the running panel with rows in it: three
 * orders are planted, the page is fetched signed in, and everything is removed
 * again. The demo store has no orders, and an empty table proves only the empty
 * state.
 */
import { randomBytes, createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { closeRedis } from '../src/lib/redis';

const SLUG = config.devStoreSlug ?? 'e-comarch';
const PATH = process.argv[2] ?? '/orders';
const MARKERS = process.argv.slice(3);

function get(path: string, cookie: string): Promise<{ status: number; html: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: 3002, path, method: 'GET', headers: { cookie, accept: 'text/html' } },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, html: raw }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const pool = await openTenantPoolForSlug(SLUG);
  const admin = (await pool.query<{ id: string }>('select id from store_admins limit 1')).rows[0]!;
  const ref = (
    await pool.query<{ tenant_ref: string }>('select tenant_ref from admin_sessions order by created_at desc limit 1')
  ).rows[0]!;

  const token = randomBytes(32).toString('base64url');
  const session = (
    await pool.query<{ id: string }>(
      `insert into admin_sessions (admin_id, token_hash, tenant_ref, mfa_verified, remember, expires_at)
       values ($1, $2, $3, true, false, now() + interval '15 minutes') returning id`,
      [admin.id, createHash('sha256').update(token).digest('hex'), ref.tenant_ref],
    )
  ).rows[0]!;

  const planted: string[] = [];
  const stamp = String(process.pid).padStart(5, '0');

  async function plant(status: string, payment: string, total: string, daysAgo: number, name: string) {
    const row = (
      await pool.query<{ id: string }>(
        `insert into orders (order_number, email, phone, customer_name, status, payment_status,
                             currency, subtotal, grand_total, payment_provider, payment_method_label,
                             inventory_released, placed_at)
         values ($1, 'zz-render@example.com', '+8801711111111', $2, $3::order_status, $4::order_payment_status,
                 'USD', $5, $5, 'cod', 'Cash on Delivery', true, now() - ($6 || ' days')::interval)
         returning id`,
        [`ZZR-${stamp}-${planted.length + 1}`, name, status, payment, total, String(daysAgo)],
      )
    ).rows[0]!;

    await pool.query(
      `insert into order_items (order_id, product_name, sku, unit_price, quantity, line_total)
       values ($1, 'ZZ Render Widget', 'ZZR-SKU', $2, 3, $2)`,
      [row.id, total],
    );

    planted.push(row.id);
  }

  await plant('new', 'cod_pending', '150.00', 0, 'ZZ Render Buyer One');
  await plant('packed', 'paid', '820.00', 1, 'ZZ Render Buyer Two');
  await plant('delivered', 'paid', '99.99', 9, 'ZZ Render Buyer Three');

  try {
    const page = await get(PATH, `store_admin_session=${token}`);
    console.log(`\n  GET ${PATH} → ${page.status}  (${page.html.length} bytes)\n`);

    let failed = page.status !== 200;
    for (const marker of MARKERS) {
      // A marker starting with `!` must be absent — that is how a filter proves
      // it excluded something rather than merely including the right rows.
      const negated = marker.startsWith('!');
      const needle = negated ? marker.slice(1) : marker;
      const present = page.html.includes(needle);
      const ok = negated ? !present : present;
      if (!ok) failed = true;
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  page ${negated ? 'does not say' : 'says'} “${needle}”`);
    }
    for (const smell of ['Application error', 'Internal Server Error', 'Unhandled Runtime Error']) {
      if (page.html.includes(smell)) {
        failed = true;
        console.log(`  FAIL  page contains “${smell}”`);
      }
    }

    console.log(failed ? '\n  FAILED\n' : '\n  OK\n');
    process.exitCode = failed ? 1 : 0;
  } finally {
    for (const id of planted) await pool.query('delete from orders where id = $1', [id]).catch(() => {});
    await pool.query('delete from admin_sessions where id = $1', [session.id]);
    await pool.end();
    await closeRedis().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Orders — list shape, filters, the tally, and the status guard — against the
 * live API and a real tenant database.
 *
 * Read-only about real orders: the only writes attempted are a status move the
 * transition map forbids (refused) and one that is a no-op (same status), so a
 * shop's real order book is never advanced by a verification run.
 */
import { request as httpRequest } from 'node:http';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { closeRedis } from '../src/lib/redis';
import { fetchTenantBySlug } from '../src/lib/company-client';
import { createAdminSession, revokeSession } from '../src/lib/session';
import { ORDER_TRANSITIONS, type OrderStatus } from '../src/lib/constants';

const SLUG = config.devStoreSlug ?? 'e-comarch';
const OPEN = ['new', 'pending', 'confirmed', 'processing', 'packed'];

let passed = 0;
let failed = 0;
let cookie = '';

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

function call(path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; body: any }> {
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
  const headers: Record<string, string> = {
    accept: 'application/json',
    'x-store-slug': SLUG,
    ...(payload ? { 'content-type': 'application/json' } : {}),
    ...(cookie ? { cookie } : {}),
  };

  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: 4100, path, method: init.method ?? 'GET', headers }, (res) => {
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
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const pool = await openTenantPoolForSlug(SLUG);
  const admin = (await pool.query<{ id: string }>('select id from store_admins limit 1')).rows[0];
  if (!admin) throw new Error(`No store admin in ${SLUG}.`);
  /*
   * A short-lived panel session, minted through the API's own session module.
   * There is no table to plant a row in any more — the cookie carries a signed
   * JWT — and the tenant reference now comes from the control plane rather than
   * from whatever session happened to be lying about.
   */
  const tenant = await fetchTenantBySlug(SLUG);
  if (!tenant) throw new Error(`No tenant registered for ${SLUG}.`);

  const session = await createAdminSession(null, {
    adminId: admin.id,
    tenantRef: tenant.tenantRef,
    mfaVerified: true,
    remember: false,
  });
  const token = session.token;
  cookie = `store_admin_session=${token}`;

  /*
   * The demo store has no orders, and a list screen cannot be verified against an
   * empty table. Three are planted directly — the shape checkout writes, order
   * numbers prefixed so they cannot be confused with a real one — and deleted at
   * the end. `inventory_released` is set so a status move never touches stock.
   */
  const planted: string[] = [];
  const stamp = String(process.pid).padStart(5, '0');

  async function plant(status: string, paymentStatusValue: string, total: string, daysAgo: number) {
    const number = `ZZV-${stamp}-${planted.length + 1}`;
    const row = (
      await pool.query<{ id: string }>(
        `insert into orders (order_number, email, phone, customer_name, status, payment_status,
                             currency, subtotal, grand_total, payment_provider, payment_method_label,
                             inventory_released, placed_at)
         values ($1, 'zz-verify@example.com', '+8801700000000', 'ZZ Verify Buyer', $2::order_status,
                 $3::order_payment_status, 'USD', $4, $4, 'cod', 'Cash on Delivery', true,
                 now() - ($5 || ' days')::interval)
         returning id`,
        [number, status, paymentStatusValue, total, String(daysAgo)],
      )
    ).rows[0]!;

    await pool.query(
      `insert into order_items (order_id, product_name, sku, unit_price, quantity, line_total)
       values ($1, 'ZZ Verify Widget', 'ZZV-SKU', $2, 2, $2)`,
      [row.id, total],
    );

    planted.push(row.id);
    return row.id;
  }

  const newOrderId = await plant('new', 'cod_pending', '120.00', 0);
  await plant('shipped', 'paid', '340.50', 3);
  await plant('cancelled', 'failed', '75.25', 40);

  try {
    // ------------------------------------------------------------------- list
    const list = await call('/api/v1/admin/orders?pageSize=100');
    check('GET /orders → 200', list.status === 200, list.body);
    const rows: any[] = list.body?.data ?? [];
    const total = list.body?.meta?.total ?? 0;

    if (rows.length) {
      const row = rows[0];
      for (const key of ['customerId', 'phone', 'paymentProvider', 'allowedTransitions', 'itemCount']) {
        check(`row carries ${key}`, key in row, Object.keys(row));
      }
      check(
        'allowedTransitions matches the transition map',
        JSON.stringify(row.allowedTransitions) === JSON.stringify(ORDER_TRANSITIONS[row.status as OrderStatus]),
        { status: row.status, got: row.allowedTransitions },
      );
      check('itemCount is a number', typeof row.itemCount === 'number', row.itemCount);
    } else {
      console.log('  SKIP  row shape — the store has no orders');
    }

    // ------------------------------------------------------------------ stats
    const stats = await call('/api/v1/admin/orders/stats');
    check('GET /orders/stats → 200', stats.status === 200, stats.body);
    const s = stats.body?.data ?? {};
    check('stats route is not swallowed by /orders/:id', stats.status !== 400 && stats.status !== 404, stats.status);
    check(
      'the counts are numbers and the money is a string',
      ['total', 'todayOrders', 'openOrders', 'unpaid', 'shipped', 'delivered', 'cancelled'].every(
        (key) => typeof s[key] === 'number',
      ) && typeof s.todayRevenue === 'string' && typeof s.revenue30d === 'string',
      s,
    );
    check('stats.total matches the unfiltered list total', s.total === total, { stats: s.total, list: total });
    check('the store timezone is reported', typeof s.timezone === 'string' && s.timezone.length > 0, s.timezone);

    const byStatus: Record<string, number> = s.byStatus ?? {};
    const byPayment: Record<string, number> = s.byPaymentStatus ?? {};
    check(
      'byStatus sums to the total',
      Object.values(byStatus).reduce((a, b) => a + Number(b), 0) === s.total,
      byStatus,
    );
    check(
      'byPaymentStatus sums to the total',
      Object.values(byPayment).reduce((a, b) => a + Number(b), 0) === s.total,
      byPayment,
    );
    check(
      'openOrders agrees with byStatus',
      OPEN.reduce((sum, key) => sum + Number(byStatus[key] ?? 0), 0) === s.openOrders,
      { byStatus, openOrders: s.openOrders },
    );

    // ---------------------------------------------------------------- filters
    const open = await call('/api/v1/admin/orders?needsAction=yes&pageSize=100');
    check('needsAction=yes → 200', open.status === 200, open.body);
    check(
      'every row it returns still needs action',
      (open.body?.data ?? []).every((row: any) => OPEN.includes(row.status)),
      (open.body?.data ?? []).map((r: any) => r.status),
    );
    check('needsAction total agrees with stats.openOrders', open.body?.meta?.total === s.openOrders, {
      list: open.body?.meta?.total,
      stats: s.openOrders,
    });

    // One status at a time agrees with the tally.
    for (const [status, expected] of Object.entries(byStatus).slice(0, 4)) {
      const one = await call(`/api/v1/admin/orders?status=${status}&pageSize=1`);
      check(`status=${status} total agrees with byStatus (${expected})`, one.body?.meta?.total === Number(expected), {
        list: one.body?.meta?.total,
        stats: expected,
      });
    }

    for (const [paymentStatus, expected] of Object.entries(byPayment).slice(0, 3)) {
      const one = await call(`/api/v1/admin/orders?paymentStatus=${paymentStatus}&pageSize=1`);
      check(
        `paymentStatus=${paymentStatus} total agrees with the tally (${expected})`,
        one.body?.meta?.total === Number(expected),
        { list: one.body?.meta?.total, stats: expected },
      );
    }

    // ------------------------------------------------------------- date range
    const impossible = await call('/api/v1/admin/orders?from=2099-01-01&pageSize=1');
    check('a future "from" returns nothing', impossible.body?.meta?.total === 0, impossible.body?.meta);

    const everything = await call('/api/v1/admin/orders?from=1970-01-01&pageSize=1');
    check('an ancient "from" returns everything', everything.body?.meta?.total === total, everything.body?.meta);

    if (rows.length) {
      // `to` is inclusive: one day, both ends, must contain the order placed that day.
      const day = String(rows[0].placedAt).slice(0, 10);
      const sameDay = await call(`/api/v1/admin/orders?from=${day}&to=${day}&pageSize=100`);
      check(
        'from=to returns that whole day, inclusively',
        (sameDay.body?.data ?? []).some((row: any) => row.id === rows[0].id),
        { day, got: (sameDay.body?.data ?? []).length },
      );
    }

    const badDate = await call('/api/v1/admin/orders?from=yesterday');
    check('a malformed date is refused', badDate.status === 422, badDate.status);
    check('the refusal names the field', Boolean(badDate.body?.details?.from), badDate.body);

    // ------------------------------------------------------------------- sort
    const byTotal = await call('/api/v1/admin/orders?sort=grandTotal&order=desc&pageSize=100');
    const amounts: number[] = (byTotal.body?.data ?? []).map((row: any) => Number(row.grandTotal));
    check(
      'sort=grandTotal desc really is descending',
      amounts.every((value, index) => index === 0 || amounts[index - 1]! >= value),
      amounts.slice(0, 6),
    );

    // ------------------------------------------------------- the status guard
    if (rows.length) {
      const target = rows.find((row: any) => row.allowedTransitions.length > 0) ?? rows[0];
      const illegal = (['new', 'refunded', 'delivered', 'packed'] as OrderStatus[]).find(
        (status) => status !== target.status && !target.allowedTransitions.includes(status),
      );

      if (illegal) {
        const refused = await call(`/api/v1/admin/orders/${target.id}/status`, {
          method: 'PATCH',
          body: { status: illegal },
        });
        check(`a ${target.status} → ${illegal} move is refused`, refused.status === 409, {
          status: refused.status,
          code: refused.body?.code,
        });
      }

      // Same status: the handler returns early, so nothing is written.
      const noop = await call(`/api/v1/admin/orders/${target.id}/status`, {
        method: 'PATCH',
        body: { status: target.status },
      });
      check('setting the status it already has is a no-op', noop.status === 200, noop.body);

      const history = await pool.query<{ total: number }>(
        'select count(*)::int as total from order_status_history where order_id = $1 and to_status = $2 and admin_label is not null',
        [target.id, target.status],
      );
      check('the no-op wrote no history row', Number(history.rows[0]?.total ?? 0) === 0, history.rows[0]);

      const unknown = await call(`/api/v1/admin/orders/${target.id}/status`, {
        method: 'PATCH',
        body: { status: 'teleported' },
      });
      check('an unknown status is refused', unknown.status === 422, unknown.status);
    }

    // ------------------------------------------- a legal move, on a planted row
    const advanced = await call(`/api/v1/admin/orders/${newOrderId}/status`, {
      method: 'PATCH',
      body: { status: 'confirmed', note: 'zz-verify' },
    });
    check('new → confirmed is accepted', advanced.status === 200, advanced.body);
    check('the new status is stored', advanced.body?.data?.status === 'confirmed', advanced.body?.data?.status);
    check('confirmedAt is stamped', Boolean(advanced.body?.data?.confirmedAt), advanced.body?.data?.confirmedAt);

    const historyRow = await pool.query<{ from_status: string; to_status: string; admin_label: string }>(
      'select from_status, to_status, admin_label from order_status_history where order_id = $1 order by created_at desc limit 1',
      [newOrderId],
    );
    check(
      'the move wrote a history row naming the admin',
      historyRow.rows[0]?.from_status === 'new' &&
        historyRow.rows[0]?.to_status === 'confirmed' &&
        Boolean(historyRow.rows[0]?.admin_label),
      historyRow.rows[0],
    );

    const reread = await call(`/api/v1/admin/orders/${newOrderId}`);
    check(
      'the detail endpoint offers only the moves the map allows',
      JSON.stringify(reread.body?.data?.allowedTransitions) === JSON.stringify(ORDER_TRANSITIONS.confirmed),
      reread.body?.data?.allowedTransitions,
    );

    // Cancelling from confirmed is legal, and is the terminal state for it.
    const cancelled = await call(`/api/v1/admin/orders/${newOrderId}/status`, {
      method: 'PATCH',
      body: { status: 'cancelled', note: 'zz-verify cleanup' },
    });
    check('confirmed → cancelled is accepted', cancelled.status === 200, cancelled.body);
    check('the cancel reason is recorded', cancelled.body?.data?.cancelReason === 'zz-verify cleanup', cancelled.body?.data?.cancelReason);

    const dead = await call(`/api/v1/admin/orders/${newOrderId}/status`, {
      method: 'PATCH',
      body: { status: 'delivered' },
    });
    check('a cancelled order cannot be moved on', dead.status === 409, {
      status: dead.status,
      code: dead.body?.code,
    });

    // -------------------------------------------------------- the staff note
    const noted = await call(`/api/v1/admin/orders/${newOrderId}/note`, {
      method: 'PATCH',
      body: { adminNote: 'zz-verify note' },
    });
    check('PATCH /orders/:id/note → 200', noted.status === 200, noted.body);
    check('the note is stored', noted.body?.data?.adminNote === 'zz-verify note', noted.body?.data);

    // ------------------------------------------------- no shipment tracking
    const shipment = await call(`/api/v1/admin/orders/${planted[1]}/shipments`, {
      method: 'POST',
      body: { carrier: 'ZZ Courier', trackingNumber: 'ZZ123', trackingUrl: 'https://example.com/track/ZZ123' },
    });
    check('POST /orders/:id/shipments is gone → 404', shipment.status === 404, shipment.body);
  } finally {
    for (const id of planted) {
      await pool.query('delete from orders where id = $1', [id]).catch(() => {});
    }
    await revokeSession(tenant.tenantRef, session.id);
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

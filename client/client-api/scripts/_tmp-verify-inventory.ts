/**
 * Inventory — list shape, the tally, threshold-only edits, and warehouse
 * create/edit/delete — against the live API and a real tenant database.
 *
 * Real stock is left exactly as it was: every adjustment made here is undone by
 * its opposite, and the warehouse it creates is deleted. `zz-verify` prefixes
 * everything it makes.
 */
import { randomBytes, createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { closeRedis } from '../src/lib/redis';

const SLUG = config.devStoreSlug ?? 'e-comarch';

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
  const admin = (await pool.query<{ id: string }>('select id from store_admins limit 1')).rows[0]!;
  const ref = (
    await pool.query<{ tenant_ref: string }>('select tenant_ref from admin_sessions order by created_at desc limit 1')
  ).rows[0]!;

  const token = randomBytes(32).toString('base64url');
  const session = (
    await pool.query<{ id: string }>(
      `insert into admin_sessions (admin_id, token_hash, tenant_ref, mfa_verified, remember, expires_at)
       values ($1, $2, $3, true, false, now() + interval '30 minutes') returning id`,
      [admin.id, createHash('sha256').update(token).digest('hex'), ref.tenant_ref],
    )
  ).rows[0]!;
  cookie = `store_admin_session=${token}`;

  const createdWarehouses: string[] = [];
  let restoreThreshold: { variantId: string; warehouseId: string; value: number } | null = null;

  try {
    // ------------------------------------------------------------------- list
    const list = await call('/api/v1/admin/inventory?pageSize=50');
    check('GET /inventory → 200', list.status === 200, list.body);
    const rows: any[] = list.body?.data ?? [];

    if (rows.length) {
      for (const key of ['productSlug', 'imageUrl', 'costPrice', 'price', 'lowStockThreshold', 'variantId']) {
        check(`row carries ${key}`, key in rows[0], Object.keys(rows[0]));
      }
      const availables: number[] = rows.map((row) => row.available);
      check(
        'the default order really is emptiest first',
        availables.every((value, index) => index === 0 || availables[index - 1]! <= value),
        availables.slice(0, 8),
      );

      const desc = await call('/api/v1/admin/inventory?sort=available&order=desc&pageSize=50');
      const fullest: number[] = (desc.body?.data ?? []).map((row: any) => row.available);
      check(
        'sort=available&order=desc reverses it',
        fullest.every((value, index) => index === 0 || fullest[index - 1]! >= value),
        fullest.slice(0, 8),
      );

      const byProduct = await call('/api/v1/admin/inventory?sort=product&order=asc&pageSize=50');
      const names: string[] = (byProduct.body?.data ?? []).map((row: any) =>
        String(row.productName).toLowerCase().replace(/[^a-z0-9]/g, ''),
      );
      check(
        'sort=product is alphabetical',
        names.every((value, index) => index === 0 || names[index - 1]! <= value),
        names.slice(0, 5),
      );
    } else {
      console.log('  SKIP  row shape — nothing is tracked in this store');
    }

    // ------------------------------------------------------------------ stats
    const stats = await call('/api/v1/admin/inventory/stats');
    check('GET /inventory/stats → 200', stats.status === 200, stats.body);
    const s = stats.body?.data ?? {};
    check('stats route is not read as a variant id', stats.status !== 400 && stats.status !== 404, stats.status);
    check(
      'the counts are numbers and the value is a string',
      ['tracked', 'inStock', 'low', 'out', 'unitsAvailable', 'warehouses', 'untrackedVariants'].every(
        (key) => typeof s[key] === 'number',
      ) && typeof s.valueAtCost === 'string',
      s,
    );
    check('tracked matches the unfiltered list total', s.tracked === list.body?.meta?.total, {
      stats: s.tracked,
      list: list.body?.meta?.total,
    });
    check('in stock + low + out = tracked', s.inStock + s.low + s.out === s.tracked, s);

    for (const [bucket, expected] of [
      ['in_stock', s.inStock],
      ['low', s.low],
      ['out', s.out],
    ] as const) {
      const one = await call(`/api/v1/admin/inventory?status=${bucket}&pageSize=1`);
      check(`status=${bucket} total agrees with the tally (${expected})`, one.body?.meta?.total === expected, {
        list: one.body?.meta?.total,
        stats: expected,
      });
    }

    const truth = await pool.query<{ value: string }>(
      `select coalesce(sum(l.available * coalesce(v.cost_price, 0)), 0)::numeric(14,2)::text as value
         from inventory_levels l join product_variants v on v.id = l.variant_id`,
    );
    check('valueAtCost matches the database', s.valueAtCost === truth.rows[0]?.value, {
      api: s.valueAtCost,
      db: truth.rows[0]?.value,
    });

    // -------------------------------------------------------------- threshold
    if (rows.length) {
      const row = rows[0];
      restoreThreshold = {
        variantId: row.variantId,
        warehouseId: row.warehouseId,
        value: row.lowStockThreshold,
      };
      const next = row.lowStockThreshold + 7;

      const moved = await call('/api/v1/admin/inventory/threshold', {
        method: 'PATCH',
        body: { variantId: row.variantId, warehouseId: row.warehouseId, lowStockThreshold: next },
      });
      check('PATCH /inventory/threshold → 200', moved.status === 200, moved.body);
      check('the new warning line is returned', moved.body?.data?.lowStockThreshold === next, moved.body?.data);

      const after = await pool.query<{ available: number; low_stock_threshold: number }>(
        'select available, low_stock_threshold from inventory_levels where variant_id = $1 and warehouse_id = $2',
        [row.variantId, row.warehouseId],
      );
      check('it was written', Number(after.rows[0]?.low_stock_threshold) === next, after.rows[0]);
      check('no stock moved', Number(after.rows[0]?.available) === row.available, {
        before: row.available,
        after: after.rows[0]?.available,
      });

      const ledger = await pool.query<{ total: number }>(
        `select count(*)::int as total from inventory_transactions
          where variant_id = $1 and created_at > now() - interval '1 minute'`,
        [row.variantId],
      );
      check('and nothing was written to the ledger', Number(ledger.rows[0]?.total ?? 0) === 0, ledger.rows[0]);

      const unknown = await call('/api/v1/admin/inventory/threshold', {
        method: 'PATCH',
        body: {
          variantId: '00000000-0000-4000-8000-000000000000',
          warehouseId: row.warehouseId,
          lowStockThreshold: 3,
        },
      });
      check('an unknown level is a 404', unknown.status === 404, unknown.status);

      const negative = await call('/api/v1/admin/inventory/threshold', {
        method: 'PATCH',
        body: { variantId: row.variantId, warehouseId: row.warehouseId, lowStockThreshold: -1 },
      });
      check('a negative warning line is refused', negative.status === 422, negative.status);

      // -------------------------------------------------- an adjustment, undone
      const up = await call('/api/v1/admin/inventory/adjust', {
        method: 'POST',
        body: {
          variantId: row.variantId,
          warehouseId: row.warehouseId,
          bucket: 'available',
          delta: 5,
          reason: 'zz-verify',
        },
      });
      check('POST /inventory/adjust → 200', up.status === 200, up.body);
      check('available went up by 5', up.body?.data?.available === row.available + 5, up.body?.data);

      const down = await call('/api/v1/admin/inventory/adjust', {
        method: 'POST',
        body: {
          variantId: row.variantId,
          warehouseId: row.warehouseId,
          bucket: 'available',
          delta: -5,
          reason: 'zz-verify undo',
        },
      });
      check('and back down again', down.body?.data?.available === row.available, down.body?.data);

      const overdraw = await call('/api/v1/admin/inventory/adjust', {
        method: 'POST',
        body: {
          variantId: row.variantId,
          warehouseId: row.warehouseId,
          bucket: 'available',
          delta: -(row.available + 1000),
          reason: 'zz-verify overdraw',
        },
      });
      check('an overdraw is refused, not clamped', overdraw.status === 422, {
        status: overdraw.status,
        code: overdraw.body?.code,
      });
      const stillThere = await pool.query<{ available: number }>(
        'select available from inventory_levels where variant_id = $1 and warehouse_id = $2',
        [row.variantId, row.warehouseId],
      );
      check('the count survived the refusal', Number(stillThere.rows[0]?.available) === row.available, stillThere.rows[0]);

      const zero = await call('/api/v1/admin/inventory/adjust', {
        method: 'POST',
        body: { variantId: row.variantId, warehouseId: row.warehouseId, bucket: 'available', delta: 0 },
      });
      check('an adjustment of nothing is refused', zero.status === 422, zero.status);
    }

    // ------------------------------------------------------------ warehouses
    const before = await call('/api/v1/admin/warehouses');
    check('GET /warehouses → 200', before.status === 200, before.body);
    const existing: any[] = before.body?.data ?? [];
    check('exactly one warehouse is the default', existing.filter((row) => row.isDefault).length === 1, {
      defaults: existing.filter((row) => row.isDefault).map((row) => row.name),
    });

    const made = await call('/api/v1/admin/warehouses', {
      method: 'POST',
      body: { name: 'zz-verify Depot', code: `ZZV${String(process.pid).slice(-4)}`, city: 'Nowhere' },
    });
    check('POST /warehouses → 201', made.status === 201, made.body);
    const depot = made.body?.data;
    if (depot?.id) createdWarehouses.push(depot.id);
    check('a second warehouse is not made the default', depot?.isDefault === false, depot);
    check('the code is stored in capitals', depot?.code === depot?.code?.toUpperCase(), depot?.code);

    const renamed = await call(`/api/v1/admin/warehouses/${depot.id}`, {
      method: 'PATCH',
      body: { name: 'zz-verify Depot Renamed', city: 'Somewhere' },
    });
    check('PATCH /warehouses/:id → 200', renamed.status === 200, renamed.body);
    check('the rename took', renamed.body?.data?.name === 'zz-verify Depot Renamed', renamed.body?.data?.name);

    const dupe = await call(`/api/v1/admin/warehouses/${depot.id}`, {
      method: 'PATCH',
      body: { code: existing[0]?.code },
    });
    check('a code another warehouse uses is refused', dupe.status === 409, {
      status: dupe.status,
      code: dupe.body?.code,
    });

    const defaultOne = existing.find((row) => row.isDefault);
    if (defaultOne) {
      const unset = await call(`/api/v1/admin/warehouses/${defaultOne.id}`, {
        method: 'PATCH',
        body: { isDefault: false },
      });
      check('clearing the only default is refused', unset.status === 422, {
        status: unset.status,
        code: unset.body?.code,
      });

      const deactivate = await call(`/api/v1/admin/warehouses/${defaultOne.id}`, {
        method: 'PATCH',
        body: { isActive: false },
      });
      check('deactivating the default is refused', deactivate.status === 422, deactivate.status);

      const removeDefault = await call(`/api/v1/admin/warehouses/${defaultOne.id}`, { method: 'DELETE' });
      check('deleting the default is refused', removeDefault.status === 409, removeDefault.status);
    }

    // Moving the default and moving it back — the flag must stay unique.
    if (defaultOne) {
      const promote = await call(`/api/v1/admin/warehouses/${depot.id}`, {
        method: 'PATCH',
        body: { isDefault: true },
      });
      check('another warehouse can be made the default', promote.body?.data?.isDefault === true, promote.body?.data);

      const now = await call('/api/v1/admin/warehouses');
      check(
        'the flag moved rather than being duplicated',
        (now.body?.data ?? []).filter((row: any) => row.isDefault).length === 1,
        (now.body?.data ?? []).map((row: any) => ({ name: row.name, isDefault: row.isDefault })),
      );

      const back = await call(`/api/v1/admin/warehouses/${defaultOne.id}`, {
        method: 'PATCH',
        body: { isDefault: true },
      });
      check('and it can be given back', back.body?.data?.isDefault === true, back.body?.data);
    }

    // A warehouse holding stock cannot be deleted.
    if (createdWarehouses.length) {
      const someVariant = (
        await pool.query<{ id: string }>('select id from product_variants limit 1')
      ).rows[0];

      if (someVariant) {
        await call('/api/v1/admin/inventory/adjust', {
          method: 'POST',
          body: {
            variantId: someVariant.id,
            warehouseId: depot.id,
            bucket: 'available',
            delta: 3,
            reason: 'zz-verify stocked',
          },
        });

        const held = await call(`/api/v1/admin/warehouses/${depot.id}`, { method: 'DELETE' });
        check('a warehouse holding stock cannot be deleted', held.status === 409, {
          status: held.status,
          message: held.body?.message,
        });

        await call('/api/v1/admin/inventory/adjust', {
          method: 'POST',
          body: {
            variantId: someVariant.id,
            warehouseId: depot.id,
            bucket: 'available',
            delta: -3,
            reason: 'zz-verify emptied',
          },
        });
      }

      const gone = await call(`/api/v1/admin/warehouses/${depot.id}`, { method: 'DELETE' });
      check('an empty, non-default warehouse can be deleted', gone.status === 204, gone.body);
      if (gone.status === 204) createdWarehouses.length = 0;
    }
  } finally {
    if (restoreThreshold) {
      await pool
        .query('update inventory_levels set low_stock_threshold = $3 where variant_id = $1 and warehouse_id = $2', [
          restoreThreshold.variantId,
          restoreThreshold.warehouseId,
          restoreThreshold.value,
        ])
        .catch(() => {});
    }
    // The ledger rows this run wrote are left in place on purpose: they record real
    // movements that really happened, and deleting them would make the history lie.
    for (const id of createdWarehouses) {
      await pool.query('delete from warehouses where id = $1', [id]).catch(() => {});
    }
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

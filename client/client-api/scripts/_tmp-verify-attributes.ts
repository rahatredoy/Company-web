/**
 * Attributes — list shape with usage counts, CRUD, reorder, and single-value
 * deletion — against the live API and a real tenant database.
 *
 * Signs in without a password by planting a store-admin session row and removing
 * it at the end. Everything it creates is prefixed `zz-verify-` and deleted.
 */
import { request as httpRequest } from 'node:http';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { closeRedis } from '../src/lib/redis';
import { fetchTenantBySlug } from '../src/lib/company-client';
import { createAdminSession, revokeSession } from '../src/lib/session';

const SLUG = config.devStoreSlug ?? 'e-comarch';
const PREFIX = 'zz-verify';

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

  const created: string[] = [];

  try {
    // ------------------------------------------------------------------- list
    const list = await call('/api/v1/admin/attributes');
    check('GET /attributes → 200', list.status === 200, list.body);
    const rows: any[] = list.body?.data ?? [];
    if (rows.length) {
      check('attribute carries productCount', typeof rows[0].productCount === 'number', rows[0].productCount);
      check('attribute carries variantCount', typeof rows[0].variantCount === 'number', rows[0].variantCount);
      const withValues = rows.find((row) => row.values.length > 0);
      if (withValues) {
        const value = withValues.values[0];
        check('value carries variantCount', typeof value.variantCount === 'number', value);
        check('value carries productCount', typeof value.productCount === 'number', value);
      }

      // A value used by a variant must report it, and the sums must agree.
      const usedValue = rows
        .flatMap((row: any) => row.values)
        .find((value: any) => value.variantCount > 0);
      if (usedValue) {
        const truth = (
          await pool.query<{ total: number }>(
            'select count(distinct variant_id)::int as total from product_variant_values where attribute_value_id = $1',
            [usedValue.id],
          )
        ).rows[0]!;
        check('value.variantCount matches the database', usedValue.variantCount === Number(truth.total), {
          api: usedValue.variantCount,
          db: truth.total,
        });
      } else {
        console.log('  SKIP  value usage — no variant uses an attribute value in this store');
      }
    }

    // ----------------------------------------------------------------- create
    const add = await call('/api/v1/admin/attributes', {
      method: 'POST',
      body: {
        name: `${PREFIX} Finish`,
        inputType: 'color',
        isVariantAttribute: true,
        isFilterable: true,
        unit: null,
        sortOrder: 950,
        values: [
          { value: 'Matte Black', colorHex: '#111111' },
          { value: 'Brushed Steel', colorHex: '#c0c0c0' },
        ],
      },
    });
    check('POST /attributes → 201', add.status === 201, add.body);
    const attribute = add.body?.data;
    if (attribute?.id) created.push(attribute.id);
    check('the slug is derived from the name', attribute?.slug === `${PREFIX}-finish`, attribute?.slug);

    const second = await call('/api/v1/admin/attributes', {
      method: 'POST',
      body: { name: `${PREFIX} Length`, inputType: 'number', unit: 'cm', sortOrder: 951, values: [{ value: '10' }] },
    });
    check('a second attribute is created', second.status === 201, second.body);
    if (second.body?.data?.id) created.push(second.body.data.id);

    const clash = await call('/api/v1/admin/attributes', { method: 'POST', body: { name: `${PREFIX} Finish` } });
    if (clash.body?.data?.id) created.push(clash.body.data.id);
    check('a duplicate name is refused', clash.status === 409, { status: clash.status, code: clash.body?.code });

    // Read back: values and their colours were stored.
    const after = await call('/api/v1/admin/attributes');
    const mine = (after.body?.data ?? []).find((row: any) => row.id === attribute.id);
    check('both values were stored', mine?.values?.length === 2, mine?.values);
    check(
      'colour swatches were stored',
      mine?.values?.every((value: any) => Boolean(value.colorHex)),
      mine?.values?.map((v: any) => v.colorHex),
    );
    check('a fresh attribute reports zero products', mine?.productCount === 0, mine?.productCount);

    // ----------------------------------------------------------------- update
    const rename = await call(`/api/v1/admin/attributes/${attribute.id}`, {
      method: 'PUT',
      body: {
        name: `${PREFIX} Finish Renamed`,
        inputType: 'color',
        isVariantAttribute: false,
        isFilterable: false,
        unit: null,
        sortOrder: 950,
        values: mine.values.map((value: any) => ({ id: value.id, value: value.value, colorHex: value.colorHex })),
      },
    });
    check('PUT /attributes/:id → 200', rename.status === 200, rename.body);
    check('flags were updated', rename.body?.data?.isFilterable === false, rename.body?.data);

    // A value left out of the list is kept, not deleted — the merge rule.
    const partial = await call(`/api/v1/admin/attributes/${attribute.id}`, {
      method: 'PUT',
      body: {
        name: `${PREFIX} Finish Renamed`,
        inputType: 'color',
        isVariantAttribute: false,
        isFilterable: true,
        unit: null,
        sortOrder: 950,
        values: [{ id: mine.values[0].id, value: mine.values[0].value, colorHex: mine.values[0].colorHex }],
      },
    });
    check('a partial value list is accepted', partial.status === 200, partial.body);
    const merged = ((await call('/api/v1/admin/attributes')).body?.data ?? []).find(
      (row: any) => row.id === attribute.id,
    );
    check('an omitted value is kept, not deleted', merged?.values?.length === 2, merged?.values?.length);

    // ---------------------------------------------------------- value delete
    const valueId = merged.values[1].id;
    const dropped = await call(`/api/v1/admin/attributes/${attribute.id}/values/${valueId}`, { method: 'DELETE' });
    check('DELETE one value → 204', dropped.status === 204, dropped.body);
    const trimmed = ((await call('/api/v1/admin/attributes')).body?.data ?? []).find(
      (row: any) => row.id === attribute.id,
    );
    check('the value is gone', trimmed?.values?.length === 1, trimmed?.values);

    const missingValue = await call(`/api/v1/admin/attributes/${attribute.id}/values/${valueId}`, {
      method: 'DELETE',
    });
    check('deleting it twice is a 404', missingValue.status === 404, missingValue.status);

    // A value belonging to a different attribute is not deletable through this one.
    const foreign = await call(`/api/v1/admin/attributes/${created[1]}/values/${trimmed.values[0].id}`, {
      method: 'DELETE',
    });
    check("another attribute's value is not reachable", foreign.status === 404, foreign.status);

    // A value in use is refused.
    const usedValue = (list.body?.data ?? [])
      .flatMap((row: any) => row.values.map((value: any) => ({ ...value, attributeId: row.id })))
      .find((value: any) => value.variantCount > 0 || value.productCount > 0);
    if (usedValue) {
      const refused = await call(`/api/v1/admin/attributes/${usedValue.attributeId}/values/${usedValue.id}`, {
        method: 'DELETE',
      });
      check('a value in use is refused', refused.status === 409, { status: refused.status, code: refused.body?.code });
    } else {
      console.log('  SKIP  in-use value refusal — nothing in this store uses a value');
    }

    // ---------------------------------------------------------------- reorder
    const reorder = await call('/api/v1/admin/attributes/reorder', {
      method: 'PATCH',
      body: [created[0]!, created[1]!].map((id, index) => ({ id, sortOrder: 7 - index })),
    });
    check('a reorder body must be wrapped in { order }', reorder.status === 422, reorder.status);

    const proper = await call('/api/v1/admin/attributes/reorder', {
      method: 'PATCH',
      body: { order: [{ id: created[0]!, sortOrder: 7 }, { id: created[1]!, sortOrder: 6 }] },
    });
    check('PATCH /attributes/reorder → 204', proper.status === 204, proper.body);

    const ordered = (await call('/api/v1/admin/attributes')).body?.data ?? [];
    const byId = new Map(ordered.map((row: any) => [row.id, row]));
    check(
      'reorder wrote both sort orders',
      (byId.get(created[0]!) as any)?.sortOrder === 7 && (byId.get(created[1]!) as any)?.sortOrder === 6,
      { a: (byId.get(created[0]!) as any)?.sortOrder, b: (byId.get(created[1]!) as any)?.sortOrder },
    );
    check(
      'the list comes back in sort order',
      ordered.every(
        (row: any, index: number) => index === 0 || ordered[index - 1].sortOrder <= row.sortOrder,
      ),
      ordered.map((row: any) => row.sortOrder),
    );

    // ----------------------------------------------------------------- delete
    const gone = await call(`/api/v1/admin/attributes/${created[0]}`, { method: 'DELETE' });
    check('DELETE /attributes/:id → 204', gone.status === 204, gone.body);
    const remaining = (await call('/api/v1/admin/attributes')).body?.data ?? [];
    check(
      'the attribute and its values are gone',
      !remaining.some((row: any) => row.id === created[0]),
      remaining.map((row: any) => row.id),
    );

    // An attribute products use is refused.
    const inUse = (list.body?.data ?? []).find((row: any) => row.productCount > 0);
    if (inUse) {
      const refused = await call(`/api/v1/admin/attributes/${inUse.id}`, { method: 'DELETE' });
      check('an attribute in use is refused', refused.status === 409, {
        status: refused.status,
        code: refused.body?.code,
      });
    } else {
      console.log('  SKIP  in-use attribute refusal — nothing in this store uses one');
    }
  } finally {
    for (const id of created) {
      await pool.query('delete from attributes where id = $1', [id]).catch(() => {});
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

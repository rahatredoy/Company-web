/**
 * Brands — list shape and CRUD — against the live API and a real tenant
 * database.
 *
 * Signs in without a password by planting a store-admin session row and removing
 * it at the end. Everything it creates is prefixed `zz-verify-` and deleted, so it
 * is safe against a store with real brands in it.
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
    const list = await call('/api/v1/admin/brands?pageSize=100');
    check('GET /brands → 200', list.status === 200, list.body);
    const rows: any[] = list.body?.data ?? [];
    if (rows.length) {
      const row = rows[0];
      for (const key of [
        'description',
        'logoUrl',
        'updatedAt',
        'productCount',
      ]) {
        check(`list row carries ${key}`, key in row, Object.keys(row));
      }
      // Dropped in migration 0017 — a response that still carries one is reading
      // a column that no longer exists.
      for (const key of ['websiteUrl', 'seoTitle', 'seoDescription', 'sortOrder']) {
        check(`list row no longer carries ${key}`, !(key in row), Object.keys(row));
      }
    }

    // ------------------------------------------------------------------ create
    const add = await call('/api/v1/admin/brands', {
      method: 'POST',
      body: {
        name: `${PREFIX} Acme`,
        description: 'Made up for a verification run.',
        isActive: true,
        isFeatured: true,
      },
    });
    check('POST /brands → 201', add.status === 201, add.body);
    const brand = add.body?.data;
    if (brand?.id) created.push(brand.id);
    check('the slug is derived from the name', brand?.slug === `${PREFIX}-acme`, brand?.slug);
    check('featured is stored', brand?.isFeatured === true, brand);

    const second = await call('/api/v1/admin/brands', {
      method: 'POST',
      body: { name: `${PREFIX} Beta` },
    });
    check('a second brand is created', second.status === 201, second.body);
    if (second.body?.data?.id) created.push(second.body.data.id);

    // A clashing name gets a suffixed slug rather than a refusal.
    const clash = await call('/api/v1/admin/brands', { method: 'POST', body: { name: `${PREFIX} Acme` } });
    if (clash.body?.data?.id) created.push(clash.body.data.id);
    check('a derived slug that clashes is suffixed', clash.body?.data?.slug !== `${PREFIX}-acme`, clash.body?.data?.slug);

    // An explicitly requested slug that clashes is refused.
    const taken = await call('/api/v1/admin/brands', {
      method: 'POST',
      body: { name: `${PREFIX} Gamma`, slug: `${PREFIX}-acme` },
    });
    if (taken.body?.data?.id) created.push(taken.body.data.id);
    check('an asked-for slug that clashes is refused', taken.status === 409, {
      status: taken.status,
      code: taken.body?.code,
    });

    // ------------------------------------------------------------------ update
    const rename = await call(`/api/v1/admin/brands/${brand.id}`, {
      method: 'PATCH',
      body: { name: `${PREFIX} Acme Renamed` },
    });
    check('PATCH /brands/:id → 200', rename.status === 200, rename.body);
    check('a rename does not move the slug', rename.body?.data?.slug === brand.slug, rename.body?.data?.slug);

    const hide = await call(`/api/v1/admin/brands/${brand.id}`, { method: 'PATCH', body: { isActive: false } });
    check('a brand can be hidden', hide.body?.data?.isActive === false, hide.body?.data);
    // Zod 4 fills `.default()` under `.partial()`; the handler must write only
    // the keys that were sent, or this save would clear the description.
    check(
      'a PATCH keeps the fields it did not send',
      hide.body?.data?.description === 'Made up for a verification run.' && hide.body?.data?.isFeatured === true,
      hide.body?.data,
    );

    // ------------------------------------------------------------------ search
    const found = await call(`/api/v1/admin/brands?search=${PREFIX}`);
    check(
      'search finds what was just created',
      (found.body?.data ?? []).length >= created.length - 1,
      (found.body?.data ?? []).map((r: any) => r.name),
    );

    const hidden = await call('/api/v1/admin/brands?status=inactive&pageSize=100');
    check(
      'status=inactive returns only hidden brands',
      (hidden.body?.data ?? []).every((row: any) => row.isActive === false),
      (hidden.body?.data ?? []).map((r: any) => r.isActive),
    );

    // ------------------------------------------------------------------ delete
    const gone = await call(`/api/v1/admin/brands/${created[0]}`, { method: 'DELETE' });
    check('DELETE /brands/:id → 204', gone.status === 204, gone.body);
    const missing = await call(`/api/v1/admin/brands/${created[0]}`);
    check('a deleted brand is gone', missing.status === 404, missing.status);
  } finally {
    for (const id of created) {
      await pool.query('delete from brands where id = $1', [id]).catch(() => {});
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

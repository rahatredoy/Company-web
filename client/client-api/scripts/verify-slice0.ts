/**
 * Slice 0 verification against a real tenant database.
 *
 *   npx tsx scripts/verify-slice0.ts
 *
 * Exercises the boundaries that matter for tenant isolation and store-admin
 * auth. It talks to the running API over HTTP and to the tenant database
 * directly, so a failure here is a real failure and not a mocked one.
 */
import { request as httpRequest } from 'node:http';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { publishTenantInvalidation, tenantCacheKey } from '../src/lib/company-client';
import { closeRedis, redis } from '../src/lib/redis';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const BASE = `http://localhost:${config.api.port}/api/v1/admin`;
/**
 * The store to verify. This used to be pinned to the `abc-fashion` fixture
 * because the owner credential below belonged to that one store, and following
 * `DEV_STORE_SLUG` would have run every check against a database where it is
 * not the password. That fixture no longer exists, so the pin named nothing and
 * the script failed before its first check.
 *
 * The credential is still store-specific, so it does **not** follow the slug:
 * pass `--email`/`--password` for whatever store `--slug` (or `DEV_STORE_SLUG`)
 * resolves to. The defaults below are the old fixture's and are kept only so an
 * `abc-fashion` rebuilt by `create-test-clients.ts` still runs bare.
 */
const SLUG = arg('slug') ?? config.devStoreSlug ?? 'abc-fashion';
const OWNER = arg('email') ?? 'owner@abcfashion.com';
const PASSWORD = arg('password') ?? 'OwnerPass2026';
const STAFF = 'staff.tester@abcfashion.com';
const STAFF_PASSWORD = 'StaffPass2026';

const pool = await openTenantPoolForSlug(SLUG);

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

interface Jar {
  cookies: Map<string, string>;
}

function newJar(): Jar {
  return { cookies: new Map() };
}

/**
 * Uses `node:http` rather than `fetch` deliberately: `Host` is a forbidden
 * header for `fetch`, which silently drops it — and the whole point of these
 * checks is that tenant identity comes from the hostname.
 */
async function call(
  path: string,
  init: { method?: string; body?: string; jar?: Jar; host?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...(init.body ? { 'content-type': 'application/json' } : {}),
    ...(init.headers ?? {}),
  };

  if (init.jar && init.jar.cookies.size > 0) {
    headers.cookie = [...init.jar.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  const { status, setCookie, text } = await new Promise<{
    status: number;
    setCookie: string[];
    text: string;
  }>((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: config.api.port,
        path: `/api/v1/admin${path}`,
        method: init.method ?? 'GET',
        // The connection goes to loopback; the `Host` header is what names the
        // store. It defaults to this store's own hostname rather than a bare
        // address, because a bare one would fall through to `DEV_STORE_SLUG` and
        // quietly run half of these checks against whichever store that names.
        headers: { ...headers, host: init.host ?? `admin.${SLUG}.${config.urls.platformRootDomain}` },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            setCookie: response.headers['set-cookie'] ?? [],
            text: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    request.on('error', reject);
    if (init.body) request.write(init.body);
    request.end();
  });

  if (init.jar) {
    for (const raw of setCookie) {
      const [pair] = raw.split(';');
      const [name, ...rest] = pair!.split('=');
      const value = rest.join('=');
      if (!value) init.jar.cookies.delete(name!);
      else init.jar.cookies.set(name!, value);
    }
  }

  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status, body };
}

/**
 * The auth endpoints are rate limited per IP and per email, which is exactly
 * what a repeated verification run looks like. Clear only this script's own
 * counters so a second run is not blocked by the first — the limiter itself is
 * exercised deliberately in step 7.
 */
async function clearAuthRateLimits(): Promise<void> {
  const scopes = ['login', 'forgot-password', 'reset-password', 'mfa-verify', 'reauth'];
  for (const scope of scopes) {
    const keys = await redis.keys(`rl:${scope}:*`).catch(() => []);
    if (keys.length > 0) await redis.del(...keys).catch(() => undefined);
  }
}

/**
 * Retries a call until it reflects a change that propagates asynchronously.
 *
 * A tenant-status change reaches the API over Redis pub/sub, so there is a real
 * gap — a network round trip, no more — between writing it and the server acting
 * on it. Polling briefly is not the same as sleeping until the check passes: the
 * assertion is unchanged and still fails if the state never arrives, and it
 * returns the moment it does rather than always paying a fixed delay.
 */
async function settle<T extends { status: number; body: any }>(
  attempt: () => Promise<T>,
  matches: (result: T) => boolean,
  tries = 20,
): Promise<T> {
  let last = await attempt();
  for (let i = 1; i < tries && !matches(last); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    last = await attempt();
  }
  return last;
}

async function main(): Promise<void> {
  console.log(`\nSlice 0 verification — store “${SLUG}” on ${BASE}\n`);
  await clearAuthRateLimits();

  // ---------------------------------------------------------------------- 1 --
  console.log('1. Tenant resolution');
  {
    const unknown = await call('/auth/session', { host: 'admin.not-a-real-store.company.com' });
    check('unknown hostname is refused with STORE_NOT_FOUND', unknown.body?.code === 'STORE_NOT_FOUND', unknown.body);

    const real = await call('/auth/session', { host: `admin.${SLUG}.company.com` });
    check('real hostname resolves the store', real.body?.data?.store?.slug === SLUG, real.body);

    // The slug must never be taken from anything the caller can put in a body.
    const spoof = await call('/auth/session?slug=some-other-store', { host: `admin.${SLUG}.company.com` });
    check('a slug in the query string is ignored', spoof.body?.data?.store?.slug === SLUG, spoof.body);
  }

  // ---------------------------------------------------------------------- 2 --
  console.log('\n2. The provisioned credential is the only way in');
  {
    const { hashPassword } = await import('../src/lib/password');

    // Put the owner in the state company provisioning now leaves behind: the
    // password hash copied straight from the registered client account.
    await pool.query(
      `update store_admins
          set password_hash = $2, password_changed_at = now(), account_status = 'active',
              status = 'active', failed_login_count = 0, locked_until = null
        where lower(email) = $1`,
      [OWNER, await hashPassword(PASSWORD)],
    );
    await pool.query('delete from admin_password_reset_tokens');
    await pool.query('delete from admin_sessions');

    const before = await pool.query(
      `select role, role_key, account_status, password_hash from store_admins where lower(email) = $1`,
      [OWNER],
    );
    check(
      'provisioned owner is STORE_SUPER_ADMIN with an argon2id hash',
      before.rows[0]?.role_key === 'STORE_SUPER_ADMIN' &&
        String(before.rows[0]?.password_hash).startsWith('$argon2id$'),
      { ...before.rows[0], password_hash: String(before.rows[0]?.password_hash).slice(0, 16) },
    );

    // The account set-up flow is gone: there is no route left that can create a
    // password, so a store that arrives without one is a provisioning failure.
    for (const [label, path, method] of [
      ['request a set-up link', '/auth/claim', 'POST'],
      ['read a set-up token', '/auth/claim/sometoken', 'GET'],
      ['complete a set-up', '/auth/claim/complete', 'POST'],
    ] as const) {
      const gone = await call(path, { method, ...(method === 'POST' ? { body: '{}' } : {}) });
      check(`no endpoint to ${label}`, gone.status === 404, { status: gone.status, path });
    }

    await pool.query(`update store_admins set password_hash = null where lower(email) = $1`, [OWNER]);
    const noPassword = await call('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: OWNER, password: PASSWORD }),
    });
    check('an account with no password is refused as not ready', noPassword.body?.code === 'ACCOUNT_NOT_READY', noPassword.body);

    await pool.query(
      `update store_admins set password_hash = $2 where lower(email) = $1`,
      [OWNER, await hashPassword(PASSWORD)],
    );
  }

  // ---------------------------------------------------------------------- 3 --
  console.log('\n3. Sign-in with the registered credential');
  let ownerJar = newJar();
  {
    const login = await call('/auth/login', {
      method: 'POST',
      jar: ownerJar,
      body: JSON.stringify({ email: OWNER, password: PASSWORD }),
    });
    check('the registered password signs in', login.body?.data?.admin?.roleKey === 'STORE_SUPER_ADMIN', login.body);
    check('session cookie is set', ownerJar.cookies.has('store_admin_session'), [...ownerJar.cookies.keys()]);
    check('super admin holds every permission', login.body?.data?.admin?.permissions?.length === 36, {
      count: login.body?.data?.admin?.permissions?.length,
    });
    /*
     * The claim is about *where* the plan comes from, not which plan it is.
     *
     * Hardcoding `business` pinned this to the `abc-fashion` fixture and made
     * `--slug` — which the header of this file offers — fail on any other store
     * for a reason that has nothing to do with tenancy. What actually proves the
     * point is that a plan arrived at all and that the entitlements were resolved
     * from the same record: the tenant database has no plan column to serve
     * either from.
     */
    const store = login.body?.data?.store;
    check(
      'plan code comes from the control plane, not the template column',
      typeof store?.planCode === 'string' &&
        store.planCode.length > 0 &&
        store.planCode === store?.entitlements?.planCode,
      store,
    );

    const bad = await call('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: OWNER, password: 'WrongPassword2026' }),
    });
    check('a wrong password is refused', bad.body?.code === 'INVALID_CREDENTIALS', bad.body);
  }

  // ---------------------------------------------------------------------- 4 --
  console.log('\n4. Session hardening');
  {
    const session = await call('/auth/session', { jar: ownerJar });
    check('session endpoint works signed in', session.body?.data?.authenticated === true, session.body);

    const anonymous = await call('/auth/session');
    check(
      'session endpoint answers 200 signed out, never 401',
      anonymous.status === 200 && anonymous.body?.data?.authenticated === false,
      anonymous.body,
    );

    // A company-side cookie must be worthless here.
    const crossAudience = newJar();
    crossAudience.cookies.set('company_admin_session', 'a'.repeat(43));
    const cross = await call('/auth/permissions', { jar: crossAudience });
    check('a company-admin cookie cannot authenticate', cross.status === 401, cross.body);

    const forged = newJar();
    forged.cookies.set('store_admin_session', 'b'.repeat(43));
    const forgedResult = await call('/auth/permissions', { jar: forged });
    check('a forged store cookie is refused', forgedResult.body?.code === 'SESSION_EXPIRED', forgedResult.body);

    const stored = await pool.query(
      `select token_hash, tenant_ref, mfa_verified from admin_sessions where revoked_at is null order by created_at desc limit 1`,
    );
    check('session token is stored only as a hash', /^[0-9a-f]{64}$/.test(stored.rows[0]?.token_hash ?? ''), stored.rows[0]);
    check('session is pinned to the tenant', /^TNT-/.test(stored.rows[0]?.tenant_ref ?? ''), stored.rows[0]);
  }

  // ---------------------------------------------------------------------- 5 --
  console.log('\n5. One admin per store, and permission enforcement');
  {
    const { hashPassword } = await import('../src/lib/password');
    const hash = await hashPassword(STAFF_PASSWORD);

    /*
     * A store has exactly one admin account. No route creates one, so the check
     * that matters is the database's: try the insert directly, the way a stray
     * script or a future bug would, and watch it be refused.
     */
    await pool.query(`delete from store_admins where lower(email) = $1`, [STAFF]);
    let refused: string | null = null;
    try {
      await pool.query(
        `insert into store_admins (email, full_name, role, status, password_hash, role_key, account_status)
         values ($1, 'Limited Tester', 'staff', 'active', $2, 'STORE_ADMIN', 'active')`,
        [STAFF, hash],
      );
    } catch (error) {
      refused = (error as { constraint?: string }).constraint ?? (error as Error).message;
    }
    check('the database refuses a second admin account', refused === 'store_admins_singleton_key', refused);

    const count = await pool.query(`select count(*)::int as n from store_admins`);
    check('the store still has exactly one admin', count.rows[0]?.n === 1, count.rows[0]);

    // The guard is what matters, not the UI. Exercise it directly, with the
    // partial grant a limited role would carry.
    const { assertPermission } = await import('../src/services/permissions');
    const granted = new Set(['dashboard.view', 'products.view']);

    let denied = false;
    try {
      assertPermission(granted as Set<any>, 'products.create');
    } catch (error) {
      denied = (error as { code?: string }).code === 'PERMISSION_DENIED';
    }
    check('requirePermission refuses an ungranted key', denied);

    let allowed = true;
    try {
      assertPermission(granted as Set<any>, 'products.view');
    } catch {
      allowed = false;
    }
    check('requirePermission allows a granted key', allowed);
  }

  // ---------------------------------------------------------------------- 6 --
  console.log('\n6. Seeded catalogue');
  {
    const permissions = await pool.query(`select count(*)::int as n from admin_permissions`);
    check('36 permissions seeded', permissions.rows[0].n === 36, permissions.rows[0]);

    const roles = await pool.query(`select key, is_system from admin_roles order by key`);
    check('both system roles seeded', roles.rows.length === 2 && roles.rows.every((r: any) => r.is_system), roles.rows);

    const storefront = await pool.query(`select template_key, color_theme_key from storefront_settings`);
    check('storefront settings singleton exists', storefront.rows.length === 1, storefront.rows);
    check(
      'template key normalised to underscores',
      /^[a-z_]+$/.test(storefront.rows[0]?.template_key ?? '') && !storefront.rows[0]?.template_key.includes('-'),
      storefront.rows[0],
    );

    const version = await pool.query(`select value from platform_sync where key = 'commerce_schema_version'`);
    check('commerce schema version recorded', Boolean(version.rows[0]?.value?.version), version.rows[0]);
  }

  // ---------------------------------------------------------------------- 7 --
  console.log('\n7. Blocked stores');
  {
    const cacheKey = tenantCacheKey(SLUG);
    const cached = await redis.get(cacheKey);
    const record = cached ? JSON.parse(cached) : null;

    if (!record) {
      check('tenant record is cached for the blocking test', false);
    } else {
      // Poison the cache the plugin reads, exactly as a company-side suspension
      // would once it propagates. This exercises the real request path.
      for (const [label, patch, expected] of [
        ['suspended', { status: 'suspended' }, 'STORE_SUSPENDED'],
        ['expired', { status: 'expired' }, 'STORE_EXPIRED'],
        ['cancelled', { status: 'cancelled' }, 'STORE_EXPIRED'],
        ['store not ready', { storeStatus: 'creating' }, 'STORE_NOT_READY'],
      ] as const) {
        await redis.setex(cacheKey, 60, JSON.stringify({ ...record, ...patch }));
        // The API holds the record in process for a few seconds as well, so the
        // write has to be announced or the server keeps serving the copy it
        // already has and this checks nothing. Same channel the control plane
        // publishes on — and, like a real suspension, it arrives a moment later
        // rather than instantly, which is what `settle` waits for.
        await publishTenantInvalidation([cacheKey]);
        const blocked = await settle(() => call('/auth/session'), (r) => r.body?.code === expected);
        check(
          `a ${label} store is refused with ${expected}`,
          blocked.status === 403 && blocked.body?.code === expected,
          blocked.body,
        );
      }

      await redis.del(cacheKey);
      await publishTenantInvalidation([cacheKey]);
      const restored = await settle(() => call('/auth/session'), (r) => r.status === 200);
      check('the store works again once the block clears', restored.status === 200, restored.body);
    }
  }

  // ---------------------------------------------------------------------- 8 --
  console.log('\n8. Rate limiting');
  {
    await clearAuthRateLimits();
    let limited = false;
    for (let attempt = 0; attempt < 14 && !limited; attempt += 1) {
      const response = await call('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: `probe${attempt}@example.com`, password: 'NotTheRightOne1' }),
      });
      limited = response.status === 429;
    }
    check('repeated sign-in attempts from one IP are throttled', limited);
    await clearAuthRateLimits();
  }

  console.log(`\n${passed} passed, ${failed} failed.\n`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main()
  .catch((error: unknown) => {
    console.error('\nverification crashed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
    await closeRedis().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });

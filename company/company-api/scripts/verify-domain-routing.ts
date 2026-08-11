/**
 * Proves that a connected domain maps to the right store, on the right surface,
 * and stops mapping the moment it is disconnected.
 *
 *   npx tsx scripts/verify-domain-routing.ts
 *   npx tsx scripts/verify-domain-routing.ts --slug abc-fashion --port 4100
 *
 * Needs **client-api running on 4100** (`--port` to change it) and a store whose
 * `store_status` is `ready`. It plants verified domain rows in the control
 * database, asks the Commerce API to resolve them over HTTP, then removes them
 * again — pass `--keep` to leave them in place and inspect the result.
 *
 * Planting the rows directly is the point: DNS verification is what normally
 * flips `verified`, and no test can publish a TXT record for `example.test`.
 * Everything downstream of that flag — which tenant a hostname resolves to,
 * which surface it may serve, which browser origin may call it — is exercised
 * for real, against the running API.
 *
 * `node:http` rather than `fetch`, because `Host` is a forbidden header for
 * `fetch` and is silently dropped — and the hostname is the entire mechanism
 * under test.
 */
import { request as httpRequest } from 'node:http';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db/client';
import { domains, tenants } from '../src/db/schema/index';
import { config } from '../src/config/index';
import { generateToken } from '../src/lib/crypto';
import { invalidateTenantCache } from '../src/lib/tenant-cache';
import { closeRedis } from '../src/lib/redis';
import { platformSubdomain } from '../src/lib/utils';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const KEEP = process.argv.includes('--keep');
const PORT = Number(arg('port') ?? 4100);
const ADMIN_PATH = '/api/v1/admin/auth/session';
const LOGIN_PATH = '/api/v1/admin/auth/login';

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}

interface Response {
  status: number;
  body: any;
}

async function call(
  path: string,
  init: { host: string; method?: string; body?: string; origin?: string } = { host: 'localhost' },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port: PORT,
        path,
        method: init.method ?? 'GET',
        headers: {
          // The connection goes to loopback; this header is what names the store.
          host: init.host,
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(init.origin ? { origin: init.origin } : {}),
        },
      },
      (response) => {
        let text = '';
        response.on('data', (chunk) => (text += chunk));
        response.on('end', () => {
          let body: unknown = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch {
            body = text;
          }
          resolve({ status: response.statusCode ?? 0, body });
        });
      },
    );

    request.on('error', reject);
    if (init.body) request.write(init.body);
    request.end();
  });
}

async function plant(
  tenantId: string,
  domain: string,
  domainType: 'storefront_custom' | 'admin_custom',
  verified: boolean,
): Promise<void> {
  await db.delete(domains).where(eq(domains.domain, domain));
  await db.insert(domains).values({
    tenantId,
    domain,
    domainType,
    isPrimary: false,
    verified,
    status: verified ? 'active' : 'pending',
    verificationToken: generateToken(16),
    ...(verified ? { verifiedAt: new Date(), lastCheckedAt: new Date() } : {}),
  });
}

async function main(): Promise<void> {
  const slug = arg('slug');

  const rows = slug
    ? await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1)
    : await db.select().from(tenants).where(eq(tenants.storeStatus, 'ready')).limit(1);

  const tenant = rows[0];
  if (!tenant) {
    console.error(
      slug
        ? `\n  No tenant with slug "${slug}".\n`
        : '\n  No store with store_status = ready. Create one first (see create-client.ts).\n',
    );
    process.exitCode = 1;
    return;
  }

  if (tenant.storeStatus !== 'ready') {
    console.error(`\n  "${tenant.slug}" is not ready (store_status = ${tenant.storeStatus}).\n`);
    process.exitCode = 1;
    return;
  }

  // `.test` is reserved by RFC 6761 and can never resolve on the public
  // internet, so a leftover row cannot become a live hostname for anyone.
  const suffix = tenant.tenantRef.toLowerCase();
  const storefrontHost = `shop-${suffix}.verify.test`;
  const adminHost = `admin-${suffix}.verify.test`;
  const pendingHost = `pending-${suffix}.verify.test`;
  const unknownHost = `nobody-${suffix}.verify.test`;
  const platformHost = platformSubdomain(tenant.slug, config.urls.platformRootDomain);

  console.log(`\n  Domain routing for "${tenant.storeName}" (${tenant.slug})`);
  console.log(`  Commerce API on port ${PORT}\n`);

  const health = await call('/health', { host: 'localhost' }).catch(() => null);
  if (!health || health.status !== 200) {
    console.error(`  client-api is not answering on ${PORT}. Start it and try again.\n`);
    process.exitCode = 1;
    return;
  }

  try {
    await plant(tenant.id, storefrontHost, 'storefront_custom', true);
    await plant(tenant.id, adminHost, 'admin_custom', true);
    await plant(tenant.id, pendingHost, 'storefront_custom', false);
    await invalidateTenantCache(tenant.id, [unknownHost]);

    console.log('Resolution — a hostname finds its own store, and only its own');

    const viaPlatform = await call(ADMIN_PATH, { host: platformHost });
    check('the platform subdomain resolves the store', viaPlatform.status === 200, viaPlatform.body);
    check(
      'and names the right one',
      viaPlatform.body?.data?.store?.slug === tenant.slug,
      viaPlatform.body?.data?.store,
    );

    const viaAdminDomain = await call(ADMIN_PATH, { host: adminHost });
    check('a connected admin domain resolves the panel', viaAdminDomain.status === 200, viaAdminDomain.body);
    check(
      'to the same store',
      viaAdminDomain.body?.data?.store?.slug === tenant.slug,
      viaAdminDomain.body?.data?.store,
    );

    console.log('\nSurface — a storefront address is not an admin address');

    const storefrontOnAdmin = await call(ADMIN_PATH, { host: storefrontHost });
    check(
      'the storefront domain does not serve the admin API',
      storefrontOnAdmin.status === 404,
      storefrontOnAdmin.body,
    );
    check(
      'and says only that the address is not connected',
      storefrontOnAdmin.body?.code === 'STORE_NOT_FOUND',
      storefrontOnAdmin.body?.code,
    );

    console.log('\nProof of ownership — an unverified or unknown host resolves to nothing');

    const unverified = await call(ADMIN_PATH, { host: pendingHost });
    check('an unverified domain resolves to no store', unverified.status === 404, unverified.body);

    const unknown = await call(ADMIN_PATH, { host: unknownHost });
    check('an unconnected hostname resolves to no store', unknown.status === 404, unknown.body);

    console.log('\nOrigin — the browser origin has to match the surface too');

    const badCredentials = JSON.stringify({ email: 'nobody@example.test', password: 'not-the-password' });

    const fromAdminOrigin = await call(LOGIN_PATH, {
      host: adminHost,
      method: 'POST',
      body: badCredentials,
      origin: `https://${adminHost}`,
    });
    check(
      'the admin domain may post to the admin API',
      fromAdminOrigin.status !== 403,
      { status: fromAdminOrigin.status, code: fromAdminOrigin.body?.code },
    );
    check(
      'and is refused on the credentials, not on the origin',
      fromAdminOrigin.body?.code === 'INVALID_CREDENTIALS',
      fromAdminOrigin.body?.code,
    );

    const fromStorefrontOrigin = await call(LOGIN_PATH, {
      host: adminHost,
      method: 'POST',
      body: badCredentials,
      origin: `https://${storefrontHost}`,
    });
    check(
      'the storefront origin may not post to the admin API',
      fromStorefrontOrigin.status === 403,
      { status: fromStorefrontOrigin.status, code: fromStorefrontOrigin.body?.code },
    );

    const fromStrangerOrigin = await call(LOGIN_PATH, {
      host: adminHost,
      method: 'POST',
      body: badCredentials,
      origin: 'https://attacker.example.test',
    });
    check(
      'an unrelated origin may not post to the admin API',
      fromStrangerOrigin.status === 403,
      { status: fromStrangerOrigin.status, code: fromStrangerOrigin.body?.code },
    );

    console.log('\nDisconnection — removing a domain takes effect at once, not when a cache expires');

    await db.delete(domains).where(and(eq(domains.tenantId, tenant.id), eq(domains.domain, adminHost)));
    await invalidateTenantCache(tenant.id, [adminHost]);

    const afterRemoval = await call(ADMIN_PATH, { host: adminHost });
    check('the removed domain no longer resolves', afterRemoval.status === 404, afterRemoval.body);
  } finally {
    if (KEEP) {
      console.log(`\n  --keep: left ${storefrontHost} and ${pendingHost} connected to ${tenant.slug}.`);
    } else {
      for (const host of [storefrontHost, adminHost, pendingHost]) {
        await db.delete(domains).where(eq(domains.domain, host));
      }
      await invalidateTenantCache(tenant.id, [storefrontHost, adminHost, pendingHost]);
      console.log('\nCleaned up…');
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });

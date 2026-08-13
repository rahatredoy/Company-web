/**
 * Creates ready-to-use test stores by driving the real signup flow.
 *
 *   npx tsx scripts/create-test-clients.ts            # create (or recreate) both
 *   npx tsx scripts/create-test-clients.ts --drop     # remove them again
 *
 * Unlike `verify-signup-flow.ts` this keeps what it builds: the point is a
 * working login for the store admin panel, not an assertion. Everything still
 * goes through the live API — plan, payment webhook, website, admin panel and
 * passcode — so the stores are indistinguishable from ones signed up by hand.
 *
 * The emailed passcode is the one thing a script cannot read, so a known code is
 * written over it the same way the API writes it (see `plantOtp`); the verify
 * endpoint then runs over a genuine challenge.
 *
 * Re-running drops the accounts and their tenant databases first, so the
 * credentials below are always the ones that work.
 */
import pg from 'pg';
import { eq, inArray } from 'drizzle-orm';
import { db, pool } from '../src/db/client';
import { clientAccounts, clientSessions, plans, tenants } from '../src/db/schema/index';
import { config } from '../src/config/index';
import { locateShard, shardClientOptions } from '../src/services/tenant-shards';
import { generateToken, sha256 } from '../src/lib/crypto';
import { hashOtp } from '../src/lib/otp';
import { hashPassword } from '../src/lib/password';
import { addHours } from '../src/lib/utils';

const API = config.api.publicUrl.replace(/\/$/, '');
/** Planted in place of the emailed passcode — see `plantOtp`. */
const OTP_CODE = '123456';
const DROP_ONLY = process.argv.includes('--drop');

interface TestClient {
  /** SaaS account — signs in at company-web (3000) to manage plan and billing. */
  account: { fullName: string; email: string; password: string; phone: string };
  /** Store admin panel — signs in at client-admin (3002). Deliberately separate. */
  storeAdmin: { email: string; password: string };
  store: { name: string; slug: string };
  /** The trial is a plan of its own: taking it authorises a card, buying any other plan charges it. */
  planCode: string;
}

const CLIENTS: TestClient[] = [
  {
    account: {
      fullName: 'Test Client One',
      email: 'testclient1@example.com',
      password: 'TestClient1@2026',
      phone: '+8801700000001',
    },
    storeAdmin: { email: 'admin1@teststore.com', password: 'StoreAdmin1@2026' },
    store: { name: 'Test Store One', slug: 'test-store-one' },
    planCode: 'free-trial',
  },
  {
    account: {
      fullName: 'Test Client Two',
      email: 'testclient2@example.com',
      password: 'TestClient2@2026',
      phone: '+8801700000002',
    },
    storeAdmin: { email: 'admin2@teststore.com', password: 'StoreAdmin2@2026' },
    store: { name: 'Test Store Two', slug: 'test-store-two' },
    planCode: 'professional',
  },
];

async function call(
  path: string,
  init: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<{ status: number; body: any }> {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      accept: 'application/json',
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    redirect: 'manual',
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}

function fail(step: string, result: { status: number; body: any }): never {
  console.error(`\n  ${step} failed (HTTP ${result.status}): ${JSON.stringify(result.body)}`);
  throw new Error(step);
}

async function plantOtp(slug: string): Promise<void> {
  await db
    .update(tenants)
    .set({
      storeAdminOtpHash: hashOtp(OTP_CODE),
      storeAdminOtpExpiresAt: new Date(Date.now() + 10 * 60_000),
      storeAdminOtpAttempts: 0,
    })
    .where(eq(tenants.slug, slug));
}

async function dropTenantDatabase(databaseName: string): Promise<void> {
  // The fixtures are rebuilt from scratch each run, so the shard they landed on
  // last time has to be found rather than assumed.
  const shard = await locateShard(databaseName);
  if (!shard) return;

  const admin = new pg.Client(shardClientOptions(shard, 'postgres'));
  await admin.connect();
  try {
    await admin.query(`drop database if exists "${databaseName}" with (force)`);
  } finally {
    await admin.end().catch(() => undefined);
  }
}

/**
 * Removes the test accounts and their tenant databases.
 *
 * Only rows owned by the emails above are touched, and a slug held by anybody
 * else is left alone and reported — a test fixture must never be able to delete
 * a real store that happens to share a name.
 */
async function cleanup(): Promise<void> {
  const emails = CLIENTS.map((client) => client.account.email);
  const slugs = CLIENTS.map((client) => client.store.slug);

  const owned = await db
    .select({ slug: tenants.slug, databaseName: tenants.databaseName, email: clientAccounts.email })
    .from(tenants)
    .innerJoin(clientAccounts, eq(tenants.clientAccountId, clientAccounts.id))
    .where(inArray(clientAccounts.email, emails));

  const foreign = await db
    .select({ slug: tenants.slug, email: clientAccounts.email })
    .from(tenants)
    .innerJoin(clientAccounts, eq(tenants.clientAccountId, clientAccounts.id))
    .where(inArray(tenants.slug, slugs));

  for (const row of foreign) {
    if (emails.includes(row.email)) continue;
    throw new Error(
      `The address "${row.slug}" already belongs to ${row.email}. ` +
        `Pick a different slug in this script rather than deleting somebody else's store.`,
    );
  }

  if (owned.length === 0) return;

  await db.delete(clientAccounts).where(inArray(clientAccounts.email, emails));

  for (const row of owned) {
    if (!row.databaseName) continue;
    console.log(`  dropped database ${row.databaseName}`);
    await dropTenantDatabase(row.databaseName);
  }
}

async function createClient(client: TestClient): Promise<{ slug: string; adminUrl: string; storeUrl: string }> {
  const { account, storeAdmin, store } = client;
  console.log(`\n▸ ${store.name} (${store.slug})`);

  const planRows = await db.select().from(plans).where(eq(plans.code, client.planCode)).limit(1);
  const plan = planRows[0];
  if (!plan) throw new Error(`Plan "${client.planCode}" not found. Run: npm run db:seed`);

  // Registration itself sends a passcode that only exists in an email, so the
  // verified account and its session are written directly — everything after
  // this point goes through the API exactly as the browser would call it.
  const [created] = await db
    .insert(clientAccounts)
    .values({
      fullName: account.fullName,
      email: account.email,
      phone: account.phone,
      passwordHash: await hashPassword(account.password),
      status: 'active',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    })
    .returning({ id: clientAccounts.id });

  const token = generateToken(32);
  await db.insert(clientSessions).values({
    clientAccountId: created!.id,
    tokenHash: sha256(token),
    otpVerified: true,
    expiresAt: addHours(new Date(), 4),
  });
  const cookie = `company_client_session=${token}`;
  console.log('  account created and verified');

  const chosen = await call('/api/v1/client/onboarding/plan', {
    method: 'POST',
    cookie,
    body: { planId: plan.id, billingCycle: 'monthly' },
  });
  if (chosen.status !== 200) fail('plan', chosen);
  console.log(`  plan ${plan.code} (${plan.isTrial ? 'trial' : 'purchase'})`);

  const checkout = await call('/api/v1/client/onboarding/payment', { method: 'POST', cookie });
  if (checkout.status !== 200) fail('payment', checkout);

  const checkoutUrl: string | null = checkout.body?.data?.checkoutUrl ?? null;
  if (checkoutUrl) {
    // The mock gateway signs and posts a real webhook back, so the settle path
    // runs exactly as it would in production.
    await fetch(checkoutUrl, { redirect: 'manual' });
  }

  const afterPayment = await call('/api/v1/client/onboarding', { cookie });
  if (afterPayment.body?.data?.payment?.settled !== true) fail('payment settle', afterPayment);
  console.log('  payment settled');

  const website = await call('/api/v1/client/onboarding/website', {
    method: 'POST',
    cookie,
    body: { businessName: store.name, slug: store.slug },
  });
  if (website.status !== 200) fail('website setup', website);
  console.log('  website configured');

  const panel = await call('/api/v1/client/onboarding/admin-panel', {
    method: 'POST',
    cookie,
    body: { adminEmail: storeAdmin.email, adminPassword: storeAdmin.password },
  });
  if (panel.status !== 200) fail('admin panel setup', panel);
  console.log(`  admin panel staged for ${storeAdmin.email}`);

  await plantOtp(store.slug);
  const verified = await call('/api/v1/client/onboarding/admin-panel/verify', {
    method: 'POST',
    cookie,
    body: { code: OTP_CODE },
  });
  if (verified.status !== 200) fail('passcode', verified);
  console.log('  passcode confirmed, provisioning started');

  // Provisioning may be on the worker or inline; either way it is asynchronous.
  let tenant = (await db.select().from(tenants).where(eq(tenants.slug, store.slug)).limit(1))[0];
  for (let attempt = 0; attempt < 60 && tenant?.storeStatus !== 'ready'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    tenant = (await db.select().from(tenants).where(eq(tenants.slug, store.slug)).limit(1))[0];
  }

  if (tenant?.storeStatus !== 'ready') {
    throw new Error(`Store did not become ready (status: ${tenant?.storeStatus}). Check the API log.`);
  }
  console.log(`  store ready — database ${tenant.databaseName}`);

  // The sessions above were only needed to drive setup; a real sign-in issues
  // its own, and leaving them behind would be a live cookie in a script's log.
  await db.delete(clientSessions).where(eq(clientSessions.clientAccountId, created!.id));

  return {
    slug: store.slug,
    adminUrl: `http://${store.slug}.localhost:3002`,
    storeUrl: `http://${store.slug}.localhost:3003`,
  };
}

async function main(): Promise<void> {
  const health = await call('/health').catch(() => ({ status: 0, body: null }));
  if (health.status !== 200) {
    console.error(`company-api is not answering on ${API}. Start it with: npm run dev`);
    process.exit(1);
  }

  console.log('\nRemoving any previous run…');
  await cleanup();

  if (DROP_ONLY) {
    console.log('\nDone — test clients removed.\n');
    return;
  }

  const results: Array<{ client: TestClient; urls: Awaited<ReturnType<typeof createClient>> }> = [];
  for (const client of CLIENTS) {
    results.push({ client, urls: await createClient(client) });
  }

  console.log('\n' + '='.repeat(72));
  console.log('  TEST CREDENTIALS');
  console.log('='.repeat(72));

  for (const { client, urls } of results) {
    console.log(`\n  ${client.store.name}  —  plan ${client.planCode}`);
    console.log(`  ${'-'.repeat(68)}`);
    console.log('  Store admin panel   http://localhost:3002/sign-in');
    console.log(`                      ${urls.adminUrl}/sign-in`);
    console.log(`    email             ${client.storeAdmin.email}`);
    console.log(`    password          ${client.storeAdmin.password}`);
    console.log(`  Storefront          ${urls.storeUrl}`);
    console.log('  SaaS dashboard      http://localhost:3000/sign-in');
    console.log(`    email             ${client.account.email}`);
    console.log(`    password          ${client.account.password}`);
  }

  console.log(
    '\n  Note: http://localhost:3002 and :3003 without a subdomain always open the\n' +
      `  store named by NEXT_PUBLIC_DEV_STORE_SLUG (currently "${process.env.NEXT_PUBLIC_DEV_STORE_SLUG ?? 'abc-fashion'}"\n` +
      '  in client-admin/.env and client-store/.env, and DEV_STORE_SLUG in client-api/.env).\n' +
      '  Use the <slug>.localhost URLs above, or point those three at one of these slugs.\n',
  );
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });

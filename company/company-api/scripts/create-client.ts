/**
 * Creates — or repairs — one client and its store, so a known email and password
 * open the store admin panel.
 *
 *   npx tsx scripts/create-client.ts --email owner@example.com --password 'Secret@2026' --store "Riyad Store"
 *   npx tsx scripts/create-client.ts --email owner@example.com --password 'Secret@2026' --slug riyad-store --plan business --purchase
 *
 * Unlike `create-test-clients.ts`, which drops and rebuilds two fixed fixtures,
 * this deletes nothing and can be re-run: an account that already has a store
 * keeps it, and only what the printed credentials need is written. Everything
 * that can go through the live API does — plan, payment webhook, website, admin
 * panel and passcode — so the store is indistinguishable from one signed up by
 * hand.
 *
 * Three things no browser flow can do are done directly, and only these:
 *   - the account is created already verified, because registration proves the
 *     address with a passcode that exists only in an inbox;
 *   - that same passcode is planted for the admin-panel step exactly the way the
 *     API writes it, so the verify endpoint runs over a genuine challenge;
 *   - the store admin's login is written into the tenant database, because that
 *     is where the panel's credential lives once provisioning has copied it
 *     across, and nothing resets it from outside the client dashboard.
 *
 * Provisioning is normally the BullMQ worker's job. The worker is a separate
 * process that may not be running (`npm run worker:dev`), so if the store has
 * not been built shortly after the passcode lands, this runs it inline — the
 * same function the worker calls.
 */
import { eq } from 'drizzle-orm';
import type pg from 'pg';
import { config } from '../src/config/index';
import { db, pool } from '../src/db/client';
import { clientAccounts, clientSessions, plans, tenants } from '../src/db/schema/index';
import { tenantAdminConnection } from '../src/db/tenant-connection';
import { generateToken, sha256 } from '../src/lib/crypto';
import { hashOtp } from '../src/lib/otp';
import { hashPassword } from '../src/lib/password';
import { addHours } from '../src/lib/utils';
import { runProvisioning } from '../src/services/provisioning';

const API = config.api.publicUrl.replace(/\/$/, '');
/** Planted in place of the emailed passcode — see `plantOtp`. */
const OTP_CODE = '123456';
/** How long to wait for the worker before provisioning inline. */
const WORKER_GRACE_SECONDS = 15;
const PROVISION_TIMEOUT_SECONDS = 120;

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  const value = index > -1 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40);
}

interface Options {
  email: string;
  password: string;
  storeAdminEmail: string;
  storeAdminPassword: string;
  fullName: string;
  storeName: string;
  slug: string;
  /** Which plan to take — the free trial is a plan like any other now. */
  planCode: string;
}

function readOptions(): Options | null {
  const email = arg('email')?.trim().toLowerCase();
  const password = arg('password');

  if (!email || !password) {
    console.error(
      'Usage: --email <address> --password <password> [--store "Store Name"] [--slug store-name]\n' +
        '       [--name "Full Name"] [--plan free-trial|starter|business|professional|enterprise] [--purchase]\n' +
        '       [--store-admin-email <address>] [--store-admin-password <password>]\n\n' +
        '  The trial is a plan of its own and is the default. --purchase buys a real\n' +
        '  plan (business, unless --plan says otherwise) and charges it now.\n' +
        '  The store admin login defaults to the same email and password as the SaaS\n' +
        '  account; they are separate credentials that simply start out identical.',
    );
    return null;
  }

  // The API enforces this on the real form. A back door that accepts a weaker
  // password than the front door is not a back door worth having.
  const storeAdminPassword = arg('store-admin-password') ?? password;
  const rules: Array<[RegExp, string]> = [
    [/[a-z]/, 'one lowercase letter'],
    [/[A-Z]/, 'one uppercase letter'],
    [/\d/, 'one number'],
    [/[^A-Za-z0-9]/, 'one symbol'],
  ];
  const missing = rules.filter(([re]) => !re.test(storeAdminPassword)).map(([, label]) => label);
  if (storeAdminPassword.length < 10 || missing.length > 0) {
    console.error(
      `The store admin password must be at least 10 characters and include ${['one lowercase letter', 'one uppercase letter', 'one number', 'one symbol'].join(', ')}.` +
        (missing.length ? `\nMissing: ${missing.join(', ')}.` : ''),
    );
    return null;
  }

  const storeName = arg('store')?.trim() || `${email.split('@')[0]} store`;
  const slug = slugify(arg('slug') ?? storeName);

  return {
    email,
    password,
    storeAdminEmail: (arg('store-admin-email') ?? email).trim().toLowerCase(),
    storeAdminPassword,
    fullName: arg('name')?.trim() || email.split('@')[0]!,
    storeName,
    slug,
    planCode: arg('plan') ?? (process.argv.includes('--purchase') ? 'business' : 'free-trial'),
  };
}

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function tenantOf(accountId: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.clientAccountId, accountId)).limit(1);
  return rows[0] ?? null;
}

/**
 * The SaaS account. An existing one keeps its store and its history — only the
 * password is moved to the one being printed, and only because an account whose
 * password nobody knows is the problem this script exists to fix.
 */
async function ensureAccount(options: Options): Promise<{ id: string; created: boolean }> {
  const existing = await db
    .select({ id: clientAccounts.id })
    .from(clientAccounts)
    .where(eq(clientAccounts.email, options.email))
    .limit(1);

  const passwordHash = await hashPassword(options.password);

  if (existing[0]) {
    await db
      .update(clientAccounts)
      .set({
        passwordHash,
        passwordChangedAt: new Date(),
        status: 'active',
        emailVerified: true,
        emailVerifiedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: new Date(),
      })
      .where(eq(clientAccounts.id, existing[0].id));

    console.log('  account already existed — password reset, account active');
    return { id: existing[0].id, created: false };
  }

  const [created] = await db
    .insert(clientAccounts)
    .values({
      fullName: options.fullName,
      email: options.email,
      passwordHash,
      status: 'active',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    })
    .returning({ id: clientAccounts.id });

  console.log('  account created and verified');
  return { id: created!.id, created: true };
}

/** A short-lived signed-in session, used only to drive the setup calls below. */
async function openSession(accountId: string): Promise<string> {
  const token = generateToken(32);
  await db.insert(clientSessions).values({
    clientAccountId: accountId,
    tokenHash: sha256(token),
    otpVerified: true,
    expiresAt: addHours(new Date(), 1),
  });
  return `company_client_session=${token}`;
}

async function plantOtp(tenantId: string): Promise<void> {
  await db
    .update(tenants)
    .set({
      storeAdminOtpPurpose: 'admin_panel_setup',
      storeAdminOtpHash: hashOtp(OTP_CODE),
      storeAdminOtpExpiresAt: new Date(Date.now() + 10 * 60_000),
      storeAdminOtpAttempts: 0,
    })
    .where(eq(tenants.id, tenantId));
}

/**
 * Walks the onboarding flow from wherever this account already is. Every step
 * checks the API's own view of what is done, so a half-finished signup resumes
 * instead of starting over — and a store that is already live is left alone.
 */
async function ensureStore(options: Options, accountId: string, cookie: string): Promise<void> {
  const existing = await tenantOf(accountId);
  if (existing?.storeStatus === 'ready') {
    console.log(`  store already live — ${existing.storeName} (${existing.slug})`);
    return;
  }

  const state = async () => {
    const result = await call('/api/v1/client/onboarding', { cookie });
    if (result.status !== 200) fail('onboarding state', result);
    return result.body.data;
  };

  let current = await state();

  // `payment.required` is true whenever a subscription exists, so its absence is
  // how "no plan chosen yet" is read here.
  if (!current.payment.required) {
    const planRows = await db.select().from(plans).where(eq(plans.code, options.planCode)).limit(1);
    const plan = planRows[0];
    if (!plan) throw new Error(`Plan "${options.planCode}" not found. Run: npm run db:seed`);

    const chosen = await call('/api/v1/client/onboarding/plan', {
      method: 'POST',
      cookie,
      body: { planId: plan.id, billingCycle: 'monthly' },
    });
    if (chosen.status !== 200) fail('plan', chosen);
    console.log(`  plan ${plan.code} (${plan.isTrial ? 'trial' : 'purchase'})`);
    current = await state();
  }

  if (!current.payment.settled) {
    const checkout = await call('/api/v1/client/onboarding/payment', { method: 'POST', cookie });
    if (checkout.status !== 200) fail('payment', checkout);

    // The mock gateway signs and posts a real webhook back, so settling runs
    // exactly as it would in production — nothing here marks the bill paid.
    const checkoutUrl: string | null = checkout.body?.data?.checkoutUrl ?? null;
    if (checkoutUrl) await fetch(checkoutUrl, { redirect: 'manual' });

    current = await state();
    if (current.payment.settled !== true) fail('payment settle', { status: 200, body: current });
    console.log('  payment settled');
  }

  if (!current.website.configured) {
    const website = await call('/api/v1/client/onboarding/website', {
      method: 'POST',
      cookie,
      body: { businessName: options.storeName, slug: options.slug },
    });
    if (website.status !== 200) fail('website setup', website);
    console.log(`  website configured — ${options.storeName} (${options.slug})`);
    current = await state();
  } else if (current.website.slug !== options.slug) {
    console.log(
      `  website already configured as "${current.website.slug}" — keeping it (asked for "${options.slug}")`,
    );
  }

  if (!current.adminPanel.configured) {
    const panel = await call('/api/v1/client/onboarding/admin-panel', {
      method: 'POST',
      cookie,
      body: { adminEmail: options.storeAdminEmail, adminPassword: options.storeAdminPassword },
    });
    if (panel.status !== 200) fail('admin panel setup', panel);
    console.log(`  admin panel staged for ${options.storeAdminEmail}`);
    current = await state();
  }

  if (!current.adminPanel.verified) {
    const tenant = await tenantOf(accountId);
    if (!tenant) throw new Error('No store record to verify — the plan step did not create one.');

    await plantOtp(tenant.id);
    const verified = await call('/api/v1/client/onboarding/admin-panel/verify', {
      method: 'POST',
      cookie,
      body: { code: OTP_CODE },
    });
    if (verified.status !== 200) fail('passcode', verified);
    console.log('  passcode confirmed, provisioning queued');
  }

  await waitForStore(accountId);
}

async function waitForStore(accountId: string): Promise<void> {
  for (let second = 0; second < PROVISION_TIMEOUT_SECONDS; second += 1) {
    const tenant = await tenantOf(accountId);
    if (tenant?.storeStatus === 'ready') {
      console.log(`  store ready — database ${tenant.databaseName}`);
      return;
    }

    // No worker running is the normal case for a local dev machine, so take the
    // job over rather than waiting out the timeout for one that never starts.
    if (second === WORKER_GRACE_SECONDS && tenant && tenant.storeStatus !== 'ready') {
      console.log('  no worker picked it up — provisioning inline');
      await runProvisioning(tenant.id);
      continue;
    }

    await sleep(1000);
  }

  const tenant = await tenantOf(accountId);
  throw new Error(`Store did not become ready (status: ${tenant?.storeStatus}). Check the API log.`);
}

/**
 * Columns a freshly provisioned tenant database does not have yet.
 *
 * Company provisioning seeds `store_admins` with the five columns it needs
 * (`email`, `full_name`, `role`, `status`, `password_hash`); everything else —
 * the role key, the lock counters, MFA — is added by `client-api`'s own
 * migrations the first time that API opens the store. A store built moments ago
 * has not been opened yet, so which columns exist has to be read, not assumed.
 */
const OPTIONAL_ADMIN_COLUMNS: Record<string, string> = {
  account_status: `'active'`,
  failed_login_count: '0',
  locked_until: 'null',
  password_changed_at: 'now()',
};

async function existingColumns(client: pg.Client, table: string): Promise<Set<string>> {
  const { rows } = await client.query(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`,
    [table],
  );
  return new Set(rows.map((row) => row.column_name as string));
}

/**
 * Writes the panel login into the store's own database.
 *
 * Provisioning already put it there for a store built by this run, so this is
 * what makes the script idempotent: re-running it against a live store — one
 * whose password nobody remembers — restores the credential being printed
 * instead of failing. There is exactly one row (`store_admins_singleton_key`),
 * so it is updated by identity rather than by address, which is also how an
 * address that has drifted from the control plane is brought back in line.
 *
 * Every open panel session dies with the change, exactly as a real password
 * reset does.
 */
async function applyPanelLogin(
  options: Options,
  accountId: string,
): Promise<{ email: string; roleKey: string | null; mfaEnabled: boolean }> {
  const tenant = await tenantOf(accountId);
  if (!tenant?.databaseName) throw new Error('The store has no database yet.');

  const passwordHash = await hashPassword(options.storeAdminPassword);
  const client = tenantAdminConnection(tenant.databaseName);
  await client.connect();

  try {
    const columns = await existingColumns(client, 'store_admins');
    const assignments = [
      'email = $1',
      'password_hash = $2',
      `status = 'active'`,
      'updated_at = now()',
      ...Object.entries(OPTIONAL_ADMIN_COLUMNS)
        .filter(([column]) => columns.has(column))
        .map(([column, value]) => `${column} = ${value}`),
    ];
    const extras = ['role_key', 'mfa_enabled'].filter((column) => columns.has(column));

    const { rows } = await client.query(
      `update store_admins
          set ${assignments.join(',\n              ')}
        where id = (select id from store_admins order by created_at limit 1)
        returning id, email${extras.length ? `, ${extras.join(', ')}` : ''}`,
      [options.storeAdminEmail, passwordHash],
    );

    const admin = rows[0];
    if (!admin) throw new Error(`No store admin row in ${tenant.databaseName}.`);

    // The session table arrives with client-api's migrations too, so a store it
    // has never opened simply has nothing to revoke.
    const sessionTable = await client.query(`select to_regclass('public.admin_sessions') as name`);
    if (sessionTable.rows[0]?.name) {
      await client.query('delete from admin_sessions where admin_id = $1', [admin.id]);
    }

    // The control plane records which address opens the panel; it is what the
    // dashboard's own password reset mails a code to, so it has to agree.
    await db
      .update(tenants)
      .set({ storeAdminEmail: options.storeAdminEmail, storeAdminPasswordHash: null, updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));

    return { email: admin.email, roleKey: admin.role_key ?? null, mfaEnabled: admin.mfa_enabled === true };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const options = readOptions();
  if (!options) {
    process.exitCode = 1;
    return;
  }

  const health = await call('/health').catch(() => ({ status: 0, body: null }));
  if (health.status !== 200) {
    console.error(`company-api is not answering on ${API}. Start it with: npm run dev`);
    process.exitCode = 1;
    return;
  }

  console.log(`\n▸ ${options.email}`);

  const account = await ensureAccount(options);
  const cookie = await openSession(account.id);

  try {
    await ensureStore(options, account.id, cookie);
  } finally {
    // The session existed only to drive setup; a real sign-in issues its own,
    // and leaving it behind would be a live cookie in a script's log.
    await db.delete(clientSessions).where(eq(clientSessions.clientAccountId, account.id));
  }

  const panel = await applyPanelLogin(options, account.id);
  const tenant = (await tenantOf(account.id))!;

  console.log('\n' + '='.repeat(72));
  console.log(`  ${tenant.storeName}  —  ${tenant.slug}`);
  console.log('='.repeat(72));
  console.log('\n  Store admin panel   http://' + tenant.slug + '.localhost:3002/sign-in');
  console.log(`    email             ${panel.email}`);
  console.log(`    password          ${options.storeAdminPassword}`);
  // A store this script just built has not been opened by client-api yet, so its
  // role key is still the provisioned 'owner' and is normalised on first sign-in.
  console.log(
    `    role              ${panel.roleKey ?? 'owner (normalised on first sign-in)'}` +
      `${panel.mfaEnabled ? '   —   MFA IS ON, a code is required as well' : ''}`,
  );
  console.log('\n  SaaS dashboard      http://localhost:3000/sign-in');
  console.log(`    email             ${options.email}`);
  console.log(`    password          ${options.password}`);
  console.log(`\n  Storefront          http://${tenant.slug}.localhost:3003`);
  console.log(
    `\n  http://localhost:3002 without a subdomain always opens the store named by\n` +
      `  DEV_STORE_SLUG (client-api/.env) and NEXT_PUBLIC_DEV_STORE_SLUG (client-admin\n` +
      `  and client-store .env). Use the address above, or point those at "${tenant.slug}".\n`,
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

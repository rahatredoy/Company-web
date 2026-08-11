/**
 * End-to-end check of signup: billing setup → pay the bill → store.
 *
 * Billing is not optional and not conditional: a trial and a free plan are both
 * billed 0.00, both go through the gateway, and both leave an invoice behind.
 * The checks below assert that rather than skipping a plan that costs nothing.
 *
 * There is no test runner on this platform, so this drives the *live* API over
 * HTTP with a real session cookie and then reads the tenant database directly to
 * confirm the store admin login it created. Run the API (and its worker, or
 * accept the inline fallback) first:
 *
 *   npx tsx scripts/verify-signup-flow.ts
 *
 * It creates a throwaway account, provisions a real tenant database, and drops
 * both again at the end unless --keep is passed.
 */
import pg from 'pg';
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../src/db/client';
import { clientAccounts, clientSessions, plans, subscriptions, tenants } from '../src/db/schema/index';
import { config } from '../src/config/index';
import { generateToken, sha256 } from '../src/lib/crypto';
import { hashOtp } from '../src/lib/otp';
import { hashPassword, verifyPassword } from '../src/lib/password';
import { addHours } from '../src/lib/utils';

const API = config.api.publicUrl.replace(/\/$/, '');
const EMAIL = 'signup-flow-check@example.test';
const ADMIN_EMAIL = 'store-owner-check@example.test';
const ADMIN_PASSWORD = 'Str0ng-Store-Pass!';
const SLUG = 'signup-flow-check';
/** Planted in place of the emailed passcode — see `plantOtp`. */
const OTP_CODE = '123456';
const KEEP = process.argv.includes('--keep');
/** `--pay-now` runs the same flow as a straight purchase instead of a trial. */
const USE_TRIAL = !process.argv.includes('--pay-now');

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
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

/**
 * Replaces the passcode the API just emailed with a known one.
 *
 * The real code exists only in that email — reading it back would mean parsing
 * the log or the mail provider, and neither is what this script is checking. The
 * hash is written the same way the API writes it, so the verify endpoint runs
 * over a genuine challenge; only the digits are ours.
 */
async function plantOtp(): Promise<void> {
  await db
    .update(tenants)
    .set({
      storeAdminOtpHash: hashOtp(OTP_CODE),
      storeAdminOtpExpiresAt: new Date(Date.now() + 10 * 60_000),
      storeAdminOtpAttempts: 0,
    })
    .where(eq(tenants.slug, SLUG));
}

async function cleanup(): Promise<void> {
  const tenantRows = await db
    .select({ databaseName: tenants.databaseName })
    .from(tenants)
    .innerJoin(clientAccounts, eq(tenants.clientAccountId, clientAccounts.id))
    .where(eq(clientAccounts.email, EMAIL));

  await db.delete(clientAccounts).where(eq(clientAccounts.email, EMAIL));

  for (const row of tenantRows) {
    if (!row.databaseName) continue;
    const admin = new pg.Client({
      host: config.tenantDb.host,
      port: config.tenantDb.port,
      user: config.tenantDb.user,
      password: config.tenantDb.password,
      database: 'postgres',
      ssl: config.tenantDb.ssl ? { rejectUnauthorized: false } : undefined,
    });
    await admin.connect();
    try {
      await admin.query(`drop database if exists "${row.databaseName}" with (force)`);
    } finally {
      await admin.end().catch(() => undefined);
    }
  }
}

async function main(): Promise<void> {
  const health = await call('/health').catch(() => ({ status: 0, body: null }));
  if (health.status !== 200) {
    console.error(`The API is not answering on ${API}. Start it with: npm run dev`);
    process.exit(1);
  }

  await cleanup();

  // The trial is a plan now, not a flag on one: a trial run buys the trial plan
  // and a purchase run buys anything else. Both are billed, and the plan's own
  // price is what the bill has to come to either way.
  const planRows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.status, 'active'), eq(plans.isTrial, USE_TRIAL)))
    .limit(1);
  const plan = planRows[0];
  if (!plan) {
    console.error(
      USE_TRIAL
        ? 'No active free-trial plan found. Run: npm run db:seed'
        : 'No active paid plan found. Run: npm run db:seed',
    );
    process.exit(1);
  }

  // A verified account with a live session, created directly — sign-in itself is
  // covered elsewhere and its emailed passcode is not readable from a script.
  const [account] = await db
    .insert(clientAccounts)
    .values({
      fullName: 'Signup Flow Check',
      email: EMAIL,
      phone: '+8801700000000',
      passwordHash: await hashPassword('Account-Pass-9!'),
      status: 'active',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    })
    .returning({ id: clientAccounts.id });

  const token = generateToken(32);
  await db.insert(clientSessions).values({
    clientAccountId: account!.id,
    tokenHash: sha256(token),
    otpVerified: true,
    expiresAt: addHours(new Date(), 2),
  });
  const cookie = `company_client_session=${token}`;

  console.log('\nStep 1 — a fresh account starts at the plan step');
  const initial = await call('/api/v1/client/onboarding', { cookie });
  check('state loads', initial.status === 200, initial.body);
  check('step is "plan"', initial.body?.data?.step === 'plan', initial.body?.data?.step);
  check('no store yet', initial.body?.data?.store_view === null);

  console.log('\nStep 2 — setup is refused before a plan is chosen');
  const early = await call('/api/v1/client/onboarding/website', {
    method: 'POST',
    cookie,
    body: { businessName: 'Signup Flow Check', slug: SLUG },
  });
  check('rejected with 409', early.status === 409, early.status);
  check('code is ONBOARDING_STEP_BLOCKED', early.body?.code === 'ONBOARDING_STEP_BLOCKED', early.body?.code);

  console.log('\nStep 3 — choosing a plan moves signup to payment');
  const offered = await call('/api/v1/client/onboarding', { cookie });
  check(
    'a fresh account is offered the free trial',
    offered.body?.data?.trialOffer?.available === true,
    offered.body?.data?.trialOffer,
  );

  const chosen = await call('/api/v1/client/onboarding/plan', {
    method: 'POST',
    cookie,
    body: { planId: plan.id, billingCycle: 'monthly' },
  });
  check('plan accepted', chosen.status === 200, chosen.body);

  const afterPlan = await call('/api/v1/client/onboarding', { cookie });
  // Every plan is billed, including the trial and a free one — the amount is the
  // only thing that varies, and a 0.00 bill is still a bill that must be paid.
  const expectedDue = Number(plan.monthlyPrice).toFixed(2);
  check('step is "payment"', afterPlan.body?.data?.step === 'payment', afterPlan.body?.data?.step);
  check(
    USE_TRIAL ? 'the trial is stamped as used' : 'the trial is untouched by a purchase',
    afterPlan.body?.data?.trialOffer?.used === USE_TRIAL,
    afterPlan.body?.data?.trialOffer,
  );
  check('a bill is required', afterPlan.body?.data?.payment?.required === true, afterPlan.body?.data?.payment);
  check(
    `the bill is ${expectedDue}`,
    afterPlan.body?.data?.payment?.amount === expectedDue,
    afterPlan.body?.data?.payment?.amount,
  );
  check('a placeholder tenant exists but is not a store', afterPlan.body?.data?.store_view === null);

  console.log('\nStep 4 — the store cannot be created before the bill settles');
  const unpaid = await call('/api/v1/client/onboarding/website', {
    method: 'POST',
    cookie,
    body: { businessName: 'Signup Flow Check', slug: SLUG },
  });
  check('rejected with 409', unpaid.status === 409, unpaid.status);
  check('code is ONBOARDING_STEP_BLOCKED', unpaid.body?.code === 'ONBOARDING_STEP_BLOCKED', unpaid.body?.code);

  console.log('\nStep 5 — the bill goes through the gateway even at 0.00');
  const checkout = await call('/api/v1/client/onboarding/payment', { method: 'POST', cookie });
  check('checkout session created', checkout.status === 200, checkout.body);

  const checkoutUrl: string | null = checkout.body?.data?.checkoutUrl ?? null;
  check('a gateway URL was returned', typeof checkoutUrl === 'string', checkoutUrl);

  if (checkoutUrl) {
    // The mock gateway signs and posts a real webhook to the API, so the whole
    // verified-payment path runs exactly as it would in production.
    await fetch(checkoutUrl, { redirect: 'manual' });
  }

  const afterPayment = await call('/api/v1/client/onboarding', { cookie });
  check('bill settled', afterPayment.body?.data?.payment?.settled === true, afterPayment.body?.data?.payment);
  // Only the authorisation flow yields a reusable token, so only a trial ends
  // up with a card on file — a pay-now signup has already paid its period.
  check(
    USE_TRIAL ? 'a card is on file for the trial' : 'a one-off charge stores no card',
    Boolean(afterPayment.body?.data?.payment?.method) === USE_TRIAL,
    afterPayment.body?.data?.payment?.method,
  );
  check('step is "store"', afterPayment.body?.data?.step === 'store', afterPayment.body?.data?.step);
  check(
    USE_TRIAL ? 'the trial was not charged' : 'the plan was charged',
    afterPayment.body?.data?.payment?.mode === (USE_TRIAL ? 'method_setup' : 'charge'),
    afterPayment.body?.data?.payment?.mode,
  );

  // The bill has to leave a paper trail whatever it came to, or "billing is
  // complete" would be a claim with nothing behind it on a trial.
  const billed = await call('/api/v1/client/invoices', { cookie });
  const firstInvoice = billed.body?.data?.[0];
  check('an invoice was issued for the bill', Boolean(firstInvoice), billed.body?.data);
  check(
    `the invoice is for ${expectedDue}`,
    Number(firstInvoice?.amount ?? -1).toFixed(2) === expectedDue,
    firstInvoice?.amount,
  );

  // A payment that lands before provisioning must not claim the store is up.
  const midway = (await db.select().from(tenants).where(eq(tenants.clientAccountId, account!.id)).limit(1))[0];
  check('payment did not mark an unbuilt store ready', midway?.storeStatus === 'not_created', midway?.storeStatus);

  console.log('\nStep 6 — website setup alone does not build anything');
  const website = await call('/api/v1/client/onboarding/website', {
    method: 'POST',
    cookie,
    body: { businessName: 'Signup Flow Check', slug: SLUG },
  });
  check('website setup accepted', website.status === 200, website.body);
  check('slug applied', website.body?.data?.store?.slug === SLUG, website.body?.data?.store?.slug);
  check('provisioning has NOT started', website.body?.data?.provisioning === false, website.body?.data);

  const halfway = (await db.select().from(tenants).where(eq(tenants.slug, SLUG)).limit(1))[0];
  check('store still not created', halfway?.storeStatus === 'not_created', halfway?.storeStatus);

  const midState = await call('/api/v1/client/onboarding', { cookie });
  check('website reported as configured', midState.body?.data?.website?.configured === true);
  check('admin panel reported as not configured', midState.body?.data?.adminPanel?.configured === false);

  console.log('\nStep 6b — admin panel setup asks for a passcode instead of building');
  const created = await call('/api/v1/client/onboarding/admin-panel', {
    method: 'POST',
    cookie,
    body: { adminEmail: ADMIN_EMAIL, adminPassword: ADMIN_PASSWORD },
  });
  check('admin panel setup accepted', created.status === 200, created.body);
  check('a passcode is required', created.body?.data?.otpRequired === true, created.body?.data);
  check('the code went to the admin address', created.body?.data?.sentTo === ADMIN_EMAIL, created.body?.data);

  const staged = (await db.select().from(tenants).where(eq(tenants.slug, SLUG)).limit(1))[0];
  check('store still not created', staged?.storeStatus === 'not_created', staged?.storeStatus);
  check('admin email staged', staged?.storeAdminEmail === ADMIN_EMAIL, staged?.storeAdminEmail);
  check('address not yet proven', staged?.storeAdminEmailVerifiedAt === null, staged?.storeAdminEmailVerifiedAt);
  check('the code is stored hashed', Boolean(staged?.storeAdminOtpHash) && staged?.storeAdminOtpHash !== OTP_CODE);

  console.log('\nStep 6c — a wrong passcode builds nothing');
  const wrong = await call('/api/v1/client/onboarding/admin-panel/verify', {
    method: 'POST',
    cookie,
    body: { code: '000000' },
  });
  check('wrong code rejected', wrong.status === 422 || wrong.status === 429, wrong.status);

  const afterWrong = (await db.select().from(tenants).where(eq(tenants.slug, SLUG)).limit(1))[0];
  check('still not created', afterWrong?.storeStatus === 'not_created', afterWrong?.storeStatus);

  console.log('\nStep 6d — the right passcode starts the build');
  // The real code only exists in the email that was just sent, so a known one is
  // planted in its place. Everything downstream of the check is unchanged.
  await plantOtp();

  const verified = await call('/api/v1/client/onboarding/admin-panel/verify', {
    method: 'POST',
    cookie,
    body: { code: OTP_CODE },
  });
  check('passcode accepted', verified.status === 200, verified.body);
  check('provisioning started', verified.body?.data?.provisioning === true, verified.body?.data);

  // Provisioning may be running on the worker; give it a moment either way.
  let tenant = (await db.select().from(tenants).where(eq(tenants.slug, SLUG)).limit(1))[0];
  for (let attempt = 0; attempt < 30 && tenant?.storeStatus !== 'ready'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    tenant = (await db.select().from(tenants).where(eq(tenants.slug, SLUG)).limit(1))[0];
  }

  check('store provisioned', tenant?.storeStatus === 'ready', tenant?.storeStatus);
  check('admin email recorded', tenant?.storeAdminEmail === ADMIN_EMAIL, tenant?.storeAdminEmail);
  check('staged password hash cleared after provisioning', tenant?.storeAdminPasswordHash === null);
  check('the passcode was burned', tenant?.storeAdminOtpHash === null, tenant?.storeAdminOtpHash);
  check('the address is recorded as proven', Boolean(tenant?.storeAdminEmailVerifiedAt));

  console.log('\nStep 7 — the tenant database holds that login, and only that login');
  if (tenant?.databaseName) {
    const client = new pg.Client({
      host: config.tenantDb.host,
      port: config.tenantDb.port,
      user: config.tenantDb.user,
      password: config.tenantDb.password,
      database: tenant.databaseName,
      ssl: config.tenantDb.ssl ? { rejectUnauthorized: false } : undefined,
    });
    await client.connect();
    try {
      const admins = await client.query('select email, password_hash, role, status from store_admins');
      check('exactly one store admin', admins.rowCount === 1, admins.rowCount);
      check('it is the email chosen at signup', admins.rows[0]?.email === ADMIN_EMAIL, admins.rows[0]?.email);
      check('it is the owner role', admins.rows[0]?.role === 'owner', admins.rows[0]?.role);

      const hash = admins.rows[0]?.password_hash as string | undefined;
      check('the chosen password verifies', hash ? await verifyPassword(hash, ADMIN_PASSWORD) : false);
      check(
        'the SaaS account password does NOT open the store panel',
        hash ? !(await verifyPassword(hash, 'Account-Pass-9!')) : false,
      );

      const settings = await client.query('select store_name, slug from store_settings');
      check('store settings seeded', settings.rows[0]?.slug === SLUG, settings.rows[0]);
    } finally {
      await client.end().catch(() => undefined);
    }
  } else {
    check('tenant database name recorded', false, tenant?.databaseName);
  }

  console.log('\nStep 7b — the store admin password can be reset from the dashboard');
  const NEW_ADMIN_PASSWORD = 'Even-Str0nger-Pass!';

  const requested = await call('/api/v1/client/store/admin-password/request', { method: 'POST', cookie });
  check('reset code requested', requested.status === 200, requested.body);
  check('the code goes to the admin address', requested.body?.data?.sentTo === ADMIN_EMAIL, requested.body?.data);

  const wrongReset = await call('/api/v1/client/store/admin-password/reset', {
    method: 'POST',
    cookie,
    body: { code: '000000', password: NEW_ADMIN_PASSWORD },
  });
  check('a wrong code changes nothing', wrongReset.status === 422 || wrongReset.status === 429, wrongReset.status);

  await plantOtp();
  const reset = await call('/api/v1/client/store/admin-password/reset', {
    method: 'POST',
    cookie,
    body: { code: OTP_CODE, password: NEW_ADMIN_PASSWORD },
  });
  check('reset accepted', reset.status === 200, reset.body);

  const replay = await call('/api/v1/client/store/admin-password/reset', {
    method: 'POST',
    cookie,
    body: { code: OTP_CODE, password: NEW_ADMIN_PASSWORD },
  });
  check('the same code cannot be used twice', replay.status !== 200, replay.status);

  if (tenant?.databaseName) {
    const client = new pg.Client({
      host: config.tenantDb.host,
      port: config.tenantDb.port,
      user: config.tenantDb.user,
      password: config.tenantDb.password,
      database: tenant.databaseName,
      ssl: config.tenantDb.ssl ? { rejectUnauthorized: false } : undefined,
    });
    await client.connect();
    try {
      const rows = await client.query('select password_hash from store_admins');
      const hash = rows.rows[0]?.password_hash as string | undefined;
      check('the new password opens the panel', hash ? await verifyPassword(hash, NEW_ADMIN_PASSWORD) : false);
      check('the old password no longer does', hash ? !(await verifyPassword(hash, ADMIN_PASSWORD)) : false);
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  // Resetting the panel's password must not have touched the SaaS account's.
  const saasLogin = await call('/api/v1/public/login', {
    method: 'POST',
    body: { email: EMAIL, password: 'Account-Pass-9!' },
  });
  check('the SaaS account password still works', saasLogin.status === 200, saasLogin.status);

  console.log('\nStep 8 — the free trial cannot be taken a second time');
  // The trial is a plan, and a store that exists has already had its one — on a
  // purchase run the account never took one, but a store is still not a place
  // a trial can be moved to. Both routes that accept a plan id refuse it.
  const trialPlanRows = await db.select().from(plans).where(eq(plans.isTrial, true)).limit(1);
  const trialPlan = trialPlanRows[0];
  check('a free-trial plan is seeded', Boolean(trialPlan), trialPlan?.code);

  if (trialPlan) {
    const switched = await call('/api/v1/client/subscription/change', {
      method: 'POST',
      cookie,
      body: { planId: trialPlan.id, billingCycle: 'monthly' },
    });
    check('switching to the trial is refused', switched.status === 409, switched.status);
    check('code is TRIAL_ALREADY_USED', switched.body?.code === 'TRIAL_ALREADY_USED', switched.body?.code);

    const bought = await call('/api/v1/client/payments/checkout', {
      method: 'POST',
      cookie,
      body: { planId: trialPlan.id, billingCycle: 'monthly' },
    });
    check('checking out the trial is refused', bought.status === 409, bought.status);
  }

  console.log('\nStep 9 — signup is finished');
  const final = await call('/api/v1/client/onboarding', { cookie });
  check('step is "done"', final.body?.data?.step === 'done', final.body?.data?.step);
  check('marked complete', final.body?.data?.completed === true);

  const accountRow = await db
    .select({ step: clientAccounts.onboardingStep, completed: clientAccounts.onboardingCompleted })
    .from(clientAccounts)
    .where(and(eq(clientAccounts.id, account!.id)))
    .limit(1);
  check('account records completion', accountRow[0]?.completed === true, accountRow[0]);

  if (!KEEP) {
    console.log('\nCleaning up…');
    await cleanup();
  } else {
    console.log(`\nKept: account ${EMAIL}, tenant ${tenant?.databaseName}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await pool.end().catch(() => undefined);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => undefined);
  process.exit(1);
});

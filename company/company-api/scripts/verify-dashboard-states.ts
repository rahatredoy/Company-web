/**
 * Renders /dashboard for three real accounts — no plan, paid but no store, and a
 * live store — and asserts the page says the right thing for each. There is no
 * test runner on this platform, so this drives the *running* website over HTTP
 * with real session cookies.
 *
 *   npm run dev          (company-api, port 4000)
 *   npm run dev          (company-web, port 3000)
 *   npx tsx scripts/verify-dashboard-states.ts
 *
 * Every account and tenant database it creates is dropped again at the end.
 */
import { and, eq } from 'drizzle-orm';
import { db, pool } from '../src/db/client';
import { clientAccounts, plans, tenants } from '../src/db/schema/index';
import { config } from '../src/config/index';
import { resolveShard, shardClientOptions } from '../src/services/tenant-shards';
import { generateToken, sha256 } from '../src/lib/crypto';
import { createClientSession } from '../src/lib/session';
import { hashOtp } from '../src/lib/otp';
import { hashPassword } from '../src/lib/password';
import { addHours } from '../src/lib/utils';

const WEB = 'http://localhost:3000';
const API = config.api.publicUrl.replace(/\/$/, '');

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: unknown) {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail).slice(0, 200)}`}`);
  }
}

async function makeSession(email: string): Promise<string> {
  await db.delete(clientAccounts).where(eq(clientAccounts.email, email));
  const [account] = await db
    .insert(clientAccounts)
    .values({
      fullName: 'State Check',
      email,
      phone: '+8801700000000',
      passwordHash: await hashPassword('Account-Pass-9!'),
      status: 'active',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    })
    .returning({ id: clientAccounts.id });

  /*
   * Minted through the API's own session module: the cookie carries a signed
   * JWT now, so there is no row to plant and a hand-rolled token would simply
   * fail to verify.
   */
  const session = await createClientSession(null, account!.id, false, { otpVerified: true });
  return `company_client_session=${session.token}`;
}

async function apiCall(path: string, cookie: string, body?: unknown) {
  const response = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { accept: 'application/json', cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function page(path: string, cookie: string): Promise<string> {
  const response = await fetch(`${WEB}${path}`, { headers: { cookie }, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) return `REDIRECT:${response.headers.get('location')}`;
  // React separates adjacent text nodes with an empty comment, so "0 of 4" is
  // streamed as "0<!-- --> of <!-- -->4". They are dropped here: every check
  // below is about text a reader sees, not about how it was assembled.
  return (await response.text()).replaceAll('<!-- -->', '');
}

async function main() {
  // States 2 and 3 are paid accounts, so the plan they buy has to be a paid one
  // — the trial is its own plan now and would put them on a 0.00 bill instead.
  const planRows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.status, 'active'), eq(plans.isTrial, false)))
    .limit(1);
  const plan = planRows[0]!;

  // Billing is the first thing on this dashboard and the only thing on offer:
  // an account that has not paid leads with the bill, not with the store.
  console.log('\nState 1 — signed in, billing not set up');
  const a = await makeSession('state-1@example.test');
  const html1 = await page('/dashboard', a);
  check('renders the dashboard (no redirect)', !html1.startsWith('REDIRECT:'), html1.slice(0, 80));
  check('leads with the billing gate', html1.includes('Set up billing to get started'));
  check('invites a look at the store', html1.includes('Have a look at what you get'));
  check('offers Set up billing', html1.includes('Set up billing'));
  check('shows the Apps switcher', html1.includes('>Apps<'));
  check('sidebar has Plans &amp; Billing', html1.includes('Plans &amp; Billing'));
  check('sidebar has no Products link', !html1.includes('>Products<'));
  // My Store stays open before the bill is paid — it is the thing being bought,
  // so it has to be visible. Invoices, which genuinely has nothing in it yet,
  // stays locked. Both are read from the sidebar itself: the page body links to
  // the store too, and that would answer the wrong question.
  const sidebar = html1.slice(html1.indexOf('aria-label="Dashboard"'), html1.indexOf('</aside>'));
  check('sidebar links My Store', sidebar.includes('href="/dashboard/store"'));
  check('sidebar does not link Invoices', !sidebar.includes('href="/dashboard/invoices"'));
  check('sidebar marks the locked entry', sidebar.includes('Available once your bill is paid'));

  const plans1 = await page('/dashboard/plans', a);
  // A fresh account is offered the trial as a plan of its own, above the ones
  // that have to be bought — and it is the only account that ever sees it.
  check('plans page offers the free trial', plans1.includes('Start free trial'), plans1.includes('Free trial'));
  check('the paid plans are offered alongside it', plans1.includes('Or start on a plan today'));
  check('plan cards carry a choose button', plans1.includes('Choose plan'));
  check('billing is presented as two steps', plans1.includes('Pay your bill'));
  check('no wizard stepper', !plans1.includes('Onboarding progress'));

  // The store page is readable before a plan is chosen: every piece setup will
  // build is on it. Only the button that starts setup is refused, and the shell's
  // banner says why — a padlock on the way in taught nobody what they were buying.
  const store1 = await page('/dashboard/store', a);
  check('store page is open before billing', !store1.startsWith('REDIRECT:'), store1.slice(0, 80));
  check('store page shows what will be built', store1.includes('Storefront Website') && store1.includes('Admin Panel'));
  check('store page shows nothing exists yet', store1.includes('No website yet'));
  check('store page still offers the setup button', store1.includes('Start Setup'));
  check('store page says setup waits on the bill', store1.includes('Setup starts once your bill is paid'));
  check('billing banner sits above the page', store1.includes('set up billing'));
  check('no setup form before a plan', !store1.includes('Store address'));

  // Setting up the website, naming the admin panel and connecting a domain are
  // steps on the store page now, not destinations of their own.
  const nav = html1;
  check('sidebar has no Website setup entry', !nav.includes('Website setup'));
  check('sidebar has no Admin panel setup entry', !nav.includes('Admin panel setup'));
  check('sidebar has no Domains entry', !nav.includes('>Domains<'));

  for (const [path, target] of [
    ['/dashboard/website', '/dashboard/store'],
    ['/dashboard/admin-panel', '/dashboard/store'],
    ['/dashboard/domains', '/dashboard/store'],
  ] as const) {
    const moved = await fetch(`${WEB}${path}`, { headers: { cookie: a }, redirect: 'manual' });
    check(`${path} redirects to ${target}`, moved.headers.get('location')?.includes(target) ?? false, moved.status);
  }

  console.log('\nState 2 — plan chosen and paid, store not built');
  const b = await makeSession('state-2@example.test');
  await apiCall('/api/v1/client/onboarding/plan', b, {
    planId: plan.id,
    billingCycle: 'monthly',
  });
  const pay = await apiCall('/api/v1/client/onboarding/payment', b, {});
  const checkoutUrl = pay.body?.data?.checkoutUrl;
  if (checkoutUrl) await fetch(checkoutUrl, { redirect: 'manual' });

  const html2 = await page('/dashboard', b);
  check('renders the dashboard', !html2.startsWith('REDIRECT:'), html2.slice(0, 80));
  check('shows "Your store setup"', html2.includes('Your store setup'));
  check('shows the chosen plan', html2.includes(plan.name), plan.name);
  check('points at the next missing half', html2.includes('Set up your website'), html2.includes('Complete payment'));
  check('no fake store address', !html2.includes('pending-'));

  const plans2 = await page('/dashboard/plans', b);
  check('plan shows as unlocked', plans2.includes('is active'), plans2.includes('Choose your plan'));

  const store2 = await page('/dashboard/store', b);
  check('store page invites setup', store2.includes('Start Setup'));
  check('setup steps are listed', store2.includes('Set up your website') && store2.includes('Verify your login'));
  check('the pieces it will build are shown', store2.includes('Storefront Website') && store2.includes('Admin Panel'));
  check('the pieces are not built yet', store2.includes('No website yet') && store2.includes('No admin panel yet'));
  check('getting started counts the steps', store2.includes('0 of 4 completed'));

  console.log('\nState 3 — store live');
  const c = await makeSession('state-3@example.test');
  await apiCall('/api/v1/client/onboarding/plan', c, {
    planId: plan.id,
    billingCycle: 'monthly',
  });
  const pay3 = await apiCall('/api/v1/client/onboarding/payment', c, {});
  if (pay3.body?.data?.checkoutUrl) await fetch(pay3.body.data.checkoutUrl, { redirect: 'manual' });
  await apiCall('/api/v1/client/onboarding/website', c, {
    businessName: 'State Check Store',
    slug: 'state-check-store',
  });
  const staged = await apiCall('/api/v1/client/onboarding/admin-panel', c, {
    adminEmail: 'owner@state-check.test',
    adminPassword: 'Str0ng-Store-Pass!',
  });
  check('admin login staged, passcode sent', staged.body?.data?.otpRequired === true, staged.body);

  // The emailed code is not readable from here, so a known one is written in its
  // place — the endpoint under test still verifies a genuine challenge.
  await db
    .update(tenants)
    .set({
      storeAdminOtpHash: hashOtp('123456'),
      storeAdminOtpExpiresAt: new Date(Date.now() + 10 * 60_000),
      storeAdminOtpAttempts: 0,
    })
    .where(eq(tenants.slug, 'state-check-store'));

  const created = await apiCall('/api/v1/client/onboarding/admin-panel/verify', c, { code: '123456' });
  check('store created', created.body?.data?.provisioning === true, created.body);

  for (let i = 0; i < 30; i += 1) {
    const rows = await db.select().from(tenants).where(eq(tenants.slug, 'state-check-store')).limit(1);
    if (rows[0]?.storeStatus === 'ready') break;
    await new Promise((r) => setTimeout(r, 1000));
  }

  const html3 = await page('/dashboard', c);
  check('renders the dashboard', !html3.startsWith('REDIRECT:'), html3.slice(0, 80));
  check('shows the store name', html3.includes('State Check Store'));
  check('shows the storefront address', html3.includes('state-check-store'));
  check('shows Quick actions', html3.includes('Quick actions'));
  check('shows Open store admin', html3.includes('Open store admin'));
  check('shows Current plan card', html3.includes('Current plan'));

  const store3 = await page('/dashboard/store', c);
  check('store page leads with the store overview', store3.includes('Store overview'));
  check('store page offers the storefront', store3.includes('Visit my store'));
  check('store page offers the admin panel', store3.includes('Go to admin panel'));
  check('store page shows the store name and tenant id', store3.includes('State Check Store') && store3.includes('TNT-'));
  check('store page shows both address panels', store3.includes('Platform subdomain') && store3.includes('Platform admin domain'));
  check('store page lists quick actions', store3.includes('Quick actions') && store3.includes('Manage domains'));
  check('store page points at what is next', store3.includes('Follow these steps to start selling'));
  check('store page shows the admin sign-in email', store3.includes('owner@state-check.test'));
  check('store page offers an admin password reset', store3.includes('Reset admin password'));
  check('store page shows plan and usage', store3.includes('Plan &amp; usage') && store3.includes(plan.name));
  check('custom domains are managed inline', store3.includes('Custom storefront domain'));
  check('setup wizard is gone once the store exists', !store3.includes('Start Setup'));

  console.log('\nRoute moves');
  const moved = await fetch(`${WEB}/account`, { headers: { cookie: c }, redirect: 'manual' });
  check('/account redirects to /dashboard', moved.headers.get('location')?.includes('/dashboard') ?? false, moved.status);
  const movedSub = await fetch(`${WEB}/account/subscription`, { headers: { cookie: c }, redirect: 'manual' });
  check(
    '/account/subscription redirects to /dashboard/plans',
    movedSub.headers.get('location')?.includes('/dashboard/plans') ?? false,
    movedSub.headers.get('location'),
  );
  const oldOnboarding = await fetch(`${WEB}/onboarding`, { headers: { cookie: c }, redirect: 'manual' });
  check(
    '/onboarding redirects to /dashboard/plans',
    oldOnboarding.headers.get('location')?.includes('/dashboard/plans') ?? false,
    oldOnboarding.headers.get('location'),
  );
  const oldWizard = await fetch(`${WEB}/dashboard/onboarding`, { headers: { cookie: c }, redirect: 'manual' });
  check(
    '/dashboard/onboarding redirects to /dashboard/plans',
    oldWizard.headers.get('location')?.includes('/dashboard/plans') ?? false,
    oldWizard.headers.get('location'),
  );
  const guarded = await fetch(`${WEB}/dashboard`, { redirect: 'manual' });
  check(
    'signed-out /dashboard goes to sign-in',
    guarded.headers.get('location')?.includes('/sign-in') ?? false,
    guarded.headers.get('location'),
  );

  console.log('\nCleaning up…');
  const tenantRows = await db
    .select({ databaseName: tenants.databaseName, databaseShard: tenants.databaseShard })
    .from(tenants)
    .where(eq(tenants.slug, 'state-check-store'));
  for (const email of ['state-1@example.test', 'state-2@example.test', 'state-3@example.test']) {
    await db.delete(clientAccounts).where(eq(clientAccounts.email, email));
  }
  const pg = (await import('pg')).default;
  for (const row of tenantRows) {
    if (!row.databaseName) continue;
    const admin = new pg.Client(shardClientOptions(resolveShard(row.databaseShard), 'postgres'));
    await admin.connect();
    await admin.query(`drop database if exists "${row.databaseName}" with (force)`);
    await admin.end();
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

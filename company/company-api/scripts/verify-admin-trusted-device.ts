/**
 * 24 checks over the company-admin sign-in, against the running API.
 *
 *   npx tsx scripts/verify-admin-trusted-device.ts
 *
 * Proves the two halves of the remembered-browser flow: that a browser which
 * has cleared an emailed passcode signs in on the password alone afterwards,
 * and — the part that matters — that this does not weaken anything. A wrong
 * password is still refused with the device cookie present, a browser without
 * the cookie still gets a code, and signing out with `forgetDevice` puts the
 * code back.
 *
 * Requires company-api on 4000. It never reads a real passcode from an inbox:
 * the challenge row's hash is overwritten with a known code, which exercises
 * the real `/otp/verify` endpoint without depending on mail delivery. The admin
 * password is taken from COMPANY_ADMIN_PASSWORD unless --password is passed.
 *
 * It leaves the admin signed out of every session and forgotten on every
 * browser, so run it when you are not mid-sign-in yourself.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db, closeDatabase } from '../src/db/client';
import { companyAdmin, companyAdminSessions } from '../src/db/schema/index';
import { config } from '../src/config/index';
import { sha256 } from '../src/lib/crypto';
import { redis, closeRedis } from '../src/lib/redis';
import { SESSION_COOKIE } from '../src/lib/constants';

const BASE = config.api.publicUrl;
const KNOWN_CODE = '424242';

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A cookie jar, because `fetch` has none and the whole test is about cookies. */
type Jar = Record<string, string>;

function absorb(jar: Jar, response: Response): Jar {
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(';');
    const index = pair!.indexOf('=');
    const name = pair!.slice(0, index).trim();
    const value = pair!.slice(index + 1).trim();
    // An empty value with an expiry in the past is a deletion, not a cookie.
    if (value === '') delete jar[name];
    else jar[name] = value;
  }
  return jar;
}

function header(jar: Jar): Record<string, string> {
  const pairs = Object.entries(jar).map(([k, v]) => `${k}=${v}`);
  return pairs.length ? { cookie: pairs.join('; ') } : {};
}

async function call(path: string, jar: Jar, body?: unknown) {
  const response = await fetch(`${BASE}/api/v1/admin${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...header(jar),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  absorb(jar, response);
  const payload = (await response.json().catch(() => ({}))) as { data?: unknown; code?: string };
  return { status: response.status, data: payload.data as never, code: payload.code };
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
}

/**
 * Plants a passcode we know on the challenge the API just created. The row is
 * the only place the code lives, so this is the same thing the email would do,
 * minus the inbox.
 */
async function plantCode(adminId: string): Promise<boolean> {
  const [challenge] = await db
    .select({ id: companyAdminSessions.id })
    .from(companyAdminSessions)
    .where(
      and(
        eq(companyAdminSessions.adminId, adminId),
        eq(companyAdminSessions.otpVerified, false),
        isNull(companyAdminSessions.revokedAt),
      ),
    )
    .orderBy(desc(companyAdminSessions.createdAt))
    .limit(1);

  if (!challenge) return false;

  await db
    .update(companyAdminSessions)
    .set({
      otpCodeHash: sha256(KNOWN_CODE),
      otpExpiresAt: new Date(Date.now() + 300_000),
      otpAttempts: 0,
    })
    .where(eq(companyAdminSessions.id, challenge.id));

  return true;
}

/**
 * The dual limiter allows five sign-ins per 15 minutes and this run needs six,
 * so the counter is reset before each one. The limiter is not what is under
 * test here; tripping it would only hide the checks that are.
 */
async function clearLoginRateLimits(): Promise<void> {
  const keys = await redis.keys('rl:admin-login:*');
  if (keys.length) await redis.del(...keys);
}

async function login(jar: Jar, email: string, password: string) {
  await clearLoginRateLimits();
  return call('/login', jar, { email, password });
}

async function main(): Promise<void> {
  const [admin] = await db.select().from(companyAdmin).limit(1);
  if (!admin) throw new Error('No company admin exists. Run `npm run db:seed` first.');

  const email = admin.email;
  const password = flag('password') ?? config.bootstrapAdmin.password;
  if (!password) throw new Error('Set COMPANY_ADMIN_PASSWORD in .env, or pass --password.');

  console.log(`\n  Admin sign-in — trusted device (${BASE})`);
  console.log(`  admin: ${email}\n`);

  // ── A fresh browser: password, then passcode ──────────────────────────────
  const browser: Jar = {};

  const anon = await call('/session', browser);
  check('unknown browser reads as anonymous', anon.data?.state === 'anonymous', anon.data?.state);

  const first = await login(browser, email, password);
  check('password accepted', first.status === 200, `${first.status} ${first.code ?? ''}`);
  check('a passcode is required on a new browser', first.data?.otpRequired === true);
  check('challenge cookie issued', Boolean(browser[SESSION_COOKIE.adminOtp]));
  check('no session cookie before the passcode', !browser[SESSION_COOKIE.admin]);
  check('no device cookie before the passcode', !browser[SESSION_COOKIE.adminDevice]);

  check('challenge row found', await plantCode(admin.id));

  const verified = await call('/otp/verify', browser, { code: KNOWN_CODE });
  check('passcode accepted', verified.status === 200, `${verified.status} ${verified.code ?? ''}`);
  check('session cookie issued', Boolean(browser[SESSION_COOKIE.admin]));
  check('challenge cookie cleared', !browser[SESSION_COOKIE.adminOtp]);
  check('browser remembered', Boolean(browser[SESSION_COOKIE.adminDevice]));

  const authed = await call('/session', browser);
  check('session is authenticated', authed.data?.state === 'authenticated', authed.data?.state);

  // ── Signing out keeps the browser remembered ──────────────────────────────
  const deviceCookie = browser[SESSION_COOKIE.adminDevice]!;
  await call('/logout', browser, {});
  check('signed out', !browser[SESSION_COOKIE.admin]);
  check('sign-out keeps the browser remembered', browser[SESSION_COOKIE.adminDevice] === deviceCookie);

  const second = await login(browser, email, password);
  check('remembered browser skips the passcode', second.data?.otpRequired === false, JSON.stringify(second.data));
  check('signed straight in', Boolean(browser[SESSION_COOKIE.admin]));

  const back = await call('/session', browser);
  check('back in without a code', back.data?.state === 'authenticated', back.data?.state);

  const ttlHours = back.data
    ? Math.round(((new Date(second.data?.expiresAt as string).getTime() - Date.now()) / 3_600_000) * 10) / 10
    : 0;
  check(
    `session lasts ${ttlHours}h (ADMIN_SESSION_TTL_MINUTES=${config.security.adminSessionTtlMinutes})`,
    Math.abs(ttlHours * 60 - config.security.adminSessionTtlMinutes) < 5,
    'restart the API if this disagrees with .env',
  );

  // ── The device cookie is not a credential ─────────────────────────────────
  const wrong = await login(browser, email, `${password}-wrong`);
  check('wrong password still refused on a remembered browser', wrong.status === 401, String(wrong.status));
  // Undo the failure counter this just moved, so a real sign-in is not delayed.
  await db
    .update(companyAdmin)
    .set({ failedLoginCount: 0, lockedUntil: null })
    .where(eq(companyAdmin.id, admin.id));

  const stranger: Jar = {};
  const strangerLogin = await login(stranger, email, password);
  check('a different browser still gets a passcode', strangerLogin.data?.otpRequired === true);
  check('and no session', !stranger[SESSION_COOKIE.admin]);

  const forged: Jar = { [SESSION_COOKIE.adminDevice]: 'not-a-real-device-token' };
  const forgedLogin = await login(forged, email, password);
  check('a made-up device token gets a passcode', forgedLogin.data?.otpRequired === true);

  // ── forgetDevice puts the passcode back ───────────────────────────────────
  await call('/logout', browser, { forgetDevice: true });
  check('forgetDevice clears the cookie', !browser[SESSION_COOKIE.adminDevice]);

  const afterForget = await login({ ...browser, [SESSION_COOKIE.adminDevice]: deviceCookie }, email, password);
  check('a forgotten device token no longer works', afterForget.data?.otpRequired === true);

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

try {
  await main();
} finally {
  await closeDatabase();
  await closeRedis();
}

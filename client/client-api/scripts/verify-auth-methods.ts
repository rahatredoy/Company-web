/**
 * The three ways into a shop: email and password, a phone number and a code,
 * and Google.
 *
 *   npx tsx scripts/verify-auth-methods.ts
 *   npx tsx scripts/verify-auth-methods.ts --slug e-comarch --keep
 *
 * Two things here are worth knowing before reading it.
 *
 * **The one-time code is planted, not read.** There is no inbox and no handset
 * to check, so the script writes a known code into the same challenge record the
 * API writes — exactly as `company-api/scripts/verify-admin-trusted-device.ts`
 * plants a passcode hash rather than reading an email. What is under test is
 * everything downstream of the code arriving, which is all of it.
 *
 * **The claim it exists to prove is that one number is one account.** Half a
 * dozen spellings of the same Bangladeshi mobile go in and must all land on the
 * row the first one created; a normaliser that disagrees with itself would let
 * somebody register a number that already exists and then be unable to sign in
 * to either copy.
 *
 * `node:http` rather than `fetch`, because `fetch` drops a custom `Host` and the
 * hostname is how the API decides which store it is serving.
 */
import { request as httpRequest } from 'node:http';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { fetchTenantBySlug } from '../src/lib/company-client';
import { OTP_MAX_ATTEMPTS } from '../src/lib/otp';
import { toE164 } from '../src/lib/phone';
import { reset as resetRateLimit } from '../src/lib/rate-limit';
import { closeRedis } from '../src/lib/redis';
import { storeChallenge } from '../src/modules/storefront/phone-otp';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const ROOT = config.urls.platformRootDomain;
const SLUG = arg('slug') ?? config.devStoreSlug ?? 'e-comarch';
const KEEP = process.argv.includes('--keep');
const STORE_HOST = `${SLUG}.${ROOT}`;

/**
 * A number in the reserved 0170 range, spelled six ways. Every one of them is
 * the same handset, and the whole point is that the platform agrees.
 */
const NUMBER = '01700000199';
const SPELLINGS = [
  '01700000199',
  '+8801700000199',
  '8801700000199',
  '017 0000 0199',
  '+880 1700-000199',
  '008801700000199',
];
const E164 = '+8801700000199';

/** Planted rather than received. Six digits, because the schema insists. */
const KNOWN_CODE = '424242';

const EMAIL = 'zz-auth-methods@example.test';
const PASSWORD = 'ZzAuthMethods2026';

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

interface Res {
  status: number;
  body: any;
  location?: string;
}

type Jar = Map<string, string>;

async function call(
  host: string,
  path: string,
  init: { method?: string; body?: unknown; jar?: Jar } = {},
): Promise<Res> {
  const payload = init.body === undefined ? undefined : JSON.stringify(init.body);
  const headers: Record<string, string> = {
    accept: 'application/json',
    host,
    ...(payload ? { 'content-type': 'application/json' } : {}),
  };

  if (init.jar && init.jar.size > 0) {
    headers.cookie = [...init.jar].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  const result = await new Promise<{
    status: number;
    setCookie: string[];
    text: string;
    location?: string;
  }>((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: config.api.port, path, method: init.method ?? 'GET', headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            setCookie: response.headers['set-cookie'] ?? [],
            text: Buffer.concat(chunks).toString('utf8'),
            location: response.headers.location,
          }),
        );
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });

  if (init.jar) {
    for (const raw of result.setCookie) {
      const [pair] = raw.split(';');
      const [name, ...rest] = (pair ?? '').split('=');
      if (name) init.jar.set(name.trim(), rest.join('='));
    }
  }

  let body: unknown = null;
  try {
    body = result.text ? JSON.parse(result.text) : null;
  } catch {
    body = result.text;
  }

  return { status: result.status, body, location: result.location };
}

const shop = (path: string, init: { method?: string; body?: unknown; jar?: Jar } = {}) =>
  call(STORE_HOST, `/api/v1/storefront${path}`, init);

/**
 * Clears this script's own limiter counters.
 *
 * It asks for codes and submits wrong ones far faster than any person would,
 * which is precisely what the limits exist to stop. Without this the second run
 * inside fifteen minutes fails on the limiter rather than on anything under test.
 */
async function clearOwnRateLimits(): Promise<void> {
  const scopes = [
    'customer-phone-request',
    'customer-phone-verify',
    'customer-phone-register',
    'customer-google-start',
    'customer-google-exchange',
    'customer-register',
    'customer-login',
    'login',
  ];

  const identities = [E164, EMAIL, ...SPELLINGS.map((spelling) => toE164(spelling) ?? '')];
  const ips = ['127.0.0.1', '::ffff:127.0.0.1', '::1'];

  for (const scope of scopes) {
    for (const ip of ips) {
      await resetRateLimit(scope, ip);
      await resetRateLimit(`${scope}:ip`, ip);
    }
    for (const identity of identities) {
      if (identity) await resetRateLimit(`${scope}:id`, identity.toLowerCase());
    }
  }
}

async function main(): Promise<void> {
  console.log(`\nSign-in checks against ${STORE_HOST} on port ${config.api.port}\n`);

  const tenant = await fetchTenantBySlug(SLUG);
  if (!tenant) throw new Error(`no tenant record for ${SLUG}; is company-api running?`);

  await clearOwnRateLimits();

  const pool = await openTenantPoolForSlug(SLUG);
  const sql = async <T = any>(text: string, params: unknown[] = []): Promise<T[]> =>
    (await pool.query(text, params as never[])).rows as T[];

  await cleanup(sql);

  console.log('0. The schema carries a phone identity and a provider link');
  {
    const columns = await sql<{ column_name: string; is_nullable: string }>(
      `select column_name, is_nullable from information_schema.columns
       where table_name = 'customers' and column_name in ('email', 'phone_e164', 'phone_verified_at')`,
    );

    const byName = new Map(columns.map((c) => [c.column_name, c.is_nullable]));
    check('customers.phone_e164 exists', byName.has('phone_e164'), [...byName.keys()]);
    check('customers.phone_verified_at exists', byName.has('phone_verified_at'));
    check(
      'customers.email is nullable, so a phone-only account is possible',
      byName.get('email') === 'YES',
      byName.get('email'),
    );

    const identities = await sql<{ table_name: string }>(
      `select table_name from information_schema.tables where table_name = 'customer_identities'`,
    );
    check('customer_identities exists', identities.length === 1);

    const unique = await sql<{ indexname: string }>(
      `select indexname from pg_indexes
       where tablename in ('customers', 'customer_identities')
         and indexname in ('customers_phone_e164_key', 'customer_identities_provider_subject_key')`,
    );
    check('both identity uniques are indexed', unique.length === 2, unique.map((u) => u.indexname));
  }

  console.log('\n1. Asking for a code says nothing about who has an account');
  {
    const unknown = await shop('/auth/phone/request', { method: 'POST', body: { phone: NUMBER } });
    check('a code can be asked for', unknown.status === 200, unknown.body);
    check('the number comes back masked', /^•+ \d{3}$/.test(unknown.body?.data?.sentTo ?? ''), unknown.body?.data);
    check('and never in full', !JSON.stringify(unknown.body).includes(NUMBER), unknown.body?.data);

    const again = await shop('/auth/phone/request', { method: 'POST', body: { phone: NUMBER } });
    check(
      'a resend inside the cooldown answers in the same shape',
      again.status === 200 &&
        Object.keys(again.body?.data ?? {}).join() === Object.keys(unknown.body?.data ?? {}).join(),
      again.body?.data,
    );
    check(
      'and reports how long is left rather than refusing',
      typeof again.body?.data?.resendInSeconds === 'number' && again.body.data.resendInSeconds > 0,
      again.body?.data,
    );

    const nonsense = await shop('/auth/phone/request', { method: 'POST', body: { phone: '12' } });
    check('an unusable number is refused', nonsense.status === 422, nonsense.status);
  }

  console.log('\n2. A code is guessed at, not brute-forced');
  {
    await storeChallenge(tenant.tenantRef, E164, KNOWN_CODE);

    const wrong = await shop('/auth/phone/verify', {
      method: 'POST',
      body: { phone: NUMBER, code: '000000' },
    });
    check('a wrong code is refused', wrong.status === 401, wrong.status);

    for (let attempt = 2; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
      await shop('/auth/phone/verify', { method: 'POST', body: { phone: NUMBER, code: '000000' } });
    }

    const burned = await shop('/auth/phone/verify', {
      method: 'POST',
      body: { phone: NUMBER, code: '000000' },
    });
    check(`${OTP_MAX_ATTEMPTS} wrong guesses end the challenge`, burned.status === 401, burned.status);

    // The right code no longer works either — the challenge is gone, not just
    // the guess. This is the check that separates a burned challenge from a
    // counter that merely refuses the wrong value.
    const tooLate = await shop('/auth/phone/verify', {
      method: 'POST',
      body: { phone: NUMBER, code: KNOWN_CODE },
    });
    check('and the real code is dead with it', tooLate.status === 401, tooLate.status);

    const malformed = await shop('/auth/phone/verify', {
      method: 'POST',
      body: { phone: NUMBER, code: 'abcdef' },
    });
    check('a code that is not six digits is refused before anything is looked up', malformed.status === 422, malformed.status);
  }

  console.log('\n3. A proved number becomes an account');
  const jar: Jar = new Map();
  {
    await storeChallenge(tenant.tenantRef, E164, KNOWN_CODE);

    const verified = await shop('/auth/phone/verify', {
      method: 'POST',
      jar,
      body: { phone: NUMBER, code: KNOWN_CODE },
    });
    check('the right code passes', verified.status === 200, verified.body);
    check('an unknown number asks for a name', verified.body?.data?.status === 'name_required', verified.body?.data);
    check('and hands back a ticket', typeof verified.body?.data?.ticket === 'string', verified.body?.data);
    check('but no session yet', !jar.has('store_customer_session'), [...jar.keys()]);

    const ticket = verified.body?.data?.ticket as string;

    const noTerms = await shop('/auth/phone/register', {
      method: 'POST',
      body: { ticket, fullName: 'Zz Phone', acceptsTerms: false },
    });
    check('the terms cannot be skipped', noTerms.status === 422, noTerms.status);

    const registered = await shop('/auth/phone/register', {
      method: 'POST',
      jar,
      body: { ticket, fullName: 'Zz Phone', acceptsTerms: true },
    });
    check('the account is created', registered.status === 201, registered.body);
    check('and signed in straight away', jar.has('store_customer_session'));

    const reused = await shop('/auth/phone/register', {
      method: 'POST',
      body: { ticket, fullName: 'Zz Impostor', acceptsTerms: true },
    });
    check('a spent ticket cannot be used again', reused.status === 401, reused.status);

    const [row] = await sql<{
      email: string | null;
      phone_e164: string;
      phone_verified_at: string | null;
      password_hash: string | null;
      full_name: string;
    }>(
      'select email, phone_e164, phone_verified_at, password_hash, full_name from customers where phone_e164 = $1',
      [E164],
    );

    check('the number is stored in E.164, not as typed', row?.phone_e164 === E164, row?.phone_e164);
    check('the account has no email at all', row?.email === null, row?.email);
    check('and no password', row?.password_hash === null);
    check('the number is marked verified', row?.phone_verified_at !== null);
    check('the name is the one that was given', row?.full_name === 'Zz Phone', row?.full_name);

    const me = await shop('/account/me', { jar });
    check('the session reads back as a customer', me.status === 200, me.status);
    check('whose email is null rather than absent', me.body?.data?.email === null, me.body?.data);
    check('and who is reported as having no password', me.body?.data?.hasPassword === false, me.body?.data);
    check('never leaking the hash column', !JSON.stringify(me.body).includes('passwordHash'));
  }

  console.log('\n4. One number is one account, however it is spelled');
  {
    /*
     * The limiter has to be cleared again here, and the reason is a pass rather
     * than a nuisance: section 2 deliberately spends a whole challenge on wrong
     * guesses, and `customer-phone-verify` allows ten attempts per quarter of an
     * hour per number *and* per address. Six more sign-ins on top of that is well
     * past it — which is exactly what should happen to anybody trying six codes
     * against one number in a second. Clearing this script's own counters is the
     * only honest way to keep testing what comes after.
     */
    await clearOwnRateLimits();

    for (const spelling of SPELLINGS) {
      const signIn: Jar = new Map();
      await storeChallenge(tenant.tenantRef, E164, KNOWN_CODE);

      const verified = await shop('/auth/phone/verify', {
        method: 'POST',
        jar: signIn,
        body: { phone: spelling, code: KNOWN_CODE },
      });

      check(
        `"${spelling}" signs in to the account that already exists`,
        verified.body?.data?.status === 'signed_in',
        { status: verified.status, data: verified.body?.data },
      );
    }

    const [{ count }] = await sql<{ count: string }>(
      "select count(*)::text as count from customers where full_name = 'Zz Phone'",
    );
    check('and six sign-ins made exactly one account', count === '1', count);
  }

  console.log('\n5. Email and password still work, and are still a separate account');
  {
    const registered = await shop('/auth/register', {
      method: 'POST',
      body: { fullName: 'Zz Email', email: EMAIL, password: PASSWORD, acceptsTerms: true },
    });
    check('an email account can still be created', registered.status === 201, registered.body);
    check('and reports that it has a password', registered.body?.data?.customer?.hasPassword === true, registered.body?.data?.customer);

    const signedIn = await shop('/auth/login', {
      method: 'POST',
      body: { email: EMAIL, password: PASSWORD },
    });
    check('and signs in', signedIn.status === 200, signedIn.status);

    const forgotten = await shop('/auth/forgot-password', { method: 'POST', body: { email: EMAIL } });
    check('a reset can still be asked for', forgotten.status === 204, forgotten.status);
  }

  console.log('\n6. Google');
  {
    const configured = config.oauth.google !== null;

    const start = await shop('/auth/google/start');

    if (!configured) {
      check('unconfigured, the start route refuses rather than half-working', start.status === 503, start.status);
    } else {
      check('configured, the start route hands back a URL', start.status === 200, start.body);
      const url = String(start.body?.data?.url ?? '');
      check('which is Google', url.startsWith('https://accounts.google.com/'), url.slice(0, 60));
      check('and carries a state', new URL(url).searchParams.has('state'), url.slice(0, 120));
      check(
        'pointing at the one platform-wide redirect URI',
        new URL(url).searchParams.get('redirect_uri') ===
          `${config.api.publicUrl.replace(/\/$/, '')}/api/v1/oauth/google/callback`,
        new URL(url).searchParams.get('redirect_uri'),
      );
    }

    const exchanged = await shop('/auth/google/exchange', {
      method: 'POST',
      body: { code: 'zz-not-a-real-handoff-code-at-all' },
    });
    check('an unknown hand-off code signs nobody in', exchanged.status === 401, exchanged.status);

    // The callback is the one route on this API with no store behind it, so it
    // is reached on the API's own hostname rather than on a shop's.
    const callback = await call('localhost', '/api/v1/oauth/google/callback?state=zz-nonsense');
    check('an unknown callback state is refused', callback.status === 400, callback.status);
    check('and nothing is redirected anywhere', !callback.location, callback.location);
  }

  const configResponse = await shop('/config');
  check(
    'the storefront is told which ways in are available',
    typeof configResponse.body?.data?.auth?.google === 'boolean' &&
      configResponse.body?.data?.auth?.phone === true,
    configResponse.body?.data?.auth,
  );

  if (!KEEP) {
    console.log('\nCleaning up…');
    await cleanup(sql);
  }

  await pool.end().catch(() => undefined);

  console.log(`\n${passed} passed, ${failed} failed.\n`);
  if (failed > 0) process.exitCode = 1;
}

/** Everything this script creates, in dependency order. */
async function cleanup(sql: (text: string, params?: unknown[]) => Promise<any[]>): Promise<void> {
  await sql(
    `delete from customer_identities where customer_id in (
       select id from customers where phone_e164 = $1 or email = $2)`,
    [E164, EMAIL],
  );
  await sql('delete from customer_tokens where customer_id in (select id from customers where email = $1)', [EMAIL]);
  await sql('delete from customers where phone_e164 = $1 or email = $2', [E164, EMAIL]);
}

await main();
await closeRedis().catch(() => undefined);

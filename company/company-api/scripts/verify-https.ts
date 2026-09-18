/**
 * The control plane's transport posture, proved rather than assumed.
 *
 *   npx tsx scripts/verify-https.ts
 *
 * Needs no running server, no database and no network, which is the point.
 * HTTPS is the one guarantee whose failure has no symptom: an API served over
 * plaintext answers identically and logs identically to one served over TLS, and
 * the only difference is who else can read it. So the checks are on the code
 * paths that decide it:
 *
 *   1. `plugins/https.ts`   — a plaintext request is refused or upgraded.
 *   2. `lib/secure-url.ts`  — what may be stored in, or redirected to, a URL.
 *   3. `config/env.ts`      — what a production deployment may boot with.
 *
 * A deliberate counterpart to `client-api/scripts/verify-https.ts`; the two APIs
 * deploy independently and each has to be able to prove its own posture.
 */
import Fastify from 'fastify';
import { envSchema } from '../src/config/env';
import { AppError, ERROR_CODES } from '../src/lib/errors';
import errorHandlerPlugin from '../src/plugins/error-handler';
import { httpsUrl, isSecureUrl } from '../src/lib/secure-url';

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

// ---------------------------------------------------------------------------
// 1. The request hook
// ---------------------------------------------------------------------------
console.log('\nplugins/https.ts - plaintext requests\n');

/**
 * Registered here rather than imported, because the plugin reads
 * `config.security.forceHttps`, which follows NODE_ENV and is off while this
 * script runs — and `config` is a module-level singleton that whatever imported
 * it first has already frozen. These are the lines under test; `app.ts` covers
 * the registration by construction.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD']);
const HOST_RE = /^[a-z0-9.-]{1,253}(?::\d{1,5})?$/i;

const app = Fastify({ logger: false, trustProxy: true });
await app.register(errorHandlerPlugin);
app.addHook('onRequest', async (request, reply) => {
  if (request.protocol === 'https') return;
  if (request.url.startsWith('/health')) return;

  const host = request.headers['x-forwarded-host'] ?? request.headers.host;
  const target = typeof host === 'string' && HOST_RE.test(host) ? host : null;

  if (SAFE_METHODS.has(request.method) && target) {
    return reply.redirect(`https://${target}${request.url}`, 307);
  }
  throw new AppError(ERROR_CODES.HTTPS_REQUIRED, 'HTTPS only.', 403);
});
app.get('/health', async () => ({ status: 'ok' }));
app.get('/api/v1/public/plans', async () => ({ data: [] }));
app.post('/api/v1/admin/login', async () => ({ data: null }));
app.get('/api/v1/internal/tenants/by-slug', async () => ({ data: null }));

const secure = { 'x-forwarded-proto': 'https', host: 'api.company.com' };
const plain = { 'x-forwarded-proto': 'http', host: 'api.company.com' };

let res = await app.inject({ method: 'GET', url: '/api/v1/public/plans', headers: plain });
check('a plaintext GET is redirected', res.statusCode === 307, res.statusCode);
check(
  'the redirect goes to https, on the same host and path',
  res.headers.location === 'https://api.company.com/api/v1/public/plans',
  res.headers.location,
);
check('the redirect is temporary, so a mislabelling proxy cannot pin a loop', res.statusCode !== 308, res.statusCode);

res = await app.inject({ method: 'POST', url: '/api/v1/admin/login', headers: plain });
check('a plaintext sign-in is refused, never redirected', res.statusCode === 403, res.statusCode);
check('and it is refused by name', JSON.parse(res.body).code === 'HTTPS_REQUIRED', JSON.parse(res.body).code);

res = await app.inject({ method: 'GET', url: '/api/v1/internal/tenants/by-slug', headers: plain });
check(
  'the internal tenant lookup is NOT exempt - it carries INTERNAL_API_KEY',
  res.statusCode === 307,
  res.statusCode,
);

res = await app.inject({ method: 'POST', url: '/api/v1/admin/login', headers: secure });
check('an https sign-in is served', res.statusCode === 200, res.statusCode);

res = await app.inject({ method: 'GET', url: '/health', headers: plain });
check(
  'the liveness probe is exempt, so TLS at the edge is not a health dependency',
  res.statusCode === 200,
  res.statusCode,
);

res = await app.inject({
  method: 'GET',
  url: '/api/v1/public/plans',
  headers: { 'x-forwarded-proto': 'http', host: 'evil.com/@attacker' },
});
check(
  'a Host that is not a hostname is refused rather than built into a Location',
  res.statusCode === 403,
  res.statusCode,
);

await app.close();

// ---------------------------------------------------------------------------
// 2. Addresses a browser can be steered to
// ---------------------------------------------------------------------------
console.log('\nlib/secure-url.ts - redirect targets\n');

/**
 * Every one of these passes `z.string().url()`, which is why that validator was
 * the wrong one for a value handed to `reply.redirect`.
 */
const HOSTILE = [
  'javascript:alert(document.cookie)',
  'JaVaScRiPt:alert(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
];

const redirect = httpsUrl();
for (const value of HOSTILE) {
  check(`refused: ${value.slice(0, 44)}`, !redirect.safeParse(value).success);
}

check('refused: http://company.com - a plaintext return address', !redirect.safeParse('http://company.com').success);
check('accepted: https://company.com', redirect.safeParse('https://company.com/dashboard').success);
check('production refuses http://localhost too', !isSecureUrl('http://localhost:3000', { allowLoopback: false }));
check('development allows it', isSecureUrl('http://localhost:3000', { allowLoopback: true }));

// ---------------------------------------------------------------------------
// 3. What a production deployment may boot with
// ---------------------------------------------------------------------------
console.log('\nconfig/env.ts - the production boot gate\n');

const SECRET = 'a'.repeat(43);

/** A production environment with nothing wrong with it. */
const base: Record<string, string> = {
  NODE_ENV: 'production',
  COMPANY_DATABASE_URL: 'postgresql://u:p@db.company.com:5432/company_control_db?sslmode=require',
  REDIS_URL: 'rediss://user:pass@redis.company.com:6379',
  API_PUBLIC_URL: 'https://api.company.com',
  WEBSITE_URL: 'https://company.com',
  ADMIN_URL: 'https://admin.company.com',
  CLIENT_ADMIN_URL_PATTERN: 'https://admin.{slug}.company.com',
  ADMIN_AUTH_SECRET: SECRET,
  CLIENT_AUTH_SECRET: SECRET,
  ENCRYPTION_KEY: SECRET,
  INTERNAL_API_KEY: 'k'.repeat(32),
  TENANT_DB_HOST: 'db1',
  TENANT_DB_ADMIN_USER: 'u',
  TENANT_DB_ADMIN_PASSWORD: 'p',
  TENANT_DB_SSL: 'true',
  TENANT_SHARDS: JSON.stringify([
    { id: 'shard-1', host: 'db1', port: 5432, user: 'u', password: 'p', ssl: true, capacity: 100 },
  ]),
  PAYMENT_WEBHOOK_SECRET: 's'.repeat(32),
  R2_PUBLIC_URL: 'https://media.company.com',
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
};

function boots(overrides: Record<string, string>): boolean {
  return envSchema.safeParse({ ...base, ...overrides }).success;
}

check('a fully https production environment boots', boots({}), envSchema.safeParse(base).error?.issues);

check(
  'http WEBSITE_URL is refused - it is every emailed link, and a trusted CORS origin',
  !boots({ WEBSITE_URL: 'http://company.com' }),
);
check(
  'http ADMIN_URL is refused - the super-admin panel, and a trusted CORS origin',
  !boots({ ADMIN_URL: 'http://admin.company.com' }),
);
check(
  'http CLIENT_ADMIN_URL_PATTERN is refused - the address given to every new owner',
  !boots({ CLIENT_ADMIN_URL_PATTERN: 'http://admin.{slug}.company.com' }),
);
check('http R2_PUBLIC_URL is refused', !boots({ R2_PUBLIC_URL: 'http://media.company.com' }));

check(
  'plaintext Redis is refused - it holds the session tokens',
  !boots({ REDIS_URL: 'redis://user:pass@redis.company.com:6379' }),
);
check(
  'a control database without sslmode is refused - it holds every account on the platform',
  !boots({ COMPANY_DATABASE_URL: 'postgresql://u:p@db.company.com:5432/company_control_db' }),
);
check(
  'sslmode=verify-full satisfies it too',
  boots({ COMPANY_DATABASE_URL: 'postgresql://u:p@db.company.com:5432/db?sslmode=verify-full' }),
);
check(
  'sslmode=prefer does not - it falls back to plaintext without saying so',
  !boots({ COMPANY_DATABASE_URL: 'postgresql://u:p@db.company.com:5432/db?sslmode=prefer' }),
);
check(
  'and neither does sslmode=disable',
  !boots({ COMPANY_DATABASE_URL: 'postgresql://u:p@db.company.com:5432/db?sslmode=disable' }),
);
check(
  'a shard without ssl is refused - provisioning writes store credentials over it',
  !boots({
    TENANT_SHARDS: JSON.stringify([
      { id: 'shard-1', host: 'db1', port: 5432, user: 'u', password: 'p', ssl: false, capacity: 100 },
    ]),
  }),
);
check(
  'ALLOW_PLAINTEXT_DATA_STORES is the deliberate, documented opt-out',
  boots({
    REDIS_URL: 'redis://r',
    COMPANY_DATABASE_URL: 'postgresql://u:p@db/x',
    TENANT_DB_SSL: 'false',
    ALLOW_PLAINTEXT_DATA_STORES: 'true',
  }),
);
check(
  'but it does not soften the HTTPS rules',
  !boots({ ALLOW_PLAINTEXT_DATA_STORES: 'true', WEBSITE_URL: 'http://company.com' }),
);

check(
  'development is exempt, so six apps on localhost still talk to each other',
  boots({
    NODE_ENV: 'development',
    WEBSITE_URL: 'http://localhost:3000',
    ADMIN_URL: 'http://localhost:3001',
    COMPANY_DATABASE_URL: 'postgresql://u:p@localhost:5432/company_control_db',
    REDIS_URL: 'redis://localhost:6379',
    TENANT_DB_SSL: 'false',
  }),
);

// ---------------------------------------------------------------------------
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

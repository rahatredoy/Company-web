/**
 * The platform's transport posture, proved rather than assumed.
 *
 *   npx tsx scripts/verify-https.ts
 *
 * Three things are checked, and none of them needs a running server, a database
 * or a network — which is the point. HTTPS is the one guarantee whose failure
 * has no symptom: a platform served over plaintext renders identically, answers
 * identically and logs identically to one served over TLS. The only difference
 * is who else can read it. So the checks are on the code paths that decide it:
 *
 *   1. `plugins/https.ts`   — a plaintext request is refused or upgraded.
 *   2. `lib/secure-url.ts`  — what an owner may store in a URL column.
 *   3. `config/env.ts`      — what a production deployment may boot with.
 *
 * The env schema is exercised against a synthetic environment rather than the
 * real one, so this passes in development without the developer having to hold
 * a production `.env` to run it.
 */
import Fastify from 'fastify';
import { envSchema } from '../src/config/env';
import { AppError, ERROR_CODES } from '../src/lib/errors';
import errorHandler from '../src/plugins/error-handler';
import { httpsUrl, isSecureUrl, linkTarget } from '../src/lib/secure-url';

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
 * The plugin reads `config.security.forceHttps`, which follows NODE_ENV and is
 * therefore off while this script runs. Setting the variable first would not
 * help: `config` is a module-level singleton that whatever imported it first has
 * already frozen. So the hook is registered here directly — it is nine lines,
 * and it is those nine lines that are under test rather than the one-line
 * registration in `app.ts`.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD']);
const HOST_RE = /^[a-z0-9.-]{1,253}(?::\d{1,5})?$/i;

const app = Fastify({ logger: false, trustProxy: true });
await app.register(errorHandler);
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
app.get('/api/v1/storefront/products', async () => ({ data: [] }));
app.post('/api/v1/admin/products', async () => ({ data: null }));

const secure = { 'x-forwarded-proto': 'https', host: 'abc-fashion.company.com' };
const plain = { 'x-forwarded-proto': 'http', host: 'abc-fashion.company.com' };

let res = await app.inject({ method: 'GET', url: '/api/v1/storefront/products', headers: plain });
check('a plaintext GET is redirected', res.statusCode === 307, res.statusCode);
check(
  'the redirect goes to https, on the same host and path',
  res.headers.location === 'https://abc-fashion.company.com/api/v1/storefront/products',
  res.headers.location,
);
check(
  'the redirect is temporary, so a mislabelling proxy cannot pin a loop',
  res.statusCode !== 308,
  res.statusCode,
);

res = await app.inject({ method: 'POST', url: '/api/v1/admin/products', headers: plain });
check('a plaintext POST is refused, never redirected', res.statusCode === 403, res.statusCode);
check('and it is refused by name', JSON.parse(res.body).code === 'HTTPS_REQUIRED', JSON.parse(res.body).code);

res = await app.inject({ method: 'GET', url: '/api/v1/storefront/products', headers: secure });
check('an https GET is served', res.statusCode === 200, res.statusCode);

res = await app.inject({ method: 'POST', url: '/api/v1/admin/products', headers: secure });
check('an https POST is served', res.statusCode === 200, res.statusCode);

res = await app.inject({ method: 'GET', url: '/health', headers: plain });
check(
  'the liveness probe is exempt, so TLS at the edge is not a health dependency',
  res.statusCode === 200,
  res.statusCode,
);

res = await app.inject({
  method: 'GET',
  url: '/api/v1/storefront/products',
  headers: { 'x-forwarded-proto': 'http', host: 'evil.com/@attacker' },
});
check(
  'a Host that is not a hostname is refused rather than built into a Location',
  res.statusCode === 403,
  res.statusCode,
);

await app.close();

// ---------------------------------------------------------------------------
// 2. What an owner may store in a URL column
// ---------------------------------------------------------------------------
console.log('\nlib/secure-url.ts - owner-supplied addresses\n');

/**
 * Every one of these passes `z.string().url()`, which is why that validator was
 * the wrong one. The first two are the whole of stored XSS: these columns are
 * rendered by the storefront as an `href` and a `src`, so a `javascript:` value
 * in one is script the shop serves to its own customers under its own origin.
 */
const HOSTILE = [
  'javascript:alert(document.cookie)',
  'JaVaScRiPt:alert(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
];

const productImage = httpsUrl();
for (const value of HOSTILE) {
  check(`refused: ${value.slice(0, 44)}`, !productImage.safeParse(value).success);
}

check(
  'refused: http://cdn.example.com - plaintext, and mixed content on an https page',
  !productImage.safeParse('http://cdn.example.com/a.png').success,
);
check('accepted: https://cdn.example.com', productImage.safeParse('https://cdn.example.com/a.png').success);

check(
  'production refuses http://localhost too',
  !isSecureUrl('http://localhost:4100/a.png', { allowLoopback: false }),
);
check(
  'development allows it, where there is no network to sit on',
  isSecureUrl('http://localhost:4100/a.png', { allowLoopback: true }),
);

const destination = linkTarget();
check('a banner may point at an internal path', destination.safeParse('/sale').success);
check('a banner may point at an https address', destination.safeParse('https://example.com').success);
check('but not at //evil.com - off-site wearing a path’s clothes', !destination.safeParse('//evil.com').success);
check('and not at javascript:', !destination.safeParse('javascript:alert(1)').success);
check('clearing a destination is still expressible', destination.safeParse('').success);

// ---------------------------------------------------------------------------
// 3. What a production deployment may boot with
// ---------------------------------------------------------------------------
console.log('\nconfig/env.ts - the production boot gate\n');

const SECRET = 'a'.repeat(43);

/** A production environment with nothing wrong with it. */
const base: Record<string, string> = {
  NODE_ENV: 'production',
  API_PUBLIC_URL: 'https://api.company.com',
  REDIS_URL: 'rediss://user:pass@redis.company.com:6379',
  COMPANY_API_URL: 'https://api.company.com',
  INTERNAL_API_KEY: 'k'.repeat(32),
  TENANT_DB_HOST: 'db1',
  TENANT_DB_ADMIN_USER: 'u',
  TENANT_DB_ADMIN_PASSWORD: 'p',
  TENANT_DB_SSL: 'true',
  TENANT_SHARDS: JSON.stringify([
    { id: 'shard-1', host: 'db1', port: 5432, user: 'u', password: 'p', ssl: true, capacity: 100 },
  ]),
  ADMIN_URL_PATTERN: 'https://admin.{slug}.company.com',
  STORE_URL_PATTERN: 'https://{slug}.company.com',
  STORE_AUTH_SECRET: SECRET,
  ENCRYPTION_KEY: SECRET,
  PAYMENT_WEBHOOK_SECRET: 's'.repeat(32),
  R2_PUBLIC_URL: 'https://media.company.com',
  R2_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
};

function boots(overrides: Record<string, string>): boolean {
  return envSchema.safeParse({ ...base, ...overrides }).success;
}

check('a fully https production environment boots', boots({}), envSchema.safeParse(base).error?.issues);

check(
  'http STORE_URL_PATTERN is refused - it is the link in customer email',
  !boots({ STORE_URL_PATTERN: 'http://{slug}.company.com' }),
);
check(
  'http ADMIN_URL_PATTERN is refused - it is where a password reset lands',
  !boots({ ADMIN_URL_PATTERN: 'http://admin.{slug}.company.com' }),
);
check(
  'http COMPANY_API_URL is refused - every lookup carries INTERNAL_API_KEY',
  !boots({ COMPANY_API_URL: 'http://api.company.com' }),
);
check(
  'http R2_PUBLIC_URL is refused - mixed content on every product page',
  !boots({ R2_PUBLIC_URL: 'http://media.company.com' }),
);

check(
  'plaintext Redis is refused - it holds the session tokens',
  !boots({ REDIS_URL: 'redis://user:pass@redis.company.com:6379' }),
);
check(
  'a shard without ssl is refused - it holds customer addresses',
  !boots({
    TENANT_SHARDS: JSON.stringify([
      { id: 'shard-1', host: 'db1', port: 5432, user: 'u', password: 'p', ssl: false, capacity: 100 },
    ]),
  }),
);
check('TENANT_DB_SSL=false is refused for the same reason', !boots({ TENANT_DB_SSL: 'false' }));
check(
  'ALLOW_PLAINTEXT_DATA_STORES is the deliberate, documented opt-out',
  boots({ REDIS_URL: 'redis://r', TENANT_DB_SSL: 'false', ALLOW_PLAINTEXT_DATA_STORES: 'true' }),
);
check(
  'but it does not soften the HTTPS rules',
  !boots({ ALLOW_PLAINTEXT_DATA_STORES: 'true', STORE_URL_PATTERN: 'http://{slug}.company.com' }),
);

check(
  'development is exempt, so six apps on localhost still talk to each other',
  boots({
    NODE_ENV: 'development',
    STORE_URL_PATTERN: 'http://{slug}.localhost:3003',
    REDIS_URL: 'redis://localhost:6379',
    TENANT_DB_SSL: 'false',
  }),
);

// ---------------------------------------------------------------------------
console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);

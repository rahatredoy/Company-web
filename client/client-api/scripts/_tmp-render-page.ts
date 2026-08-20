/**
 * Renders one admin-panel page against the running dev server, signed in.
 *
 * A store-admin session row is planted for the store's existing admin and
 * removed again, so no password has to be known and nobody's login is disturbed.
 * The point is to prove the page renders with real data rather than only that it
 * compiles.
 *
 *   npx tsx scripts/_tmp-render-page.ts /products "Total Products" "Add Product"
 */
import { randomBytes, createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { closeRedis } from '../src/lib/redis';

const PATH = process.argv[2] ?? '/products';
const MARKERS = process.argv.slice(3);
const SLUG = config.devStoreSlug ?? 'e-comarch';
const PORT = 3002;

function get(path: string, cookie: string): Promise<{ status: number; html: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: PORT, path, method: 'GET', headers: { cookie, accept: 'text/html' } },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, html: raw }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const pool = await openTenantPoolForSlug(SLUG);
  const admin = (await pool.query<{ id: string; email: string }>('select id, email from store_admins limit 1')).rows[0];
  if (!admin) throw new Error(`No store admin in ${SLUG}.`);

  const ref = (
    await pool.query<{ tenant_ref: string }>('select tenant_ref from admin_sessions order by created_at desc limit 1')
  ).rows[0];
  if (!ref) throw new Error('No previous session to read tenantRef from — sign in to the panel once.');

  const token = randomBytes(32).toString('base64url');
  const session = (
    await pool.query<{ id: string }>(
      `insert into admin_sessions (admin_id, token_hash, tenant_ref, mfa_verified, remember, expires_at)
       values ($1, $2, $3, true, false, now() + interval '15 minutes') returning id`,
      [admin.id, createHash('sha256').update(token).digest('hex'), ref.tenant_ref],
    )
  ).rows[0]!;

  try {
    const page = await get(PATH, `store_admin_session=${token}`);
    console.log(`\n  GET ${PATH} → ${page.status}  (${page.html.length} bytes)\n`);

    let failed = page.status !== 200;
    for (const marker of MARKERS) {
      const found = page.html.includes(marker);
      if (!found) failed = true;
      console.log(`  ${found ? 'PASS' : 'FAIL'}  page says “${marker}”`);
    }

    // A Next.js error page still answers 200, so look for its fingerprints too.
    for (const smell of ['Application error', 'Internal Server Error', 'Unhandled Runtime Error']) {
      if (page.html.includes(smell)) {
        failed = true;
        console.log(`  FAIL  page contains “${smell}”`);
      }
    }

    console.log(failed ? '\n  FAILED\n' : '\n  OK\n');
    process.exitCode = failed ? 1 : 0;
  } finally {
    await pool.query('delete from admin_sessions where id = $1', [session.id]);
    await pool.end();
    await closeRedis().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

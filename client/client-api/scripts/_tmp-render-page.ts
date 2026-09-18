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
import { request as httpRequest } from 'node:http';
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { closeRedis } from '../src/lib/redis';
import { fetchTenantBySlug } from '../src/lib/company-client';
import { createAdminSession, revokeSession } from '../src/lib/session';

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

  /*
   * A short-lived panel session, minted through the API's own session module.
   * There is no table to plant a row in any more — the cookie carries a signed
   * JWT — and the tenant reference now comes from the control plane rather than
   * from whatever session happened to be lying about.
   */
  const tenant = await fetchTenantBySlug(SLUG);
  if (!tenant) throw new Error(`No tenant registered for ${SLUG}.`);

  const session = await createAdminSession(null, {
    adminId: admin.id,
    tenantRef: tenant.tenantRef,
    mfaVerified: true,
    remember: false,
  });
  const token = session.token;

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
    await revokeSession(tenant.tenantRef, session.id);
    await pool.end();
    await closeRedis().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

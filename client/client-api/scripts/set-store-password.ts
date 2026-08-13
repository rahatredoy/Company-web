/**
 * Sets (or resets) the store admin's password directly in the tenant database.
 *
 *   npx tsx scripts/set-store-password.ts --slug abc-fashion --password 'Secret123'
 *   npx tsx scripts/set-store-password.ts --slug abc-fashion --email owner@… --password 'Secret123'
 *
 * The normal path is the credential the store was registered with on the company
 * platform, kept in step from there. This exists for development and for support
 * recovery, which is why it needs direct database access and cannot be reached
 * from any browser.
 *
 * Every session on the account is revoked, exactly as a real password change
 * does — otherwise an old cookie would keep working after a reset.
 */
import { config } from '../src/config/index';
import { openTenantPoolForSlug } from '../src/db/tenant-manager';
import { hashPassword } from '../src/lib/password';
import { closeRedis } from '../src/lib/redis';

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

const slug = arg('slug') ?? config.devStoreSlug;
const email = arg('email')?.toLowerCase();
const password = arg('password');

async function main(): Promise<void> {
  if (!slug || !password) {
    console.error('Usage: --slug <store-slug> [--email <owner email>] --password <new password>');
    process.exitCode = 1;
    return;
  }

  if (password.length < 10) {
    // The API enforces this on the real form; a back door that accepts weaker
    // passwords than the front door is not a back door worth having.
    console.error('Password must be at least 10 characters.');
    process.exitCode = 1;
    return;
  }

  const pool = await openTenantPoolForSlug(slug);

  try {
    const { rows } = await pool.query(
      email
        ? `select id, email, full_name, role_key from store_admins where lower(email) = $1 limit 1`
        : `select id, email, full_name, role_key from store_admins order by created_at limit 1`,
      email ? [email] : [],
    );

    const admin = rows[0];
    if (!admin) {
      console.error(`No store admin found in ${slug}${email ? ` for ${email}` : ''}.`);
      process.exitCode = 1;
      return;
    }

    const hash = await hashPassword(password);

    await pool.query(
      `update store_admins
          set password_hash = $2,
              password_changed_at = now(),
              account_status = 'active',
              status = 'active',
              failed_login_count = 0,
              locked_until = null,
              updated_at = now()
        where id = $1`,
      [admin.id, hash],
    );

    // Any session minted against the old password must die with it.
    await pool.query(
      `update admin_sessions set revoked_at = now() where admin_id = $1 and revoked_at is null`,
      [admin.id],
    );

    console.log(`\n  ${slug}`);
    console.log(`    ${admin.email}  (${admin.full_name}, ${admin.role_key})`);
    console.log(`    password set, account active, other sessions revoked`);
    console.log(`    sign in at http://${slug}.localhost:3002\n`);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis().catch(() => undefined);
    process.exit(process.exitCode ?? 0);
  });

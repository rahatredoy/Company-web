/**
 * Changes the company admin's sign-in email, password, or both.
 *
 *   npx tsx scripts/set-admin-credentials.ts --email you@example.com --password 'NewPass!2026'
 *   npx tsx scripts/set-admin-credentials.ts --password 'NewPass!2026'
 *   npx tsx scripts/set-admin-credentials.ts            # takes both from .env
 *
 * There is exactly one admin row and no endpoint creates or renames it, so this
 * script is the only way to move that login — `db:seed` deliberately refuses to
 * touch an admin that already exists.
 *
 * Changing either half signs every device out and forgets every remembered
 * browser: the next sign-in proves the new credential from scratch, with a
 * passcode. The password is written as an Argon2id hash by the same helper the
 * API verifies with; plaintext is never stored.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, closeDatabase } from '../src/db/client';
import { companyAdmin } from '../src/db/schema/index';
import { config } from '../src/config/index';
import { hashPassword } from '../src/lib/password';
import { revokeAllAdminSessions } from '../src/lib/session';
import { forgetAllDevices } from '../src/lib/trusted-device';
import { closeRedis } from '../src/lib/redis';

/** Mirrors `adminPasswordSchema` in `modules/admin/auth.routes.ts`. */
const passwordRule = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(200)
  .refine((v) => /[a-z]/.test(v), 'Include at least one lowercase letter.')
  .refine((v) => /[A-Z]/.test(v), 'Include at least one uppercase letter.')
  .refine((v) => /\d/.test(v), 'Include at least one number.')
  .refine((v) => /[^A-Za-z0-9]/.test(v), 'Include at least one symbol.');

const emailRule = z.string().trim().toLowerCase().email('Enter a valid email address.');

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exitCode = 1;
  throw new Error(message);
}

async function main(): Promise<void> {
  // Falling back to .env keeps this script and `db:seed` describing the same
  // admin, so a fresh database and an existing one end up with one login.
  const rawEmail = flag('email') ?? config.bootstrapAdmin.email;
  const rawPassword = flag('password') ?? config.bootstrapAdmin.password;

  const email = emailRule.safeParse(rawEmail);
  if (!email.success) fail(`--email: ${email.error.issues[0]!.message}`);

  if (!rawPassword) {
    fail('No password given. Pass --password, or set COMPANY_ADMIN_PASSWORD in .env.');
  }
  const password = passwordRule.safeParse(rawPassword);
  if (!password.success) {
    fail(`--password: ${password.error.issues.map((i) => i.message).join(' ')}`);
  }

  const [admin] = await db.select().from(companyAdmin).limit(1);
  if (!admin) fail('No company admin exists yet. Run `npm run db:seed` first.');

  const now = new Date();
  await db
    .update(companyAdmin)
    .set({
      email: email.data,
      passwordHash: await hashPassword(password.data),
      passwordChangedAt: now,
      // A lockout counted against the old credential should not follow the new
      // one, or a change made *because* of a lockout leaves you still locked.
      failedLoginCount: 0,
      lockedUntil: null,
      status: 'active',
      updatedAt: now,
    })
    .where(eq(companyAdmin.id, admin.id));

  await revokeAllAdminSessions(admin.id);
  await forgetAllDevices(admin.id);

  const renamed = admin.email.toLowerCase() !== email.data;
  console.log('\n  ✓ Company admin updated.');
  console.log(`    email     ${renamed ? `${admin.email} → ${email.data}` : email.data}`);
  console.log('    password  set (Argon2id)');
  console.log('    sessions  all revoked, all remembered browsers forgotten');
  console.log(`\n  Sign in at ${config.urls.admin}/sign-in — the first sign-in needs an emailed passcode.\n`);
}

try {
  await main();
} finally {
  await closeDatabase();
  await closeRedis();
}

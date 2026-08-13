import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { tenantAdminConnection } from '../db/tenant-connection';
import { resolveShard } from './tenant-shards';
import { tenants } from '../db/schema/index';
import { AppError, ERROR_CODES, conflict } from '../lib/errors';
import { logger } from '../lib/logger';
import {
  OTP_MAX_ATTEMPTS,
  generateOtp,
  hashOtp,
  isOtpExpired,
  otpExpiry,
  resendWaitSeconds,
  verifyOtp,
} from '../lib/otp';
import { config } from '../config/index';

type Tenant = typeof tenants.$inferSelect;

/**
 * The store admin panel's login is not a SaaS account: it lives in the store's
 * own database and the client dashboard only ever reaches it through here.
 *
 * Two things need proof that the owner can read the address they typed — naming
 * the login when the store is set up, and resetting its password afterwards —
 * and both use the same emailed passcode, held on the tenant row. Only one
 * challenge exists at a time, so starting a reset abandons a half-finished
 * setup rather than leaving two live codes for one mailbox.
 */
export type StoreAdminOtpPurpose = 'admin_panel_setup' | 'admin_password_reset';

export interface StoreAdminChallenge {
  sentTo: string;
  expiresAt: Date;
  code: string;
}

/**
 * Refuses a second code inside the cooldown, so this is not a way to bury
 * someone's inbox. Callers surface the wait in seconds rather than a bare 429.
 */
export function assertResendAllowed(tenant: Tenant, purpose: StoreAdminOtpPurpose): void {
  if (tenant.storeAdminOtpPurpose !== purpose || !tenant.storeAdminOtpHash) return;

  const wait = resendWaitSeconds(tenant.storeAdminOtpSentAt);
  if (wait > 0) {
    throw new AppError(
      ERROR_CODES.OTP_RESEND_TOO_SOON,
      `Please wait ${wait} more seconds before requesting another code.`,
      429,
    );
  }
}

/**
 * Issues a passcode and stores only its hash. The caller sends the returned code
 * and never persists it — the plaintext exists for exactly the length of one
 * request.
 */
export async function issueStoreAdminOtp(
  tenantId: string,
  purpose: StoreAdminOtpPurpose,
  sentTo: string,
): Promise<StoreAdminChallenge> {
  const code = generateOtp();
  const expiresAt = otpExpiry(config.security.otpTtlMinutes);

  await db
    .update(tenants)
    .set({
      storeAdminOtpPurpose: purpose,
      storeAdminOtpHash: hashOtp(code),
      storeAdminOtpExpiresAt: expiresAt,
      storeAdminOtpSentAt: new Date(),
      storeAdminOtpAttempts: 0,
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, tenantId));

  return { code, expiresAt, sentTo };
}

async function clearChallenge(tenantId: string, extra: Partial<Tenant> = {}): Promise<void> {
  await db
    .update(tenants)
    .set({
      storeAdminOtpPurpose: null,
      storeAdminOtpHash: null,
      storeAdminOtpExpiresAt: null,
      storeAdminOtpSentAt: null,
      storeAdminOtpAttempts: 0,
      updatedAt: new Date(),
      ...extra,
    })
    .where(eq(tenants.id, tenantId));
}

/**
 * Checks a submitted code and burns the challenge either way it ends: on success
 * because a passcode is single-use, and on the last wrong guess because six
 * digits with unlimited attempts is not a second factor.
 *
 * The tenant row is re-read here rather than trusted from the caller — the
 * attempt counter has to be the stored one, or the cap counts nothing.
 */
export async function consumeStoreAdminOtp(
  tenantId: string,
  purpose: StoreAdminOtpPurpose,
  code: string,
): Promise<void> {
  const rows = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  const tenant = rows[0];

  if (!tenant || tenant.storeAdminOtpPurpose !== purpose || !tenant.storeAdminOtpHash) {
    throw new AppError(ERROR_CODES.OTP_REQUIRED, 'Request a new code to continue.', 409);
  }

  if (isOtpExpired(tenant.storeAdminOtpExpiresAt)) {
    await clearChallenge(tenantId);
    throw new AppError(ERROR_CODES.OTP_EXPIRED, 'That code has expired. Request a new one.', 410);
  }

  if (tenant.storeAdminOtpAttempts >= OTP_MAX_ATTEMPTS) {
    await clearChallenge(tenantId);
    throw new AppError(ERROR_CODES.OTP_TOO_MANY_ATTEMPTS, 'Too many attempts. Request a new code.', 429);
  }

  if (!verifyOtp(tenant.storeAdminOtpHash, code)) {
    const attempts = tenant.storeAdminOtpAttempts + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await clearChallenge(tenantId);
      throw new AppError(ERROR_CODES.OTP_TOO_MANY_ATTEMPTS, 'Too many attempts. Request a new code.', 429);
    }

    await db
      .update(tenants)
      .set({ storeAdminOtpAttempts: attempts, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));

    throw new AppError(ERROR_CODES.OTP_INVALID, 'That code is not correct.', 422, {
      details: { code: ['That code is not correct.'] },
    });
  }

  // Setup is the flow that proves the address, so its success is what records
  // the address as proven; a reset is proof of the same thing and never needs to
  // undo it.
  await clearChallenge(
    tenantId,
    purpose === 'admin_panel_setup' ? { storeAdminEmailVerifiedAt: new Date() } : {},
  );
}

/**
 * Writes a new store admin password to wherever the live credential currently
 * is: the staging column while the store is still a draft, and the store's own
 * database once provisioning has copied it across.
 *
 * Every existing panel session is dropped with it. A reset that leaves an
 * already-open session working protects nobody — the reason to reset is usually
 * that someone else may be holding one.
 */
export async function applyStoreAdminPassword(tenant: Tenant, passwordHash: string): Promise<void> {
  if (tenant.storeStatus === 'creating') {
    throw conflict(
      'Your store is still being created. Try again once it is ready.',
      ERROR_CODES.PROVISIONING_IN_PROGRESS,
    );
  }

  const live = tenant.storeStatus === 'ready' || tenant.storeStatus === 'suspended';

  // Not built yet (or the build failed): the tenant database may not exist, and
  // provisioning reads the staged hash on its next run anyway.
  if (!live || !tenant.databaseName) {
    await db
      .update(tenants)
      .set({ storeAdminPasswordHash: passwordHash, updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));
    return;
  }

  const email = tenant.storeAdminEmail;
  if (!email) {
    throw new AppError(ERROR_CODES.STORE_ADMIN_NOT_FOUND, 'This store has no admin login recorded.', 409);
  }

  const client = tenantAdminConnection(resolveShard(tenant.databaseShard), tenant.databaseName);
  await client.connect();
  try {
    const updated = await client.query(
      `update store_admins
          set password_hash = $1,
              status        = 'active',
              updated_at    = now()
        where lower(email) = lower($2)
        returning id`,
      [passwordHash, email],
    );

    if ((updated.rowCount ?? 0) === 0) {
      throw new AppError(ERROR_CODES.STORE_ADMIN_NOT_FOUND, 'This store has no admin login recorded.', 409);
    }

    // The session table belongs to the client platform's own migrations, so a
    // tenant that has not been reached by them yet simply has nothing to revoke.
    const sessionTable = await client.query(`select to_regclass('public.admin_sessions') as name`);
    if (sessionTable.rows[0]?.name) {
      await client.query('delete from admin_sessions where admin_id = $1', [updated.rows[0]!.id]);
    }
  } finally {
    await client.end().catch(() => undefined);
  }

  logger.info({ tenantId: tenant.id }, 'store admin password reset');
}

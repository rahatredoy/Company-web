import fp from 'fastify-plugin';
import { eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/index';
import { storeAdmins } from '../db/schema/index';
import { AppError, ERROR_CODES, forbidden, unauthorized } from '../lib/errors';
import { findAdminSession, readSessionToken, touchAdminSession } from '../lib/session';
import { addMinutes } from '../lib/utils';
import type { Permission, StoreRole } from '../lib/constants';
import { STORE_ROLES } from '../lib/constants';
import { assertPermission, effectivePermissions } from '../services/permissions';
import { storeOf } from './tenant';

interface AdminRow {
  id: string;
  email: string;
  fullName: string;
  roleKey: StoreRole;
  accountStatus: 'invited' | 'active' | 'disabled';
  mfaEnabled: boolean;
  lockedUntil: Date | null;
}

async function loadAdmin(request: FastifyRequest, adminId: string): Promise<AdminRow> {
  const store = storeOf(request);

  const rows = await store.db
    .select({
      id: storeAdmins.id,
      email: storeAdmins.email,
      fullName: storeAdmins.fullName,
      roleKey: storeAdmins.roleKey,
      accountStatus: storeAdmins.accountStatus,
      mfaEnabled: storeAdmins.mfaEnabled,
      lockedUntil: storeAdmins.lockedUntil,
    })
    .from(storeAdmins)
    .where(eq(storeAdmins.id, adminId))
    .limit(1);

  const admin = rows[0];
  // The session referenced an admin that no longer exists — treat as signed out
  // rather than leaking that the id was once valid.
  if (!admin) throw unauthorized('Your session is no longer valid.', ERROR_CODES.SESSION_EXPIRED);

  if (admin.accountStatus === 'disabled') {
    throw forbidden('This account has been disabled.', ERROR_CODES.ACCOUNT_DISABLED);
  }
  if (admin.lockedUntil && admin.lockedUntil > new Date()) {
    throw forbidden('This account is temporarily locked. Try again later.', ERROR_CODES.ACCOUNT_LOCKED);
  }

  return admin as AdminRow;
}

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('storeAdmin', undefined);
  app.decorateRequest('storeAdminPartial', undefined);

  /**
   * The gate every authenticated route passes through.
   *
   * The session row is looked up **in the tenant's own database**, so a token
   * minted for another store is simply not there — cross-tenant replay fails
   * before the `tenant_ref` comparison, which is the second line of defence for
   * the case where a database is ever restored into the wrong place.
   */
  app.decorate('requireStoreAdmin', async function requireStoreAdmin(request: FastifyRequest) {
    const store = storeOf(request);

    const token = readSessionToken(request, 'admin');
    if (!token) throw unauthorized('Sign in to continue.');

    const session = await findAdminSession(store.db, token);
    if (!session) throw unauthorized('Your session has expired. Sign in again.', ERROR_CODES.SESSION_EXPIRED);

    if (session.tenantRef !== store.tenantRef) {
      request.log.error(
        { sessionTenant: session.tenantRef, hostTenant: store.tenantRef },
        'session tenant does not match request host',
      );
      throw new AppError(ERROR_CODES.TENANT_MISMATCH, 'This session belongs to a different store.', 403);
    }

    // An unfinished MFA challenge is a session row too. It must never be enough.
    if (!session.mfaVerified) {
      throw unauthorized('Finish two-factor authentication to continue.', ERROR_CODES.MFA_REQUIRED);
    }

    const admin = await loadAdmin(request, session.adminId);

    request.storeAdmin = {
      adminId: admin.id,
      email: admin.email,
      fullName: admin.fullName,
      roleKey: admin.roleKey,
      sessionId: session.id,
      tenantRef: session.tenantRef,
      remember: session.remember,
      mfaEnabled: admin.mfaEnabled,
      authenticatedAt: session.authenticatedAt,
      permissions: await effectivePermissions(store.db, { id: admin.id, roleKey: admin.roleKey }),
    };

    // Sliding expiry — awaited, because a lost write here would silently
    // shorten every session an active user has.
    await touchAdminSession(store.db, session.id, session.remember);
  });

  /**
   * Accepts **only** an unfinished MFA challenge, read from its own cookie.
   * `/auth/mfa/verify` is the one route that uses this.
   */
  app.decorate('requireStoreAdminPartial', async function requireStoreAdminPartial(request: FastifyRequest) {
    const store = storeOf(request);

    const token = readSessionToken(request, 'adminMfa');
    if (!token) throw unauthorized('Start again from the sign-in page.', ERROR_CODES.SESSION_EXPIRED);

    const session = await findAdminSession(store.db, token);
    if (!session || session.mfaVerified || session.tenantRef !== store.tenantRef) {
      throw unauthorized('Start again from the sign-in page.', ERROR_CODES.SESSION_EXPIRED);
    }

    const admin = await loadAdmin(request, session.adminId);

    request.storeAdminPartial = {
      adminId: admin.id,
      email: admin.email,
      sessionId: session.id,
      remember: session.remember,
    };
  });

  /**
   * Sensitive actions — changing a password, disabling MFA, deleting staff —
   * require a recent proof of identity, not merely a live cookie. The client
   * recovers by posting to `/auth/reauth` and retrying once.
   */
  app.decorate('requireReauth', async function requireReauth(request: FastifyRequest) {
    const admin = request.storeAdmin;
    if (!admin) throw unauthorized('Sign in to continue.');

    const cutoff = addMinutes(new Date(), -config.security.reauthWindowMinutes);
    if (admin.authenticatedAt < cutoff) {
      throw new AppError(
        ERROR_CODES.REAUTH_REQUIRED,
        'Confirm your password to continue.',
        401,
      );
    }
  });

  app.decorate('requireSuperAdmin', async function requireSuperAdmin(request: FastifyRequest) {
    const admin = request.storeAdmin;
    if (!admin) throw unauthorized('Sign in to continue.');
    if (admin.roleKey !== STORE_ROLES.superAdmin) {
      throw forbidden('Only a store super admin can do that.', ERROR_CODES.PERMISSION_DENIED);
    }
  });

  /**
   * Route-level authorisation. Every mutating route carries one of these —
   * hiding a button in the panel is not authorisation.
   */
  app.decorate('requirePermission', function requirePermission(key: Permission) {
    return async function permissionGuard(request: FastifyRequest, _reply: FastifyReply) {
      const admin = request.storeAdmin;
      if (!admin) throw unauthorized('Sign in to continue.');
      assertPermission(admin.permissions, key);
    };
  });
});

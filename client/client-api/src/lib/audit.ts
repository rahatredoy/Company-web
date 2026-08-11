import type { FastifyRequest } from 'fastify';
import type { TenantDb } from '../db/tenant-manager';
import { adminAuditLogs, adminSecurityEvents } from '../db/schema/index';
import { clientIp, userAgent } from './http';
import { logger } from './logger';

export interface AuditEntry {
  action: string;
  module: string;
  entity?: string;
  entityId?: string;
  entityLabel?: string;
  oldValues?: unknown;
  newValues?: unknown;
}

/** Values that must never be written into an audit row, at any depth. */
const REDACTED_KEYS = new Set([
  'password',
  'passwordHash',
  'password_hash',
  'currentPassword',
  'newPassword',
  'token',
  'tokenHash',
  'token_hash',
  'mfaSecret',
  'mfaSecretEncrypted',
  'mfa_secret_encrypted',
  'secret',
  'recoveryCodes',
  'code',
]);

function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== 'object' || depth > 6) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = REDACTED_KEYS.has(key) ? '[redacted]' : redact(item, depth + 1);
  }
  return out;
}

/**
 * Appends to the store's audit trail. Nothing in the API updates or deletes a
 * row here, so the trail is only ever added to.
 *
 * Auditing is deliberately non-fatal: an action that already succeeded must not
 * be reported as a failure because the trail write lost a race. A dropped entry
 * is logged loudly instead.
 */
export async function audit(
  db: TenantDb,
  request: FastifyRequest,
  entry: AuditEntry,
): Promise<void> {
  const actor = request.storeAdmin;

  try {
    await db.insert(adminAuditLogs).values({
      adminId: actor?.adminId ?? null,
      adminLabel: actor?.email ?? null,
      action: entry.action,
      module: entry.module,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      entityLabel: entry.entityLabel ?? null,
      oldValues: entry.oldValues === undefined ? null : (redact(entry.oldValues) as object),
      newValues: entry.newValues === undefined ? null : (redact(entry.newValues) as object),
      ipAddress: clientIp(request) || null,
      userAgent: userAgent(request) || null,
      requestId: String(request.id),
    });
  } catch (error) {
    logger.error({ err: (error as Error).message, action: entry.action }, 'audit write failed');
  }
}

export type SecurityEventType =
  | 'login_success'
  | 'login_failed'
  | 'logout'
  | 'account_claimed'
  | 'password_changed'
  | 'password_reset_requested'
  | 'mfa_enabled'
  | 'mfa_disabled'
  | 'recovery_codes_regenerated'
  | 'session_revoked'
  | 'permission_changed'
  | 'staff_created'
  | 'staff_disabled';

/**
 * The security timeline shown on an admin's own security page. Separate from the
 * audit trail because it is written for events with no signed-in actor yet — a
 * failed sign-in has no session to attribute the action to.
 */
export async function securityEvent(
  db: TenantDb,
  request: FastifyRequest,
  type: SecurityEventType,
  input: { adminId?: string | null; description?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  try {
    await db.insert(adminSecurityEvents).values({
      adminId: input.adminId ?? request.storeAdmin?.adminId ?? null,
      type,
      description: input.description ?? null,
      ipAddress: clientIp(request) || null,
      userAgent: userAgent(request) || null,
      metadata: input.metadata ? (redact(input.metadata) as object) : null,
    });
  } catch (error) {
    logger.error({ err: (error as Error).message, type }, 'security event write failed');
  }
}

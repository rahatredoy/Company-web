import type { FastifyRequest } from 'fastify';
import { db } from '../db/client';
import { activityEvents, auditLogs } from '../db/schema/index';
import { clientIp, userAgent } from './http';
import { logger } from './logger';

export const AUDIT_ACTIONS = {
  ADMIN_LOGIN: 'admin_login',
  ADMIN_LOGIN_FAILED: 'admin_login_failed',
  ADMIN_LOGOUT: 'admin_logout',
  /** Signed in on the password alone, because the browser was already remembered. */
  ADMIN_LOGIN_TRUSTED_DEVICE: 'admin_login_trusted_device',
  ADMIN_DEVICE_TRUSTED: 'admin_device_trusted',
  ADMIN_OTP_SENT: 'admin_otp_sent',
  ADMIN_PASSWORD_CHANGED: 'admin_password_changed',
  ADMIN_REAUTH: 'admin_reauth',
  ADMIN_RECOVERY_CODES_REGENERATED: 'admin_recovery_codes_regenerated',

  CLIENT_ACTIVATED: 'client_activated',
  CLIENT_SUSPENDED: 'client_suspended',
  CLIENT_REACTIVATED: 'client_reactivated',

  TRIAL_EXTENDED: 'trial_extended',
  TRIAL_ENDED: 'trial_ended',

  PLAN_CREATED: 'plan_created',
  PLAN_UPDATED: 'plan_updated',
  PLAN_STATUS_CHANGED: 'plan_status_changed',
  PLAN_CHANGED: 'plan_changed',

  SUBSCRIPTION_CANCELLED: 'subscription_cancelled',
  SUBSCRIPTION_REACTIVATED: 'subscription_reactivated',
  SUBSCRIPTION_ACTIVATED: 'subscription_activated',

  DOMAIN_VERIFIED: 'domain_verified',
  DOMAIN_DISABLED: 'domain_disabled',
  DOMAIN_REMOVED: 'domain_removed',

  PROVISIONING_RETRIED: 'provisioning_retried',

  INVOICE_SENT: 'invoice_sent',
  SETTINGS_CHANGED: 'settings_changed',
  SUPPORT_STATUS_CHANGED: 'support_status_changed',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

interface AuditInput {
  action: AuditAction | string;
  actorType?: 'admin' | 'client' | 'system';
  actorId?: string | null;
  actorLabel?: string | null;
  tenantId?: string | null;
  clientAccountId?: string | null;
  targetLabel?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Append-only audit trail. Writing must never break the action being audited,
 * so failures are logged rather than thrown.
 */
export async function recordAudit(request: FastifyRequest | null, input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      action: input.action,
      actorType: input.actorType ?? 'admin',
      actorId: input.actorId ?? null,
      actorLabel: input.actorLabel ?? null,
      tenantId: input.tenantId ?? null,
      clientAccountId: input.clientAccountId ?? null,
      targetLabel: input.targetLabel ?? null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
      ipAddress: request ? clientIp(request) || null : null,
      userAgent: request ? userAgent(request) || null : null,
      requestId: request ? String(request.id) : null,
      metadata: input.metadata ?? null,
    });
  } catch (error) {
    logger.error({ err: (error as Error).message, action: input.action }, 'failed to write audit log');
  }
}

type ActivityType =
  | 'client_registered'
  | 'trial_started'
  | 'trial_expiring'
  | 'trial_expired'
  | 'payment_received'
  | 'payment_failed'
  | 'subscription_activated'
  | 'subscription_cancelled'
  | 'store_provisioned'
  | 'provisioning_failed'
  | 'domain_connected'
  | 'support_ticket_opened';

/** Human-facing feed for the dashboard, separate from the security audit trail. */
export async function recordActivity(input: {
  type: ActivityType;
  title: string;
  subject: string;
  clientAccountId?: string | null;
  tenantId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await db.insert(activityEvents).values({
      type: input.type,
      title: input.title,
      subject: input.subject,
      clientAccountId: input.clientAccountId ?? null,
      tenantId: input.tenantId ?? null,
      metadata: input.metadata ?? null,
    });
  } catch (error) {
    logger.error({ err: (error as Error).message, type: input.type }, 'failed to write activity event');
  }
}

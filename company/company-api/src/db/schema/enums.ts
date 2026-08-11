import { pgEnum } from 'drizzle-orm/pg-core';

export const companyAdminStatus = pgEnum('company_admin_status', ['active', 'locked', 'disabled']);

export const clientAccountStatus = pgEnum('client_account_status', [
  'pending_verification',
  'active',
  'suspended',
  'closed',
]);

/**
 * Signup runs `plan → payment → store → done`. `business` and `review` are the
 * old five-step wizard's values; they are kept so existing rows still cast, and
 * are mapped forward on read (see `normaliseOnboardingStep`).
 */
export const onboardingStep = pgEnum('onboarding_step', [
  'business',
  'store',
  'plan',
  'review',
  'done',
  'payment',
]);

export const tenantStatus = pgEnum('tenant_status', [
  'pending',
  'provisioning',
  'trial',
  'active',
  'expired',
  'suspended',
  'cancelled',
]);

export const storeStatus = pgEnum('store_status', ['not_created', 'creating', 'ready', 'failed', 'suspended']);

export const planStatus = pgEnum('plan_status', ['active', 'disabled']);
export const supportLevel = pgEnum('support_level', ['email', 'priority', 'dedicated']);

export const trialStatus = pgEnum('trial_status', ['active', 'expired', 'converted', 'cancelled']);

export const subscriptionStatus = pgEnum('subscription_status', [
  'trial',
  'active',
  'past_due',
  'expired',
  'cancelled',
  'suspended',
]);

export const billingCycle = pgEnum('billing_cycle', ['monthly', 'yearly']);

export const paymentStatus = pgEnum('payment_status', ['pending', 'paid', 'failed', 'refunded']);

export const invoiceStatus = pgEnum('invoice_status', ['draft', 'issued', 'paid', 'void', 'refunded']);

export const domainType = pgEnum('domain_type', ['platform_subdomain', 'storefront_custom', 'admin_custom']);

export const domainStatus = pgEnum('domain_status', ['pending', 'verifying', 'active', 'failed', 'disabled']);

export const provisioningStatus = pgEnum('provisioning_status', ['pending', 'creating', 'completed', 'failed']);

export const provisioningStep = pgEnum('provisioning_step', [
  'tenant_record',
  'tenant_database',
  'tenant_schema',
  'store_configuration',
  'store_admin',
  'platform_subdomain',
  'store_ready',
]);

export const supportTicketStatus = pgEnum('support_ticket_status', [
  'open',
  'in_progress',
  'resolved',
  'closed',
]);

export const supportPriority = pgEnum('support_priority', ['low', 'normal', 'high', 'urgent']);
export const supportAuthorType = pgEnum('support_author_type', ['client', 'admin']);

export const notificationChannel = pgEnum('notification_channel', ['email', 'sms', 'whatsapp', 'in_app']);
export const notificationStatus = pgEnum('notification_status', ['queued', 'sent', 'failed']);

export const webhookEventStatus = pgEnum('webhook_event_status', [
  'received',
  'processed',
  'ignored',
  'failed',
]);

export const activityType = pgEnum('activity_type', [
  'client_registered',
  'trial_started',
  'trial_expiring',
  'trial_expired',
  'payment_received',
  'payment_failed',
  'subscription_activated',
  'subscription_cancelled',
  'store_provisioned',
  'provisioning_failed',
  'domain_connected',
  'support_ticket_opened',
]);

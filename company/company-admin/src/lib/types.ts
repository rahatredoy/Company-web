/** Mirrors the admin half of the API contract (see ../../README.md). */

export type TenantStatus = 'pending' | 'provisioning' | 'trial' | 'active' | 'expired' | 'suspended' | 'cancelled';
export type StoreStatus = 'not_created' | 'creating' | 'ready' | 'failed' | 'suspended';
export type ClientAccountStatus = 'pending_verification' | 'active' | 'suspended' | 'closed';
export type TrialStatus = 'active' | 'expired' | 'converted' | 'cancelled';
export type SubscriptionStatus = 'trial' | 'active' | 'past_due' | 'expired' | 'cancelled' | 'suspended';
export type BillingCycle = 'monthly' | 'yearly';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'void' | 'refunded';
export type DomainType = 'platform_subdomain' | 'storefront_custom' | 'admin_custom';
export type DomainStatus = 'pending' | 'verifying' | 'active' | 'failed' | 'disabled';
export type ProvisioningStatus = 'pending' | 'creating' | 'completed' | 'failed';
export type SupportTicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type SupportPriority = 'low' | 'normal' | 'high' | 'urgent';
export type PlanStatus = 'active' | 'disabled';
export type SupportLevel = 'email' | 'priority' | 'dedicated';

export interface AdminMe {
  id: string;
  email: string;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  passwordChangedAt: string | null;
}

/** Answer from `GET /api/v1/admin/session` — the one authority on sign-in state. */
export type AdminSessionState =
  | { state: 'anonymous' }
  | {
      state: 'otp_required';
      email: string;
      challengeExpiresAt: string;
      otpExpiresAt: string | null;
    }
  | { state: 'authenticated'; admin: AdminMe; reauthValidUntil: string };

export interface MetricDelta {
  value: number;
  /** Percentage change vs the previous window; null when there is no baseline. */
  changePct: number | null;
  spark: number[];
}

export interface DashboardSummary {
  totalClients: MetricDelta;
  activeClients: MetricDelta;
  trialClients: MetricDelta;
  paidClients: MetricDelta;
  mrr: MetricDelta;
  arr: MetricDelta;
  expiredClients: MetricDelta;
  suspendedClients: MetricDelta;
  paymentsThisMonth: MetricDelta;
  failedPayments: MetricDelta;
  currency: string;
  range: { from: string; to: string };
  subscriptionStatus: { status: string; count: number }[];
  trialConversion: { totalTrials: number; converted: number; conversionRate: number; series: { date: string; value: number }[] };
  recentActivity: ActivityItem[];
  recentClients: ClientRow[];
}

export type ActivityType =
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

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  subject: string;
  createdAt: string;
}

export interface NotificationItem extends ActivityItem {
  clientId: string | null;
  businessName: string | null;
  tenantId: string | null;
  metadata: Record<string, unknown> | null;
  read: boolean;
}

export interface ChartSeries {
  revenue: { date: string; revenue: number; mrr: number }[];
  clients: { date: string; total: number }[];
  subscriptions: { date: string; total: number }[];
  trialConversion: { date: string; value: number }[];
}

export interface ClientRow {
  id: string;
  tenantId: string | null;
  businessName: string;
  ownerName: string;
  /** The login for the company website and its dashboard. */
  email: string;
  /** The login for this client's own store admin panel — null until a store exists. */
  storeAdminEmail: string | null;
  /** Whether that address was confirmed by passcode during setup. */
  storeAdminEmailVerified: boolean;
  phone: string | null;
  registeredAt: string;
  trialStatus: TrialStatus | null;
  trialEndsAt: string | null;
  planName: string | null;
  subscriptionStatus: SubscriptionStatus | null;
  renewalAt: string | null;
  amount: string | null;
  currency: string;
  storeStatus: StoreStatus | null;
  domain: string | null;
  lastLoginAt: string | null;
  accountStatus: ClientAccountStatus;
}

export interface ClientDetail extends ClientRow {
  country: string | null;
  address: string | null;
  businessType: string | null;
  businessEmail: string | null;
  businessPhone: string | null;
  emailVerified: boolean;
  tenantStatus: TenantStatus | null;
  storefrontUrl: string | null;
  adminUrl: string | null;
  platformSubdomain: string | null;
  customDomain: string | null;
  currency: string;
  language: string | null;
  timezone: string | null;
  provisioning: ProvisioningJob | null;
  subscription: SubscriptionRow | null;
  trial: { status: TrialStatus; startedAt: string | null; endsAt: string | null; daysRemaining: number } | null;
  payments: PaymentRow[];
  invoices: InvoiceRow[];
  domains: DomainRow[];
  tickets: SupportTicketRow[];
  activity: ActivityItem[];
}

export interface Plan {
  id: string;
  name: string;
  code: string;
  description: string | null;
  monthlyPrice: string;
  yearlyPrice: string;
  productLimit: number | null;
  adminLimit: number | null;
  storageLimitMb: number | null;
  customDomainEnabled: boolean;
  customAdminDomainEnabled: boolean;
  analyticsEnabled: boolean;
  reportsEnabled: boolean;
  supportLevel: SupportLevel;
  status: PlanStatus;
  isFeatured: boolean;
  /** The free-trial plan — one per platform, taken once per client account. */
  isTrial: boolean;
  sortOrder: number;
  subscriberCount?: number;
}

export interface TrialRow {
  id: string;
  tenantId: string;
  clientId: string;
  businessName: string;
  startedAt: string | null;
  endsAt: string | null;
  daysRemaining: number;
  status: TrialStatus;
}

export interface SubscriptionRow {
  id: string;
  clientId: string;
  businessName: string;
  planName: string | null;
  billingCycle: BillingCycle | null;
  price: string | null;
  currency: string;
  startedAt: string | null;
  renewalAt: string | null;
  cancelledAt: string | null;
  status: SubscriptionStatus;
}

export interface PaymentRow {
  id: string;
  transactionId: string | null;
  clientId: string;
  businessName: string;
  planName: string | null;
  amount: string;
  currency: string;
  provider: string;
  status: PaymentStatus;
  createdAt: string;
  paidAt: string | null;
}

export interface InvoiceRow {
  id: string;
  invoiceNumber: string;
  clientId: string;
  businessName: string;
  planName: string | null;
  amount: string;
  currency: string;
  status: InvoiceStatus;
  issuedAt: string;
  paidAt: string | null;
}

export interface DomainRow {
  id: string;
  clientId: string;
  businessName: string;
  domain: string;
  domainType: DomainType;
  isPrimary: boolean;
  verified: boolean;
  status: DomainStatus;
  createdAt: string;
  lastCheckedAt: string | null;
}

export interface ProvisioningJob {
  id: string;
  clientId: string;
  businessName: string;
  tenantId: string;
  status: ProvisioningStatus;
  currentStep: string | null;
  steps: { step: string; label: string; done: boolean }[];
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface SupportTicketRow {
  id: string;
  reference: string;
  clientId: string;
  businessName: string;
  subject: string;
  status: SupportTicketStatus;
  priority: SupportPriority;
  createdAt: string;
  lastReplyAt: string | null;
  messageCount: number;
}

export interface SupportMessage {
  id: string;
  authorType: 'client' | 'admin';
  authorName: string;
  body: string;
  createdAt: string;
}

export interface AuditLogRow {
  id: string;
  action: string;
  actor: string;
  tenantId: string | null;
  businessName: string | null;
  oldValue: string | null;
  newValue: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

export interface PlatformSettings {
  general: {
    platformName: string;
    logoUrl: string | null;
    supportEmail: string;
    supportPhone: string | null;
    defaultCurrency: string;
    timezone: string;
  };
  trial: {
    trialDays: number;
    reminderDays: number[];
  };
  payments: {
    provider: string;
    currency: string;
    /** Read-only mirror of the configured gateway — secrets stay in the API's ENV. */
    configured: boolean;
  };
  email: {
    senderName: string;
    senderEmail: string;
    driver: string;
    configured: boolean;
  };
  messaging: {
    smsProvider: string | null;
    smsConfigured: boolean;
    whatsappProvider: string | null;
    whatsappConfigured: boolean;
  };
  domain: {
    platformRootDomain: string;
    clientAdminUrlPattern: string;
    dnsTarget: string | null;
  };
  security: {
    sessionTtlMinutes: number;
    adminSessionTtlMinutes: number;
    reauthWindowMinutes: number;
  };
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

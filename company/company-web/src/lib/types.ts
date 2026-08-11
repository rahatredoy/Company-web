/** Mirrors the response shapes documented in the API contract (see /README.md). */

export type ClientAccountStatus = 'pending_verification' | 'active' | 'suspended' | 'closed';
export type TenantStatus = 'pending' | 'provisioning' | 'trial' | 'active' | 'expired' | 'suspended' | 'cancelled';
export type StoreStatus = 'not_created' | 'creating' | 'ready' | 'failed' | 'suspended';
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
export type OnboardingStep = 'plan' | 'payment' | 'store' | 'done';

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
  supportLevel: 'email' | 'priority' | 'dedicated';
  isFeatured: boolean;
  /** The free-trial plan — one per platform, taken once per account for life. */
  isTrial: boolean;
  sortOrder: number;
}

export interface PublicSettings {
  platformName: string;
  supportEmail: string;
  supportPhone: string | null;
  defaultCurrency: string;
  trialDays: number;
}

export interface ClientMe {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  status: ClientAccountStatus;
  emailVerified: boolean;
  onboardingStep: OnboardingStep;
  onboardingCompleted: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface StoreView {
  tenantId: string;
  storeName: string;
  slug: string;
  status: TenantStatus;
  storeStatus: StoreStatus;
  provisioningStatus: ProvisioningStatus | null;
  provisioningSteps: { step: string; label: string; done: boolean }[];
  storefrontUrl: string;
  adminUrl: string;
  platformSubdomain: string;
  customDomain: string | null;
  currency: string;
  language: string;
  timezone: string;
  createdAt: string;
}

/**
 * Counted inside the store's own database, so anything the store platform has
 * not created yet reads as `null` rather than as zero.
 */
export interface StoreUsageView {
  products: number | null;
  admins: number | null;
  storageBytes: number | null;
  limits: { products: number | null; admins: number | null; storageMb: number | null };
}

export interface TrialView {
  status: TrialStatus;
  startedAt: string | null;
  endsAt: string | null;
  daysRemaining: number;
}

export interface SubscriptionView {
  id: string | null;
  status: SubscriptionStatus;
  plan: Plan | null;
  billingCycle: BillingCycle | null;
  price: string | null;
  startedAt: string | null;
  renewalAt: string | null;
  cancelledAt: string | null;
  trial: TrialView | null;
}

export interface PaymentView {
  id: string;
  transactionId: string | null;
  provider: string;
  planName: string | null;
  amount: string;
  currency: string;
  status: PaymentStatus;
  paidAt: string | null;
  createdAt: string;
}

export interface InvoiceView {
  id: string;
  invoiceNumber: string;
  planName: string | null;
  billingCycle: BillingCycle | null;
  amount: string;
  currency: string;
  status: InvoiceStatus;
  issuedAt: string;
  paidAt: string | null;
}

export interface DomainView {
  id: string;
  domain: string;
  domainType: DomainType;
  isPrimary: boolean;
  verified: boolean;
  status: DomainStatus;
  verificationToken: string | null;
  dnsInstructions: { type: string; name: string; value: string; ttl: string }[];
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface SupportTicketView {
  id: string;
  reference: string;
  subject: string;
  status: SupportTicketStatus;
  priority: SupportPriority;
  createdAt: string;
  lastReplyAt: string | null;
  messageCount: number;
}

export interface SupportMessageView {
  id: string;
  authorType: 'client' | 'admin';
  authorName: string;
  body: string;
  createdAt: string;
}

export interface BusinessProfileView {
  businessName: string;
  ownerName: string;
  businessEmail: string;
  businessPhone: string | null;
  country: string | null;
  address: string | null;
  businessType: string | null;
}

export interface AccountOverview {
  account: ClientMe;
  business: BusinessProfileView | null;
  store: StoreView | null;
  subscription: SubscriptionView | null;
  latestInvoice: InvoiceView | null;
}

export interface PaymentMethodView {
  id: string;
  provider: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  isDefault: boolean;
  createdAt: string;
}

export interface OnboardingPayment {
  /** Always true once a plan is chosen — a trial and a free plan are billed 0.00. */
  required: boolean;
  settled: boolean;
  /** Due today: "0.00" on a trial or a free plan. */
  amount: string;
  /** What the plan costs once the trial converts. */
  planPrice: string;
  currency: string;
  /** `method_setup` authorises a card for a trial; `charge` takes the money now. */
  mode: 'method_setup' | 'charge';
  method: PaymentMethodView | null;
}

/** Signup state, derived server-side from what actually exists. */
export interface OnboardingState {
  step: OnboardingStep;
  completed: boolean;
  plan: { planId: string; billingCycle: BillingCycle; startTrial: boolean } | null;
  planFeatures: { name: string; customDomainEnabled: boolean; customAdminDomainEnabled: boolean } | null;
  payment: OnboardingPayment;
  /** Whether the trial plan may still be chosen, and whether it has been used. */
  trialOffer: { available: boolean; used: boolean };
  store: { businessName: string; slug: string; adminEmail: string | null } | null;
  /** The two setup halves of the store, each reported from what actually exists. */
  website: { configured: boolean; businessName: string; slug: string; customDomain: string | null };
  adminPanel: {
    configured: boolean;
    adminEmail: string;
    customDomain: string | null;
    /** The emailed passcode came back — nothing is provisioned before it does. */
    verified: boolean;
    /** A code is in flight, so a reload resumes on the passcode step. */
    pendingVerification: { sentTo: string | null; expiresAt: string } | null;
  };
  store_view: StoreView | null;
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

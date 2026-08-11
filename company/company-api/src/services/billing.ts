import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  clientAccounts,
  clientBusinessProfiles,
  invoices,
  paymentMethods,
  payments,
  plans,
  subscriptions,
  tenants,
  trials,
} from '../db/schema/index';
import { config } from '../config/index';
import { AppError, ERROR_CODES, notFound } from '../lib/errors';
import { publicId } from '../lib/crypto';
import { formatInvoiceNumber, nextRenewal, toMoney } from '../lib/utils';
import { recordActivity } from '../lib/audit';
import { emails } from '../lib/mailer';
import { getPaymentProvider } from '../lib/payment';
import { logger } from '../lib/logger';

export type BillingCycle = 'monthly' | 'yearly';

export function priceFor(plan: { monthlyPrice: string; yearlyPrice: string }, cycle: BillingCycle): string {
  return toMoney(cycle === 'monthly' ? plan.monthlyPrice : plan.yearlyPrice);
}

export async function getActivePlanOrThrow(planId: string) {
  const rows = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  const plan = rows[0];
  if (!plan) throw notFound('That plan does not exist.', ERROR_CODES.PLAN_NOT_FOUND);
  if (plan.status !== 'active') {
    throw new AppError(ERROR_CODES.PLAN_DISABLED, 'That plan is no longer available.', 409);
  }
  return plan;
}

/**
 * Creates a pending payment and a gateway checkout session. Nothing about the
 * subscription changes here — activation happens only when a verified webhook
 * confirms the money moved.
 */
export async function startCheckout(input: {
  tenantId: string;
  clientAccountId: string;
  planId: string;
  billingCycle: BillingCycle;
  customerEmail: string;
  description: string;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<{ checkoutUrl: string; paymentId: string; reference: string }> {
  const plan = await getActivePlanOrThrow(input.planId);
  const amount = priceFor(plan, input.billingCycle);
  const reference = publicId('PAY', 12);

  const subscriptionRows = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, input.tenantId))
    .limit(1);

  const [payment] = await db
    .insert(payments)
    .values({
      tenantId: input.tenantId,
      clientAccountId: input.clientAccountId,
      subscriptionId: subscriptionRows[0]?.id ?? null,
      planId: plan.id,
      provider: config.payment.provider,
      purpose: 'subscription',
      reference,
      amount,
      currency: config.payment.currency,
      billingCycle: input.billingCycle,
      status: 'pending',
    })
    .returning({ id: payments.id });

  const provider = getPaymentProvider();
  const session = await provider.createCheckout({
    reference,
    amount,
    currency: config.payment.currency,
    description: input.description,
    customerEmail: input.customerEmail,
    successUrl: input.successUrl ?? `${config.urls.website}/account/billing?payment=success`,
    cancelUrl: input.cancelUrl ?? `${config.urls.website}/account/subscription?payment=cancelled`,
  });

  return { checkoutUrl: session.checkoutUrl, paymentId: payment!.id, reference };
}

/**
 * Zero-amount authorisation that puts a card on file. A trial signup goes
 * through this instead of `startCheckout`: nothing is charged, but the gateway
 * still validates the instrument and hands back a token we can bill when the
 * trial converts.
 */
export async function startPaymentMethodSetup(input: {
  tenantId: string;
  clientAccountId: string;
  planId: string;
  billingCycle: BillingCycle;
  customerEmail: string;
  description: string;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<{ checkoutUrl: string; paymentId: string; reference: string }> {
  const reference = publicId('PMS', 12);

  // Linked to the subscription like a real charge is: the 0.00 invoice raised
  // for a trial has to belong to the same subscription the trial converts into.
  const subscriptionRows = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, input.tenantId))
    .limit(1);

  const [payment] = await db
    .insert(payments)
    .values({
      tenantId: input.tenantId,
      clientAccountId: input.clientAccountId,
      subscriptionId: subscriptionRows[0]?.id ?? null,
      planId: input.planId,
      provider: config.payment.provider,
      purpose: 'method_setup',
      reference,
      amount: '0.00',
      currency: config.payment.currency,
      billingCycle: input.billingCycle,
      status: 'pending',
    })
    .returning({ id: payments.id });

  const provider = getPaymentProvider();
  const session = await provider.createCheckout({
    reference,
    amount: '0.00',
    currency: config.payment.currency,
    description: input.description,
    customerEmail: input.customerEmail,
    successUrl: input.successUrl ?? `${config.urls.website}/account/billing?payment=success`,
    cancelUrl: input.cancelUrl ?? `${config.urls.website}/account/billing?payment=cancelled`,
  });

  return { checkoutUrl: session.checkoutUrl, paymentId: payment!.id, reference };
}

/**
 * Records the instrument behind a completed authorisation. The gateway's token
 * is all we keep — card numbers never reach this platform — and the newest
 * method becomes the default the renewal will bill.
 */
export async function recordPaymentMethodForPayment(
  paymentId: string,
  card?: { brand?: string | null; last4?: string | null; expMonth?: number | null; expYear?: number | null },
): Promise<void> {
  const paymentRows = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  const payment = paymentRows[0];
  if (!payment || payment.status !== 'paid') return;

  const providerToken = payment.transactionId ?? payment.reference;

  const existing = await db
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.provider, payment.provider), eq(paymentMethods.providerToken, providerToken)))
    .limit(1);
  if (existing[0]) return;

  // Only one default per account, so demote whatever held it before.
  await db
    .update(paymentMethods)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(eq(paymentMethods.clientAccountId, payment.clientAccountId));

  await db.insert(paymentMethods).values({
    tenantId: payment.tenantId,
    clientAccountId: payment.clientAccountId,
    provider: payment.provider,
    providerToken,
    brand: card?.brand ?? (payment.provider === 'mock' ? 'Test card' : null),
    last4: card?.last4 ?? (payment.provider === 'mock' ? '4242' : null),
    expMonth: card?.expMonth ?? null,
    expYear: card?.expYear ?? null,
    isDefault: true,
  });

  logger.info({ paymentId, tenantId: payment.tenantId }, 'payment method stored');
}

/** Whether the account has a usable card on file. */
export async function hasPaymentMethod(clientAccountId: string): Promise<boolean> {
  const rows = await db
    .select({ id: paymentMethods.id })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.clientAccountId, clientAccountId), isNull(paymentMethods.removedAt)))
    .limit(1);
  return Boolean(rows[0]);
}

export async function defaultPaymentMethodView(clientAccountId: string) {
  const rows = await db
    .select()
    .from(paymentMethods)
    .where(and(eq(paymentMethods.clientAccountId, clientAccountId), isNull(paymentMethods.removedAt)))
    .orderBy(desc(paymentMethods.isDefault), desc(paymentMethods.createdAt))
    .limit(1);

  const method = rows[0];
  if (!method) return null;

  return {
    id: method.id,
    provider: method.provider,
    brand: method.brand,
    last4: method.last4,
    expMonth: method.expMonth,
    expYear: method.expYear,
    isDefault: method.isDefault,
    createdAt: method.createdAt,
  };
}

/** Invoice numbers are sequential per year and never reused. */
async function nextInvoiceSequence(): Promise<number> {
  const rows = await db
    .select({ max: sql<number>`coalesce(max(${invoices.sequence}), 0)` })
    .from(invoices);
  return Number(rows[0]?.max ?? 0) + 1;
}

export async function issueInvoiceForPayment(paymentId: string): Promise<string | null> {
  const paymentRows = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  const payment = paymentRows[0];
  if (!payment) return null;

  const existing = await db
    .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber })
    .from(invoices)
    .where(eq(invoices.paymentId, paymentId))
    .limit(1);
  if (existing[0]) return existing[0].invoiceNumber;

  const profileRows = await db
    .select()
    .from(clientBusinessProfiles)
    .where(eq(clientBusinessProfiles.clientAccountId, payment.clientAccountId))
    .limit(1);

  const accountRows = await db
    .select({ email: clientAccounts.email, fullName: clientAccounts.fullName })
    .from(clientAccounts)
    .where(eq(clientAccounts.id, payment.clientAccountId))
    .limit(1);

  const profile = profileRows[0];
  const account = accountRows[0];
  const issuedAt = new Date();
  const sequence = await nextInvoiceSequence();

  const [invoice] = await db
    .insert(invoices)
    .values({
      tenantId: payment.tenantId,
      clientAccountId: payment.clientAccountId,
      subscriptionId: payment.subscriptionId,
      paymentId: payment.id,
      planId: payment.planId,
      invoiceNumber: formatInvoiceNumber(sequence, issuedAt),
      sequence,
      billingCycle: payment.billingCycle,
      amount: payment.amount,
      currency: payment.currency,
      status: 'paid',
      billTo: {
        businessName: profile?.businessName ?? account?.fullName ?? 'Customer',
        ownerName: profile?.ownerName ?? account?.fullName ?? '',
        email: profile?.businessEmail ?? account?.email ?? '',
        address: profile?.address ?? null,
        country: profile?.country ?? null,
      },
      issuedAt,
      paidAt: payment.paidAt ?? issuedAt,
    })
    .returning({ invoiceNumber: invoices.invoiceNumber });

  return invoice?.invoiceNumber ?? null;
}

/**
 * The single place a subscription becomes active. Called only from the verified
 * webhook path — never from a browser redirect.
 */
export async function activateSubscriptionForPayment(paymentId: string): Promise<void> {
  const paymentRows = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  const payment = paymentRows[0];
  if (!payment || payment.status !== 'paid' || !payment.planId) return;
  // A card authorisation moved no money — it must never start a paid period.
  if (payment.purpose !== 'subscription') return;

  const plan = await db.select().from(plans).where(eq(plans.id, payment.planId)).limit(1);
  const now = new Date();
  const renewalAt = nextRenewal(now, payment.billingCycle);

  const existingRows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, payment.tenantId))
    .limit(1);
  const existing = existingRows[0];

  if (existing) {
    await db
      .update(subscriptions)
      .set({
        planId: payment.planId,
        billingCycle: payment.billingCycle,
        price: payment.amount,
        currency: payment.currency,
        status: 'active',
        startedAt: existing.startedAt ?? now,
        renewalAt,
        cancelledAt: null,
        endedAt: null,
        updatedAt: now,
      })
      .where(eq(subscriptions.id, existing.id));
  } else {
    await db.insert(subscriptions).values({
      tenantId: payment.tenantId,
      planId: payment.planId,
      billingCycle: payment.billingCycle,
      price: payment.amount,
      currency: payment.currency,
      status: 'active',
      startedAt: now,
      renewalAt,
    });
  }

  // A paid subscription converts an active trial rather than cutting it short.
  const trialRows = await db.select().from(trials).where(eq(trials.tenantId, payment.tenantId)).limit(1);
  if (trialRows[0] && trialRows[0].status === 'active') {
    await db
      .update(trials)
      .set({ status: 'converted', convertedAt: now, updatedAt: now })
      .where(eq(trials.id, trialRows[0].id));
  }

  // Money confirmed makes the tenant active, but it cannot make a store *exist*:
  // during signup the payment lands before provisioning has run, so `storeStatus`
  // is only lifted where it means "was online, was paused" — never where it means
  // "not built yet".
  const currentTenantRows = await db
    .select({ storeStatus: tenants.storeStatus })
    .from(tenants)
    .where(eq(tenants.id, payment.tenantId))
    .limit(1);

  await db
    .update(tenants)
    .set({
      status: 'active',
      ...(currentTenantRows[0]?.storeStatus === 'suspended' ? { storeStatus: 'ready' as const } : {}),
      suspendedAt: null,
      updatedAt: now,
    })
    .where(eq(tenants.id, payment.tenantId));

  const invoiceNumber = await issueInvoiceForPayment(payment.id);

  const tenantRows = await db
    .select({ storeName: tenants.storeName })
    .from(tenants)
    .where(eq(tenants.id, payment.tenantId))
    .limit(1);

  const accountRows = await db
    .select({ email: clientAccounts.email, fullName: clientAccounts.fullName })
    .from(clientAccounts)
    .where(eq(clientAccounts.id, payment.clientAccountId))
    .limit(1);

  await recordActivity({
    type: 'payment_received',
    title: 'Payment received',
    subject: tenantRows[0]?.storeName ?? 'Client',
    clientAccountId: payment.clientAccountId,
    tenantId: payment.tenantId,
  });

  await recordActivity({
    type: 'subscription_activated',
    title: 'Subscription activated',
    subject: tenantRows[0]?.storeName ?? plan[0]?.name ?? 'Client',
    clientAccountId: payment.clientAccountId,
    tenantId: payment.tenantId,
  });

  if (accountRows[0] && invoiceNumber) {
    await emails.paymentReceived(
      accountRows[0].email,
      accountRows[0].fullName,
      `${payment.currency} ${payment.amount}`,
      invoiceNumber,
      { clientAccountId: payment.clientAccountId, tenantId: payment.tenantId },
    );
  }

  logger.info({ paymentId, tenantId: payment.tenantId }, 'subscription activated from verified payment');
}

export async function markPaymentPaid(paymentId: string, transactionId: string | null): Promise<void> {
  await db
    .update(payments)
    .set({ status: 'paid', transactionId, paidAt: new Date(), updatedAt: new Date() })
    .where(eq(payments.id, paymentId));
}

export async function markPaymentFailed(paymentId: string, reason: string): Promise<void> {
  await db
    .update(payments)
    .set({ status: 'failed', failureReason: reason.slice(0, 500), updatedAt: new Date() })
    .where(eq(payments.id, paymentId));

  const rows = await db
    .select({ tenantId: payments.tenantId, clientAccountId: payments.clientAccountId })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);

  if (rows[0]) {
    const tenantRows = await db
      .select({ storeName: tenants.storeName })
      .from(tenants)
      .where(eq(tenants.id, rows[0].tenantId))
      .limit(1);

    await recordActivity({
      type: 'payment_failed',
      title: 'Payment failed',
      subject: tenantRows[0]?.storeName ?? 'Client',
      clientAccountId: rows[0].clientAccountId,
      tenantId: rows[0].tenantId,
      metadata: { reason: reason.slice(0, 200) },
    });

    const subscriptionRows = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, rows[0].tenantId))
      .limit(1);

    // An existing subscription goes past_due; a first-time payment failure just
    // leaves the tenant where it was.
    if (subscriptionRows[0] && subscriptionRows[0].status === 'active') {
      await db
        .update(subscriptions)
        .set({ status: 'past_due', updatedAt: new Date() })
        .where(eq(subscriptions.id, subscriptionRows[0].id));
    }
  }
}

export async function markPaymentRefunded(paymentId: string): Promise<void> {
  const now = new Date();
  await db
    .update(payments)
    .set({ status: 'refunded', refundedAt: now, updatedAt: now })
    .where(eq(payments.id, paymentId));

  await db.update(invoices).set({ status: 'refunded' }).where(eq(invoices.paymentId, paymentId));
}

export async function findPaymentByReference(reference: string) {
  const rows = await db.select().from(payments).where(eq(payments.reference, reference)).limit(1);
  return rows[0] ?? null;
}

export async function latestInvoiceFor(tenantId: string) {
  const rows = await db
    .select()
    .from(invoices)
    .where(eq(invoices.tenantId, tenantId))
    .orderBy(desc(invoices.issuedAt))
    .limit(1);
  return rows[0] ?? null;
}

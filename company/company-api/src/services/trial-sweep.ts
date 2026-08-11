import { and, eq, lt, lte } from 'drizzle-orm';
import { db } from '../db/client';
import { clientAccounts, subscriptions, tenants, trials } from '../db/schema/index';
import { config } from '../config/index';
import { logger } from '../lib/logger';
import { addDays, daysRemaining } from '../lib/utils';
import { getTrialSettings } from '../lib/settings';
import { emails } from '../lib/mailer';
import { recordActivity } from '../lib/audit';
import { invalidateTenantCache } from '../lib/tenant-cache';

/**
 * Hourly sweep: sends the configured reminders, then expires trials that have
 * run out. A store is paused when its trial expires — never deleted.
 */
export async function sweepTrials(): Promise<{ remindersSent: number; expired: number }> {
  const { reminderDays } = await getTrialSettings();
  let remindersSent = 0;
  let expired = 0;

  const active = await db
    .select({
      trial: trials,
      tenant: tenants,
      account: clientAccounts,
    })
    .from(trials)
    .innerJoin(tenants, eq(tenants.id, trials.tenantId))
    .innerJoin(clientAccounts, eq(clientAccounts.id, tenants.clientAccountId))
    .where(eq(trials.status, 'active'));

  const now = new Date();

  for (const row of active) {
    if (!row.trial.endsAt) continue;

    if (row.trial.endsAt <= now) {
      await db
        .update(trials)
        .set({ status: 'expired', updatedAt: now })
        .where(eq(trials.id, row.trial.id));

      await db
        .update(tenants)
        .set({ status: 'expired', storeStatus: 'suspended', updatedAt: now })
        .where(eq(tenants.id, row.tenant.id));

      await db
        .update(subscriptions)
        .set({ status: 'expired', updatedAt: now })
        .where(and(eq(subscriptions.tenantId, row.tenant.id), eq(subscriptions.status, 'trial')));

      // The store is paused as of now, not as of when the client platform's
      // cached copy happens to expire.
      await invalidateTenantCache(row.tenant.id);

      await emails.trialExpired(
        row.account.email,
        row.account.fullName,
        `${config.urls.website}/account/subscription`,
        { clientAccountId: row.account.id, tenantId: row.tenant.id },
      );

      await recordActivity({
        type: 'trial_expired',
        title: 'Trial expired',
        subject: row.tenant.storeName,
        clientAccountId: row.account.id,
        tenantId: row.tenant.id,
      });

      expired += 1;
      continue;
    }

    const remaining = daysRemaining(row.trial.endsAt);
    const alreadySent = row.trial.remindersSent ?? [];
    const due = reminderDays.find((day) => remaining <= day && !alreadySent.includes(day));

    if (due !== undefined) {
      await emails.trialReminder(
        row.account.email,
        row.account.fullName,
        remaining,
        `${config.urls.website}/account/subscription`,
        { clientAccountId: row.account.id, tenantId: row.tenant.id },
      );

      await db
        .update(trials)
        .set({ remindersSent: [...alreadySent, due], updatedAt: now })
        .where(eq(trials.id, row.trial.id));

      await recordActivity({
        type: 'trial_expiring',
        title: `Trial expiring in ${remaining} days`,
        subject: row.tenant.storeName,
        clientAccountId: row.account.id,
        tenantId: row.tenant.id,
      });

      remindersSent += 1;
    }
  }

  logger.info({ remindersSent, expired }, 'trial sweep finished');
  return { remindersSent, expired };
}

/**
 * Marks subscriptions whose renewal date has passed as past_due so the client
 * sees the prompt and the admin dashboard reflects reality.
 */
export async function sweepBilling(): Promise<{ pastDue: number }> {
  const now = new Date();
  const overdue = await db
    .select({ id: subscriptions.id, tenantId: subscriptions.tenantId })
    .from(subscriptions)
    .where(and(eq(subscriptions.status, 'active'), lt(subscriptions.renewalAt, now)));

  for (const row of overdue) {
    await db
      .update(subscriptions)
      .set({ status: 'past_due', updatedAt: now })
      .where(eq(subscriptions.id, row.id));
  }

  // Anything left past_due for more than a week is expired and the store paused.
  const cutoff = addDays(now, -7);
  const stale = await db
    .select({ id: subscriptions.id, tenantId: subscriptions.tenantId })
    .from(subscriptions)
    .where(and(eq(subscriptions.status, 'past_due'), lte(subscriptions.renewalAt, cutoff)));

  for (const row of stale) {
    await db.update(subscriptions).set({ status: 'expired', updatedAt: now }).where(eq(subscriptions.id, row.id));
    await db
      .update(tenants)
      .set({ status: 'expired', storeStatus: 'suspended', updatedAt: now })
      .where(eq(tenants.id, row.tenantId));

    await invalidateTenantCache(row.tenantId);
  }

  logger.info({ pastDue: overdue.length, expired: stale.length }, 'billing sweep finished');
  return { pastDue: overdue.length };
}

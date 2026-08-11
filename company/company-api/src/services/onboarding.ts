import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { clientAccounts } from '../db/schema/index';

/**
 * Signup is three questions — which plan, how you are paying, and what the store
 * is called — followed by provisioning. `done` means the store exists.
 */
export type OnboardingStepName = 'plan' | 'payment' | 'store' | 'done';

/**
 * A tenant row exists from the moment a plan is chosen, because the payment and
 * subscription both hang off it, but the address is not chosen until the last
 * step. Until then the slug is this placeholder: unique, never provisioned, and
 * recognisable so nothing mistakes it for a real store address.
 */
export function placeholderSlug(tenantRef: string): string {
  return `pending-${tenantRef.replace(/[^A-Za-z0-9]/g, '').toLowerCase()}`.slice(0, 40);
}

export function isPlaceholderSlug(slug: string): boolean {
  return slug.startsWith('pending-');
}

/**
 * The step the client actually has to do next, derived from what exists rather
 * than from the stored column. The column is a record of progress; this is the
 * truth, and it is what keeps an account created under the old five-step wizard
 * from landing on a step that no longer exists.
 */
export function resolveOnboardingStep(input: {
  hasSubscription: boolean;
  paymentSettled: boolean;
  storeConfigured: boolean;
}): OnboardingStepName {
  if (!input.hasSubscription) return 'plan';
  if (!input.paymentSettled) return 'payment';
  if (!input.storeConfigured) return 'store';
  return 'done';
}

/**
 * Called from the verified webhook path once money (or a zero-amount card
 * authorisation) has settled. It only ever moves an account forward — a renewal
 * years later must not drag a finished account back into signup.
 */
export async function advanceOnboardingAfterPayment(clientAccountId: string): Promise<void> {
  const rows = await db
    .select({ step: clientAccounts.onboardingStep, completed: clientAccounts.onboardingCompleted })
    .from(clientAccounts)
    .where(eq(clientAccounts.id, clientAccountId))
    .limit(1);

  const account = rows[0];
  if (!account || account.completed) return;
  if (account.step === 'store' || account.step === 'done') return;

  await db
    .update(clientAccounts)
    .set({ onboardingStep: 'store', updatedAt: new Date() })
    .where(eq(clientAccounts.id, clientAccountId));
}

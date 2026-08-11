import type { OnboardingState } from './types';

/**
 * Billing comes before everything else in this dashboard. Nothing is set up,
 * and nothing is usable, until a plan has been chosen **and** its bill has been
 * paid — and a trial is not an exception to that, only a bill of 0.00.
 *
 * There is one derivation of that fact and every caller reads it here: the
 * layout to lock the navigation, each gated page to refuse itself, the overview
 * to lead with the step that is outstanding. Two copies of this rule would
 * eventually disagree, and the half that said "unlocked" would win.
 */
export type BillingStage = 'plan' | 'bill' | 'complete';

export interface BillingGate {
  /** A plan and cycle have been chosen — the billing setup half is done. */
  planChosen: boolean;
  /** The bill has settled at the gateway. This is the only thing that unlocks. */
  billPaid: boolean;
  /** Nothing in the dashboard opens until this is true. */
  complete: boolean;
  stage: BillingStage;
  /** What is due today — "0.00" on a trial and on a free plan. */
  amountDue: string;
  currency: string;
  /** What the plan costs after a trial converts. */
  planPrice: string;
  planName: string | null;
  /** A trial pays 0.00 today but still authorises a card. */
  isTrial: boolean;
  /** Where the outstanding step lives, and what to call the button. */
  href: string;
  label: string;
}

const BILLING_HREF = '/dashboard/plans';

export function billingGate(signup: OnboardingState | null): BillingGate {
  const planChosen = Boolean(signup?.plan);
  // `settled` is already false whenever a bill is outstanding, at any amount.
  const billPaid = planChosen && (signup?.payment?.settled ?? false);
  const stage: BillingStage = !planChosen ? 'plan' : !billPaid ? 'bill' : 'complete';

  return {
    planChosen,
    billPaid,
    complete: billPaid,
    stage,
    amountDue: signup?.payment?.amount ?? '0.00',
    currency: signup?.payment?.currency ?? 'USD',
    planPrice: signup?.payment?.planPrice ?? signup?.payment?.amount ?? '0.00',
    planName: signup?.planFeatures?.name ?? null,
    isTrial: signup?.payment?.mode === 'method_setup',
    href: BILLING_HREF,
    label: stage === 'plan' ? 'Set up billing' : 'Pay your bill',
  };
}

/**
 * Pages that put the gate on screen themselves, in full. The shell's banner is
 * for the pages that stay usable while the bill is outstanding — stacking it on
 * top of the card would say the same thing twice, one line apart.
 *
 * `/dashboard/store` is not one of them: it shows the whole store setup, unpaid,
 * and refuses only the button that starts it — so the banner is exactly right
 * there, a reminder above a page that is still worth reading.
 */
const RENDERS_GATE = ['/dashboard', BILLING_HREF, '/dashboard/invoices'];

export function rendersBillingGate(pathname: string): boolean {
  return RENDERS_GATE.includes(pathname);
}

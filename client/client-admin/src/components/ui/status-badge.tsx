'use client';

import { Badge, type BadgeProps } from './badge';
import { titleCase } from '@/lib/format';
import { useT, type MessageKey, type Translator } from '@/lib/i18n';
import { createTranslator } from '@/lib/i18n/translator';

/*
 * A client component because its words are the store's language and the
 * translator is a hook. Server pages still render `<StatusBadge status=… />` —
 * its props are plain strings — but `statusVariant` and `statusLabel` are now
 * client-only helpers: a server component importing a plain function from a
 * `'use client'` module gets a reference, not the function.
 */

type Variant = NonNullable<BadgeProps['variant']>;

/** One place that decides what colour a status is, across every page. */
const STATUS_VARIANTS: Record<string, Variant> = {
  // account / tenant
  active: 'success',
  ready: 'success',
  completed: 'success',
  verified: 'success',
  converted: 'success',
  paid: 'success',
  resolved: 'success',

  trial: 'warning',
  pending: 'warning',
  pending_verification: 'warning',
  provisioning: 'warning',
  creating: 'warning',
  verifying: 'warning',
  in_progress: 'warning',
  past_due: 'danger',

  expired: 'primary',
  cancelled: 'neutral',
  closed: 'neutral',
  disabled: 'neutral',
  not_created: 'neutral',
  draft: 'neutral',
  void: 'neutral',

  suspended: 'info',
  issued: 'info',
  open: 'info',
  queued: 'info',

  failed: 'danger',
  refunded: 'danger',

  // orders — the arc from placed to delivered runs info → primary → success, so
  // a list can be read by colour without stopping to read each word
  new: 'info',
  confirmed: 'info',
  processing: 'primary',
  packed: 'primary',
  shipped: 'primary',
  out_for_delivery: 'primary',
  delivered: 'success',
  returned: 'warning',

  // payment
  cod_pending: 'warning',
  partially_paid: 'warning',
  partially_refunded: 'warning',
  authorized: 'info',
  not_shipped: 'neutral',

  // moderation and returns
  approved: 'success',
  rejected: 'danger',
  under_review: 'warning',
  requested: 'info',
  received: 'info',
  inspected: 'primary',
  blocked: 'danger',

  // customers
  new_customer: 'info',
  repeat: 'primary',
  vip: 'success',
  high_value: 'success',
};

/**
 * The statuses whose words are not their title-cased key. Every other status is
 * shown as `titleCase(key)` and translated from that, so the dictionary
 * (`messages/bn/shared.ts`) carries those title-cased words too.
 */
const STATUS_LABELS: Record<string, MessageKey> = {
  pending_verification: 'Unverified',
  past_due: 'Past Due',
  in_progress: 'In Progress',
  not_created: 'Not Created',
  platform_subdomain: 'Platform Subdomain',
  storefront_custom: 'Storefront',
  admin_custom: 'Admin',
  out_for_delivery: 'Out for Delivery',
  cod_pending: 'Cash on Delivery',
  partially_paid: 'Part Paid',
  partially_refunded: 'Part Refunded',
  not_shipped: 'Not Shipped',
  under_review: 'Under Review',
  high_value: 'High Value',
  // The same English as a word that means something else — "Open" is a button
  // in `common.ts` — so these carry a context. It is never shown.
  open: 'Open::status',
  repeat: 'Repeat::customer',
};

/** The English words, for a caller with no translator to hand. */
const english = createTranslator('en', null);

function labelFor(key: string, t: Translator): string {
  const named = STATUS_LABELS[key];
  // `loose`, because a status the platform adds later is not a key yet — it is
  // then shown title-cased in English rather than not at all.
  return named ? t(named) : t.loose(titleCase(key));
}

/** The colour a status is drawn in, for a figure that shows it as text rather than a pill. */
export function statusVariant(status: string): Variant {
  return STATUS_VARIANTS[status?.toLowerCase() ?? ''] ?? 'neutral';
}

/**
 * The words a status is shown as — "Cash on Delivery" rather than `cod_pending`.
 * Pass `useT()`'s translator for the store's language; without one it is English.
 */
export function statusLabel(status: string, t?: Translator): string {
  return labelFor(status?.toLowerCase() ?? '', t ?? english);
}

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  /** Shown as given — the caller translates it. */
  label?: string;
  className?: string;
}) {
  const t = useT();
  const key = status?.toLowerCase() ?? '';
  return (
    <Badge variant={STATUS_VARIANTS[key] ?? 'neutral'} dot className={className}>
      {label ?? labelFor(key, t)}
    </Badge>
  );
}

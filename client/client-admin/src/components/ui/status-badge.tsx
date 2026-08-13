import { Badge, type BadgeProps } from './badge';
import { titleCase } from '@/lib/format';

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

const STATUS_LABELS: Record<string, string> = {
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
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string;
  label?: string;
  className?: string;
}) {
  const key = status?.toLowerCase() ?? '';
  return (
    <Badge variant={STATUS_VARIANTS[key] ?? 'neutral'} dot className={className}>
      {label ?? STATUS_LABELS[key] ?? titleCase(key)}
    </Badge>
  );
}

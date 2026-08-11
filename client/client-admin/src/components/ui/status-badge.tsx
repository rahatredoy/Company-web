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
};

const STATUS_LABELS: Record<string, string> = {
  pending_verification: 'Unverified',
  past_due: 'Past Due',
  in_progress: 'In Progress',
  not_created: 'Not Created',
  platform_subdomain: 'Platform Subdomain',
  storefront_custom: 'Storefront',
  admin_custom: 'Admin',
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

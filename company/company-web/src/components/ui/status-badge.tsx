import { Badge, type BadgeProps } from './badge';
import { titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';

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

/** The pill's colour, on the dot itself — the pill and the dot never disagree. */
const DOT_COLOURS: Record<Variant, string> = {
  neutral: 'bg-muted-foreground',
  outline: 'bg-muted-foreground',
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  info: 'bg-info',
};

/**
 * The same status as `StatusBadge`, written as plain text with a coloured dot.
 *
 * Used where a status sits in a list of values rather than beside a heading: a
 * row of pills reads as a row of buttons, and there is nothing to press.
 */
export function StatusDot({
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
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        className={cn('size-2 shrink-0 rounded-full', DOT_COLOURS[STATUS_VARIANTS[key] ?? 'neutral'])}
        aria-hidden
      />
      {label ?? STATUS_LABELS[key] ?? titleCase(key)}
    </span>
  );
}

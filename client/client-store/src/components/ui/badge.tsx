import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { LooseText } from './translated-text';

/**
 * Status and merchandising badges.
 *
 * The semantic tones — success, warning, danger, info — deliberately do **not**
 * follow the store's brand colour. "Delivered" must read as delivered on all
 * eight palettes; a green theme that turned every status green would make the
 * badge decorative. Only `brand` and `sale` track the theme.
 */
const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-(--radius-button) px-2 py-1 text-[10.5px] font-semibold leading-none',
  {
    variants: {
      tone: {
        brand: 'bg-primary text-primary-foreground',
        soft: 'bg-primary-soft text-primary',
        accent: 'bg-accent-soft text-foreground',
        sale: 'bg-sale text-white',
        neutral: 'bg-surface-alt text-muted',
        outline: 'border border-border-strong bg-surface text-foreground',
        success: 'bg-success/12 text-success',
        warning: 'bg-warning/15 text-warning',
        danger: 'bg-error/12 text-error',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-[10px]',
        md: '',
        lg: 'px-2.5 py-1.5 text-xs',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, size, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

/**
 * Maps an order, payment, return or refund status onto a tone.
 *
 * One table, so the same word cannot be green in the account area and grey in
 * the tracking page. Unknown statuses fall back to neutral rather than throwing
 * — the API may add one before this app knows about it.
 */
const STATUS_TONES: Record<string, BadgeProps['tone']> = {
  // Orders
  pending: 'warning',
  confirmed: 'soft',
  processing: 'soft',
  packed: 'soft',
  shipped: 'soft',
  out_for_delivery: 'soft',
  delivered: 'success',
  cancelled: 'neutral',
  returned: 'neutral',
  // Payments
  paid: 'success',
  failed: 'danger',
  partially_refunded: 'warning',
  refunded: 'neutral',
  // Returns and refunds
  requested: 'warning',
  under_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  product_received: 'soft',
  inspection: 'soft',
  completed: 'success',
};

export function statusTone(status: string): BadgeProps['tone'] {
  return STATUS_TONES[status.toLowerCase()] ?? 'neutral';
}

/**
 * `out_for_delivery` → `Out for delivery`.
 *
 * English, and the dictionary key: `StatusBadge` translates it at render, and a
 * status the dictionary does not know yet is shown in these words.
 */
export function statusLabel(status: string): string {
  const words = status.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge tone={statusTone(status)} className={className}>
      <LooseText text={statusLabel(status)} />
    </Badge>
  );
}

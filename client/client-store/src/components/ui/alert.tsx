import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle, type LucideIcon } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva(
  'flex gap-3 rounded-(--radius-card) border p-4 text-sm',
  {
    variants: {
      tone: {
        info: 'border-border bg-surface-alt text-foreground',
        success: 'border-success/25 bg-success/8 text-foreground',
        warning: 'border-warning/30 bg-warning/10 text-foreground',
        danger: 'border-error/25 bg-error/8 text-foreground',
      },
    },
    defaultVariants: { tone: 'info' },
  },
);

const ICONS: Record<string, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

const ICON_COLOURS: Record<string, string> = {
  info: 'text-muted',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-error',
};

export interface AlertProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {
  title?: string;
}

/**
 * A block-level message.
 *
 * `role="alert"` only for the two tones a visitor must not miss. Marking a
 * neutral piece of information as an alert makes a screen reader interrupt
 * whatever it was reading to announce something that could have waited.
 */
export function Alert({ className, tone = 'info', title, children, ...props }: AlertProps) {
  const key = tone ?? 'info';
  const Icon = ICONS[key]!;
  const urgent = key === 'danger' || key === 'warning';

  return (
    <div
      role={urgent ? 'alert' : 'status'}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      <Icon aria-hidden className={cn('mt-0.5 size-5 shrink-0', ICON_COLOURS[key])} />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-1', 'text-muted')}>{children}</div> : null}
      </div>
    </div>
  );
}

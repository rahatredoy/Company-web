import * as React from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const alertVariants = cva('flex gap-3 rounded-lg border p-4 text-sm', {
  variants: {
    variant: {
      info: 'border-info/25 bg-info-soft text-foreground',
      success: 'border-success/25 bg-success-soft text-foreground',
      warning: 'border-warning/25 bg-warning-soft text-foreground',
      danger: 'border-destructive/25 bg-destructive-soft text-foreground',
    },
  },
  defaultVariants: { variant: 'info' },
});

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
} as const;

const iconColor = {
  info: 'text-info',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
} as const;

export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof alertVariants> {
  title?: React.ReactNode;
}

export function Alert({ className, variant = 'info', title, children, ...props }: AlertProps) {
  const key = variant ?? 'info';
  const Icon = icons[key];
  return (
    <div role="status" className={cn(alertVariants({ variant }), className)} {...props}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', iconColor[key])} aria-hidden />
      <div className="space-y-1">
        {title ? <p className="font-medium text-foreground">{title}</p> : null}
        {children ? <div className="text-muted-foreground">{children}</div> : null}
      </div>
    </div>
  );
}

'use client';

import * as React from 'react';
import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import { cn } from '@/lib/utils';

export const RadioGroup = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(function RadioGroup({ className, ...props }, ref) {
  return <RadioGroupPrimitive.Root ref={ref} className={cn('grid gap-2', className)} {...props} />;
});

export const RadioGroupItem = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(function RadioGroupItem({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        'grid size-5 shrink-0 place-items-center rounded-full border border-border-strong bg-surface transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        'data-[state=checked]:border-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="size-2.5 rounded-full bg-primary" />
    </RadioGroupPrimitive.Item>
  );
});

/**
 * A selectable card: shipping method, payment method, saved address.
 *
 * The whole card is the label, so tapping anywhere selects it, and the border
 * changes on `:has(:checked)` rather than through React state — the DOM already
 * knows which one is selected and duplicating that in state is how the ring and
 * the radio end up disagreeing.
 */
export function RadioCard({
  id,
  value,
  title,
  description,
  trailing,
  disabled,
  className,
}: {
  id: string;
  value: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-(--radius-card) border border-border bg-surface p-4 transition-colors',
        'hover:border-border-strong',
        'has-[:checked]:border-primary has-[:checked]:bg-primary-soft/50',
        'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
        className,
      )}
    >
      <RadioGroupItem id={id} value={value} disabled={disabled} className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-snug">{title}</span>
        {description ? <span className="mt-0.5 block text-xs text-muted">{description}</span> : null}
      </span>
      {trailing ? <span className="shrink-0 text-sm font-semibold">{trailing}</span> : null}
    </label>
  );
}

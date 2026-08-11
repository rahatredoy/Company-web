'use client';

import * as React from 'react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        'peer grid size-5 shrink-0 place-items-center rounded-[4px] border border-border-strong bg-surface transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/35 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        'data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="grid place-items-center">
        {props.checked === 'indeterminate' ? (
          <Minus className="size-3.5" aria-hidden />
        ) : (
          <Check className="size-3.5" aria-hidden />
        )}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

/**
 * Checkbox with its label, wired and with the whole row clickable.
 *
 * The label element wraps the control, so the hit area is the full row — which
 * on a filter sidebar is the difference between a comfortable tap target and a
 * 20px square.
 */
export function CheckboxField({
  id,
  label,
  hint,
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex cursor-pointer items-start gap-2.5 py-1.5 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
        className,
      )}
    >
      <Checkbox id={id} className="mt-0.5" {...props} />
      <span className="min-w-0 flex-1">
        <span className="block leading-snug">{label}</span>
        {hint ? <span className="block text-xs text-subtle">{hint}</span> : null}
      </span>
    </label>
  );
}

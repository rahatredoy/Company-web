import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Text input.
 *
 * `aria-invalid` rather than a `error` boolean prop, because the attribute is
 * what a screen reader actually announces — styling off it means the visual and
 * the announced state cannot drift apart.
 */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type = 'text', ...props }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          'h-11 w-full rounded-(--radius-input) border border-border-strong bg-surface px-3.5 text-sm text-foreground',
          'placeholder:text-subtle',
          'transition-colors outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/25',
          'disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-subtle',
          'aria-[invalid=true]:border-error aria-[invalid=true]:focus-visible:ring-error/25',
          className,
        )}
        {...props}
      />
    );
  },
);

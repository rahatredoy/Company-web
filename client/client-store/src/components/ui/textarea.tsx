import * as React from 'react';
import { cn } from '@/lib/utils';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 4, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        'w-full rounded-(--radius-input) border border-border-strong bg-surface px-3.5 py-2.5 text-sm text-foreground',
        'placeholder:text-subtle',
        'transition-colors outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/25',
        'disabled:cursor-not-allowed disabled:bg-surface-alt disabled:text-subtle',
        'aria-[invalid=true]:border-error aria-[invalid=true]:focus-visible:ring-error/25',
        className,
      )}
      {...props}
    />
  );
});

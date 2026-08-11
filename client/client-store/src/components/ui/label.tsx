'use client';

import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(function Label({ className, children, required = false, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn('text-sm font-medium text-foreground', className)}
      {...props}
    >
      {children}
      {/*
        The asterisk carries a real word for screen readers. A red star alone
        conveys "required" by convention and colour, which is exactly the pair
        of signals the accessibility rules say not to rely on.
      */}
      {required ? (
        <>
          <span aria-hidden className="ml-0.5 text-error">
            *
          </span>
          <span className="sr-only"> (required)</span>
        </>
      ) : null}
    </LabelPrimitive.Root>
  );
});

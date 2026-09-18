'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { DialogOverlay, DialogPortal } from './dialog';

/**
 * Edge-anchored panel: mobile nav, filters, cart drawer, design switcher.
 *
 * The same Radix dialog underneath, so focus handling and `Escape` behave
 * identically to a modal. Only the position and the animation differ.
 *
 * `bottom` uses `max-h-[85dvh]` rather than `vh`: on mobile Safari `vh` ignores
 * the browser chrome, so a bottom sheet sized in `vh` puts its own action
 * buttons underneath the address bar.
 */
const sheetVariants = cva(
  'fixed z-50 flex flex-col gap-0 bg-surface shadow-[var(--shadow-raised)] data-[state=open]:animate-in data-[state=closed]:animate-out',
  {
    variants: {
      side: {
        left: 'inset-y-0 left-0 h-dvh w-[min(22rem,88vw)] border-r border-border data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
        right:
          'inset-y-0 right-0 h-dvh w-[min(24rem,90vw)] border-l border-border data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
        bottom:
          'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-(--radius-card) border-t border-border data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
        top: 'inset-x-0 top-0 max-h-[85dvh] border-b border-border data-[state=open]:slide-in-from-top data-[state=closed]:slide-out-to-top',
      },
    },
    defaultVariants: { side: 'right' },
  },
);

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> &
    VariantProps<typeof sheetVariants> & { showClose?: boolean }
>(function SheetContent({ className, children, side = 'right', showClose = true, ...props }, ref) {
  const t = useT();

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
        {children}
        {showClose ? (
          <DialogPrimitive.Close className="absolute right-3 top-3 grid size-9 place-items-center rounded-(--radius-button) text-muted transition-colors hover:bg-surface-alt hover:text-foreground">
            <X className="size-4" aria-hidden />
            <span className="sr-only">{t('Close')}</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
});

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('shrink-0 border-b border-border px-5 py-4 pr-12', className)}
      {...props}
    />
  );
}

/** Scrolls; the header and footer stay put. */
export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4', className)} {...props} />;
}

export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('shrink-0 border-t border-border px-5 py-4', className)}
      {...props}
    />
  );
}

export const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function SheetTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title
      ref={ref}
      className={cn('text-base font-semibold', className)}
      {...props}
    />
  );
});

export const SheetDescription = DialogPrimitive.Description;

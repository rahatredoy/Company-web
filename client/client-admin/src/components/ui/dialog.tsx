'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      ref={ref}
      className={cn(
        'fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    />
  );
});

/**
 * How wide the dialog is allowed to get. `sm` is the confirm-and-go-away
 * dialog — a couple of fields, and widening it would only make the sentence
 * across the top harder to read.
 *
 * `md` and `lg` are for the ones that are really forms. A form is only ever as
 * tall as the column it is poured into, so spending the screen's spare width on
 * a second column with `DialogColumns` is what takes a dialog that scrolled its
 * own middle and puts the whole of it on screen at once.
 */
const DIALOG_WIDTH = {
  sm: 'max-w-lg',
  md: 'max-w-3xl',
  lg: 'max-w-5xl',
} as const;

export const DialogContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    size?: keyof typeof DIALOG_WIDTH;
    hideClose?: boolean;
    /** Raise the overlay when this dialog must stack above another one. */
    overlayClassName?: string;
  }
>(function DialogContent({ className, children, size = 'sm', hideClose, overlayClassName, ...props }, ref) {
  const t = useT();

  return (
    <DialogPrimitive.Portal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4',
          DIALOG_WIDTH[size],
          'rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-raised)]',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none">
            <X className="size-4" />
            <span className="sr-only">{t('Close')}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />;
}

/**
 * The middle of a dialog, between the header and the footer.
 *
 * The cap is what stops a dialog growing off the top and the bottom of the
 * window — a centred dialog has no edge to hang from, so past a point it is the
 * title and the save button that leave the screen, and neither can be scrolled
 * back to. `70vh` leaves the room those two need. Reaching the cap at all is
 * the failure case rather than the plan: `DialogColumns` is what keeps a form
 * short enough that it never does.
 */
export function DialogBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('max-h-[70vh] space-y-4 overflow-y-auto py-4', className)} {...props} />;
}

/**
 * A dialog's fields in two columns rather than one. See `SheetColumns` in
 * `sheet.tsx` for why the split is chosen by hand rather than left to the
 * browser; this is the same thing at the width a centred dialog has.
 */
export function DialogColumns({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid items-start gap-x-6 gap-y-4 md:grid-cols-2', className)} {...props} />;
}

/** One column of a `DialogColumns`. */
export function DialogColumn({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-0 space-y-4', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...props} />;
}

export const DialogTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DialogTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title ref={ref} className={cn('text-lg font-semibold tracking-tight', className)} {...props} />
  );
});

export const DialogDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DialogDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />;
});

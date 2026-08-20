'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A dialog that arrives from the edge of the screen rather than the middle.
 *
 * Built on the same Radix dialog as `dialog.tsx` — the focus trap, the escape
 * key and the scroll lock are the parts that are hard to get right, and they are
 * identical either way. Only the position and the animation differ.
 *
 * Worth it for a form long enough to scroll: a centred dialog either grows past
 * the viewport or scrolls its own middle, and both hide the save button. A side
 * panel has a fixed header and footer with only the fields between them, so the
 * button that ends the task stays where the eye left it.
 *
 * These panels are **wide rather than tall**, which is the whole reason for
 * `size` and `SheetColumns`. A column of fields narrow enough to read is also
 * twice the height of a laptop viewport, and a form the reader has to scroll is
 * one where they cannot see what they have not filled in yet. Spending the
 * screen's spare width instead — two columns of fields — is what puts the whole
 * form inside the fold; the body still scrolls, but only on a viewport short
 * enough that nothing would have fitted anyway.
 */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

/**
 * How wide the panel is allowed to get. `w-full` caps each of these at the
 * viewport, so the widest one still behaves on a phone.
 *
 * `sm` is one column of fields — the panel as it was. `md` and `lg` are the two
 * that `SheetColumns` has room to split; `lg` is for a form whose fields are
 * already grouped into sections, since those carry their own inner grid.
 */
const SHEET_WIDTH = {
  sm: 'max-w-[28rem]',
  md: 'max-w-[54rem]',
  lg: 'max-w-[64rem]',
} as const;

export const SheetContent = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: 'right' | 'left';
    size?: keyof typeof SHEET_WIDTH;
    hideClose?: boolean;
  }
>(function SheetContent({ className, children, side = 'right', size = 'md', hideClose, ...props }, ref) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px]',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0',
          'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        )}
      />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed inset-y-0 z-50 flex w-full flex-col border-border bg-card shadow-[var(--shadow-raised)]',
          SHEET_WIDTH[size],
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:duration-300 data-[state=closed]:duration-200',
          side === 'right'
            ? 'right-0 border-l data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right'
            : 'left-0 border-r data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
          className,
        )}
        {...props}
      >
        {children}
        {hideClose ? null : (
          <DialogPrimitive.Close className="absolute top-5 right-5 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
});

/** Fixed at the top; does not scroll with the fields. */
export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('shrink-0 space-y-1 border-b border-border px-6 py-5 pr-12', className)} {...props} />;
}

/**
 * The only part that scrolls, so the header and footer stay put — and on a
 * normal desktop viewport it is meant not to, which is what `SheetColumns` is
 * for. `overflow-y-auto` stays as the backstop for a short window or a list of
 * values long enough that no layout would have contained it.
 */
export function SheetBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5', className)} {...props} />;
}

/**
 * The fields of a wide panel, in two columns rather than one long one.
 *
 * Two explicit `SheetColumn` children rather than CSS multi-column: the browser
 * balances a multi-column box wherever the heights happen to even out, which
 * would put the break in a different place on every panel and could separate a
 * field from the hint that explains it. Choosing the split by hand keeps
 * related fields together, and keeps the tab order the same as the reading
 * order — down the left column, then down the right.
 *
 * Below `md` it collapses back to the single column these panels have always
 * been, so a narrow window loses the columns rather than the form. `md` and not
 * something wider because the panel is `w-full` under its cap: on any window
 * narrower than the cap the panel is the window, so the breakpoint is reading
 * the panel's own width, not guessing at it.
 */
export function SheetColumns({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid items-start gap-x-6 gap-y-5 md:grid-cols-2', className)} {...props} />;
}

/** One column of a `SheetColumns`. `min-w-0` so a long value cannot widen it. */
export function SheetColumn({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('min-w-0 space-y-5', className)} {...props} />;
}

/** Fixed at the bottom; the save button never scrolls out of reach. */
export function SheetFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('shrink-0 flex items-center justify-end gap-2 border-t border-border px-6 py-4', className)}
      {...props}
    />
  );
}

export const SheetTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function SheetTitle({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Title ref={ref} className={cn('text-base font-semibold tracking-tight', className)} {...props} />
  );
});

export const SheetDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function SheetDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />;
});

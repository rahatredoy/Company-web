'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

/**
 * Tab bar. Radix supplies the roving tabindex, arrow-key navigation and the
 * `aria-controls`/`aria-labelledby` pairing.
 *
 * Two visual treatments: `underline` is the merchandising tab bar the homepage
 * product sections use, `pill` is the filter-style bar the account area uses.
 */

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { look?: 'underline' | 'pill' }
>(function TabsList({ className, look = 'underline', ...props }, ref) {
  return (
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        'no-scrollbar flex items-center overflow-x-auto',
        /*
         * `safe` centring. A plain `justify-content: center` on a scroll
         * container clips the *start* of the content once it overflows — on a
         * phone the first tab disappeared off the left edge and could not be
         * scrolled back to. `safe` falls back to flex-start exactly when that
         * would happen.
         */
        '[justify-content:safe_center]',
        look === 'underline'
          ? 'gap-x-6 border-b border-border'
          : 'gap-1 rounded-(--radius-pill) bg-surface-alt p-1',
        className,
      )}
      {...props}
    />
  );
});

export const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { look?: 'underline' | 'pill' }
>(function TabsTrigger({ className, look = 'underline', ...props }, ref) {
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        'whitespace-nowrap text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
        look === 'underline'
          ? [
              '-mb-px shrink-0 border-b-2 border-transparent px-1 pb-3 pt-1 text-muted hover:text-foreground',
              'data-[state=active]:border-primary data-[state=active]:text-primary',
            ]
          : [
              'shrink-0 rounded-(--radius-pill) px-4 py-2 text-muted hover:text-foreground',
              'data-[state=active]:bg-surface data-[state=active]:text-foreground data-[state=active]:shadow-[var(--shadow-card)]',
            ],
        className,
      )}
      {...props}
    />
  );
});

export const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(function TabsContent({ className, ...props }, ref) {
  return (
    <TabsPrimitive.Content
      ref={ref}
      // Panels are focusable only when they hold no focusable content; Radix
      // manages that, so nothing is forced here.
      className={cn('outline-none', className)}
      {...props}
    />
  );
});

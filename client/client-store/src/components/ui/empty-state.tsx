import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The "there is nothing here" block.
 *
 * Always takes an action. An empty state that only reports emptiness leaves the
 * visitor on a dead end — an empty wishlist should offer the shop, an empty
 * order list should offer the shop, a filtered listing with no results should
 * offer to clear the filters.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('grid place-items-center px-4 py-16 text-center', className)}>
      <div className="max-w-sm">
        {Icon ? (
          <span className="mx-auto mb-5 grid size-12 place-items-center rounded-full bg-surface-alt text-subtle">
            <Icon className="size-6" aria-hidden />
          </span>
        ) : null}

        <p className="text-lg font-semibold">{title}</p>
        {description ? <p className="mt-2 text-sm text-muted">{description}</p> : null}
        {action ? <div className="mt-6 flex flex-wrap justify-center gap-3">{action}</div> : null}
      </div>
    </div>
  );
}

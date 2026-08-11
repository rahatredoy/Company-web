import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Inline busy indicator.
 *
 * `aria-hidden` by default: the surrounding control should announce its own
 * state via `aria-busy` or a changed label. A spinning icon with an accessible
 * name says "loading" a second time, out of order.
 */
export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <>
      <Loader2 aria-hidden className={cn('size-4 animate-spin', className)} />
      {label ? <span className="sr-only">{label}</span> : null}
    </>
  );
}

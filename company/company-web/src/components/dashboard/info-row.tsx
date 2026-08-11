import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export function InfoList({ className, ...props }: React.HTMLAttributes<HTMLDListElement>) {
  return <dl className={cn('divide-y divide-border', className)} {...props} />;
}

export function InfoRow({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** Optional leading glyph. Decorative — the label still carries the meaning. */
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <dt className="flex items-center gap-2.5 text-sm text-muted-foreground">
        {Icon ? (
          <span className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-muted/50">
            <Icon className="size-3.5" aria-hidden />
          </span>
        ) : null}
        {label}
      </dt>
      <dd className="min-w-0 text-sm font-medium break-words sm:text-right">
        {value}
        {hint ? <p className="mt-0.5 text-xs font-normal text-muted-foreground">{hint}</p> : null}
      </dd>
    </div>
  );
}

'use client';

import * as React from 'react';
import { Check, Copy, ExternalLink, RotateCcw } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The panel behind every **View** in the store admin.
 *
 * The lists used to answer "view" by sending the reader to the storefront,
 * which is the shopper's version of the row — a product page shows a price and
 * a picture and says nothing about cost, stock buckets, the ledger or who
 * bought it, and half the lists here (customers, refunds, subscribers,
 * messages) have no storefront page at all. So a view opens the record itself,
 * beside the list, holding **every column the database has** on that row plus
 * the rows that point at it.
 *
 * Beside rather than on a route of its own, for the same reason the edit panels
 * are: the reader is scanning a list, and a full navigation loses their place in
 * it — including the scroll position, which on a virtualised list is not
 * something the browser can restore. Escape closes and the list is exactly where
 * it was. The storefront link is still offered, in the footer, where it reads as
 * "and here is the public version" rather than as the only meaning of "view".
 *
 * **Read-only on purpose.** Editing is what the edit panels and the product
 * tabs are for, and a panel that both shows everything and writes some of it
 * makes the reader guess which fields are which. The one thing it does offer is
 * copying an id, because every id here is something somebody eventually pastes
 * into a support ticket or a query.
 */

// ---------------------------------------------------------------- the shell --

export function DetailSheet({
  open,
  onOpenChange,
  title,
  subtitle,
  badge,
  loading,
  error,
  onRetry,
  footer,
  size = 'md',
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Status pill beside the title — the one fact worth reading before the rest. */
  badge?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  children?: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size={size} className="gap-0">
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="min-w-0 break-words">{title}</SheetTitle>
            {badge}
          </div>
          {subtitle ? <SheetDescription>{subtitle}</SheetDescription> : null}
        </SheetHeader>

        <SheetBody>
          {error ? (
            <Alert variant="danger" title="That record could not be loaded">
              <p>{error}</p>
              {onRetry ? (
                <Button size="sm" variant="outline" className="mt-3" onClick={onRetry}>
                  <RotateCcw aria-hidden /> Try again
                </Button>
              ) : null}
            </Alert>
          ) : loading ? (
            <DetailSkeleton />
          ) : (
            children
          )}
        </SheetBody>

        {footer && !error && !loading ? <SheetFooter>{footer}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * What is shown while the record is in flight.
 *
 * Shaped like the panel rather than a single bar, so the layout does not jump
 * when the answer lands — these panels are long, and a spinner that becomes
 * fourteen sections moves everything the reader was about to look at.
 */
function DetailSkeleton() {
  return (
    <div className="space-y-6">
      {[0, 1, 2].map((section) => (
        <div key={section} className="space-y-3">
          <Skeleton className="h-4 w-32" />
          <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((field) => (
              <div key={field} className="space-y-1.5">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-36" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// -------------------------------------------------------------- the sections --

export function DetailSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** A link or count that belongs to the heading rather than to a field. */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-1.5">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
        {action}
      </div>
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {children}
    </section>
  );
}

/** Two columns of fields on anything wider than a phone, one below that. */
export function DetailGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn('grid gap-x-6 gap-y-4 sm:grid-cols-2', className)}>{children}</dl>;
}

/**
 * One field.
 *
 * An empty value renders an em dash rather than nothing, because a blank space
 * where a label promised a value reads as a page that failed to load. `false`
 * is a value, not an absence — only null, undefined and the empty string are
 * treated as unset, which is what keeps a `false` switch visible.
 */
export function DetailField({
  label,
  value,
  hint,
  full,
  mono,
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Why the value is what it is, when the label alone would mislead. */
  hint?: React.ReactNode;
  /** Span both columns — for prose, an address, a long URL. */
  full?: boolean;
  mono?: boolean;
  className?: string;
}) {
  const empty = value === null || value === undefined || value === '';

  return (
    <div className={cn('min-w-0 space-y-1', full && 'sm:col-span-2', className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-sm break-words',
          mono && 'font-mono text-[13px]',
          empty && 'text-muted-foreground',
        )}
      >
        {empty ? '—' : value}
      </dd>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** A yes/no column, shown as a word rather than an unlabelled tick. */
export function DetailBool({ value }: { value: boolean | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  return <span className={value ? 'text-success' : 'text-muted-foreground'}>{value ? 'Yes' : 'No'}</span>;
}

/**
 * An identifier, with the button that gets it out of the screen.
 *
 * Every panel shows the row's own uuid and the uuids it points at — they are
 * columns, so they belong here — and a uuid is the one kind of value nobody
 * retypes correctly. Truncated to the first segment with the whole thing in the
 * title, because a full uuid in a two-column grid pushes the layout around.
 */
export function DetailId({ value, className }: { value: string | null | undefined; className?: string }) {
  const [copied, setCopied] = React.useState(false);

  // Clears itself, and clears the timer if the panel closes first — a setState
  // after unmount is a warning nobody can act on.
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!value) return <span className="text-muted-foreground">—</span>;

  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <code className="truncate font-mono text-[12px]" title={value}>
        {value}
      </code>
      <button
        type="button"
        aria-label="Copy identifier"
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => setCopied(true),
            () => undefined,
          );
        }}
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}

/**
 * A compact table for the rows that point at this one — order lines, ledger
 * movements, redemptions, addresses.
 *
 * Not `InfiniteTable`: that one virtualises inside its own bounded scroller,
 * which is exactly wrong nested inside a panel that already scrolls. These
 * lists are capped by the API at fifty or a hundred rows, so they are rendered
 * whole and the panel scrolls once.
 */
export function DetailTable<T>({
  columns,
  rows,
  empty = 'Nothing yet.',
  rowKey,
}: {
  columns: { key: string; header: React.ReactNode; align?: 'left' | 'right'; cell: (row: T) => React.ReactNode }[];
  rows: T[];
  empty?: React.ReactNode;
  rowKey: (row: T, index: number) => string;
}) {
  if (rows.length === 0) return <DetailEmpty>{empty}</DetailEmpty>;

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  'px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted-foreground',
                  column.align === 'right' && 'text-right',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)} className="border-b border-border last:border-0">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn('px-3 py-2 align-top', column.align === 'right' && 'text-right tabular-nums')}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DetailEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/** Money and totals — a right-aligned list where the labels are not fields. */
export function DetailTotals({
  rows,
}: {
  rows: { label: React.ReactNode; value: React.ReactNode; strong?: boolean; muted?: boolean }[];
}) {
  return (
    <dl className="space-y-1.5 rounded-lg border border-border p-3">
      {rows.map((row, index) => (
        <div
          key={index}
          className={cn(
            'flex items-baseline justify-between gap-4 text-sm',
            row.strong && 'border-t border-border pt-2 text-base font-semibold',
            row.muted && 'text-muted-foreground',
          )}
        >
          <dt>{row.label}</dt>
          <dd className="tabular-nums">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Prose kept as it was typed — a note, a message, a description. */
export function DetailProse({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm whitespace-pre-wrap">
      {children}
    </p>
  );
}

/**
 * A jsonb column, shown rather than hidden.
 *
 * `metadata` is a real column on orders, payments, refunds and ledger rows, and
 * a panel that claims to show everything the database holds cannot quietly drop
 * the one field whose shape it does not know. Pretty-printed and scrollable, so
 * a large object cannot stretch the panel.
 */
export function DetailJson({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof value === 'object' && Object.keys(value as object).length === 0) {
    return <span className="text-muted-foreground">Empty</span>;
  }

  return (
    <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-[12px] leading-relaxed">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

/** The footer's link out to the shopper's version of this row, when there is one. */
export function DetailStorefrontLink({ href, label = 'View in store' }: { href: string; label?: string }) {
  return (
    <Button asChild variant="outline" size="sm">
      <a href={href} target="_blank" rel="noreferrer">
        <ExternalLink aria-hidden /> {label}
      </a>
    </Button>
  );
}

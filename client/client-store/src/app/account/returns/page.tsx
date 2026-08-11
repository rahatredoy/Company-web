import type { Metadata } from 'next';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { getReturns } from '@/lib/api/account';
import { getStoreConfig } from '@/lib/api/store';
import { readLocalePreference } from '@/lib/locale/preference';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate, pluralise } from '@/lib/utils';

export const metadata: Metadata = { title: 'Returns', robots: { index: false, follow: false } };

export default async function ReturnsPage() {
  const config = await getStoreConfig();
  const [returns, locale] = await Promise.all([getReturns(), readLocalePreference(config)]);

  return (
    <>
      <h1 className="text-2xl font-semibold sm:text-3xl">Returns</h1>
      <p className="mt-2 text-muted">
        Thirty days from delivery, unworn with tags on.{' '}
        <Link href="/page/return-policy" className="font-medium text-primary hover:underline">
          Read the full policy
        </Link>
        .
      </p>

      {returns.length === 0 ? (
        <EmptyState
          icon={RotateCcw}
          title="No returns"
          description="Start a return from any delivered order and it will appear here."
          action={
            <Button asChild>
              <Link href="/account/orders">View your orders</Link>
            </Button>
          }
          className="mt-8 rounded-(--radius-card) border border-dashed border-border"
        />
      ) : (
        <ul className="mt-8 space-y-4">
          {returns.map((entry) => (
            <li
              key={entry.id}
              className="flex flex-wrap items-start justify-between gap-4 rounded-(--radius-card) border border-border bg-surface p-5"
            >
              <div>
                <p className="font-mono font-semibold">{entry.returnNumber}</p>
                <p className="mt-0.5 text-sm text-muted">
                  Order{' '}
                  <Link
                    href={`/account/orders/${entry.orderNumber}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {entry.orderNumber}
                  </Link>{' '}
                  · {entry.itemCount} {pluralise(entry.itemCount, 'item')} · requested{' '}
                  {formatDate(entry.requestedAt, locale.language)}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={entry.resolution} />
                <StatusBadge status={entry.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import { getReturns } from '@/lib/api/account';
import { getStoreConfig } from '@/lib/api/store';
import { readLocalePreference } from '@/lib/locale/preference';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { getT } from '@/lib/i18n/server';
import { formatDate } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Returns'), robots: { index: false, follow: false } };
}

export default async function ReturnsPage() {
  const config = await getStoreConfig();
  const [returns, locale, t] = await Promise.all([getReturns(), readLocalePreference(config), getT()]);

  return (
    <>
      <h1 className="sr-only">{t('Returns')}</h1>
      <p className="text-muted">
        {t.rich('Thirty days from delivery, unworn with tags on. {policyLink}.', {
          policyLink: (
            <Link href="/page/return-policy" className="font-medium text-primary hover:underline">
              {t('Read the full policy')}
            </Link>
          ),
        })}
      </p>

      {returns.length === 0 ? (
        <EmptyState
          icon={RotateCcw}
          title={t('No returns')}
          description={t('Start a return from any delivered order and it will appear here.')}
          action={
            <Button asChild>
              <Link href="/account/orders">{t('View your orders')}</Link>
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
                  {t.rich(
                    entry.itemCount === 1
                      ? 'Order {orderNumber} · {count} item · requested {date}'
                      : 'Order {orderNumber} · {count} items · requested {date}',
                    {
                      orderNumber: (
                        <Link
                          href={`/account/orders/${entry.orderNumber}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {entry.orderNumber}
                        </Link>
                      ),
                      count: entry.itemCount,
                      date: formatDate(entry.requestedAt, locale.language),
                    },
                  )}
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

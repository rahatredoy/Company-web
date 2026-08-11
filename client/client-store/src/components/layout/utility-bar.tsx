import Link from 'next/link';
import type { StoreConfig, StorefrontLocale } from '@/types';
import { cn } from '@/lib/utils';
import { LocaleSelects } from './locale-selects';

/**
 * The thin strip above the header: service links on the left, language and
 * currency on the right.
 *
 * Distinct from the announcement bar, which carries campaigns. This one holds
 * the small permanent links — track an order, help, sell with us — that a dense
 * marketplace needs somewhere but that would crowd the main navigation.
 *
 * Hidden below `lg`. On a phone these live in the drawer instead, where there
 * is room to tap them.
 */
export function UtilityBar({
  config,
  locale,
  className,
}: {
  config: StoreConfig;
  locale: StorefrontLocale;
  className?: string;
}) {
  return (
    <div className={cn('hidden border-b border-border bg-surface-alt lg:block', className)}>
      <div className="container-store flex h-9 items-center justify-between gap-4 text-xs">
        <ul className="flex items-center gap-5 text-muted">
          <li>
            <Link href="/track-order" className="hover:text-primary">
              Track Your Order
            </Link>
          </li>
          <li>
            <Link href="/faq" className="hover:text-primary">
              Help Center
            </Link>
          </li>
          <li>
            <Link href="/contact" className="hover:text-primary">
              Contact Us
            </Link>
          </li>
          {config.contact.phone ? (
            <li className="hidden xl:block">
              Call us:{' '}
              <Link href={`tel:${config.contact.phone}`} className="font-medium text-foreground hover:text-primary">
                {config.contact.phone}
              </Link>
            </li>
          ) : null}
        </ul>

        <LocaleSelects
          languages={config.store.languages}
          currencies={config.store.currencies}
          language={locale.language}
          currency={locale.currency}
          tone="muted"
        />
      </div>
    </div>
  );
}

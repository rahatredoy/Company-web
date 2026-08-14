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
 * The links come from `config.utility`. They were fixed here once, which meant
 * every store advertised a Help Center whether or not it had written one.
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
  // The locale selects hide themselves when there is only one option each, so
  // with no utility links either the strip would be an empty 36px band.
  const hasSelects = config.store.languages.length > 1 || config.store.currencies.length > 1;
  if (config.utility.length === 0 && !config.contact.phone && !hasSelects) return null;

  return (
    <div className={cn('hidden border-b border-border bg-surface-alt lg:block', className)}>
      <div className="container-store flex h-9 items-center justify-between gap-4 text-xs">
        <ul className="flex items-center gap-5 text-muted">
          {config.utility.map((link) => (
            <li key={`${link.href}-${link.label}`}>
              <Link href={link.href} className="hover:text-primary">
                {link.label}
              </Link>
            </li>
          ))}
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

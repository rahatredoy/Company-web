import { cn, formatMoney } from '@/lib/utils';
import { CardText } from './card-text';

/**
 * Prices are display-only here. The server computed them; this formats them.
 *
 * The struck-through original is marked up with `<s>` and given screen-reader
 * text, so a shopper using assistive technology hears "was $49.99, now $39.99"
 * rather than two bare numbers in an ambiguous order.
 */
export function PriceDisplay({
  price,
  salePrice,
  currency,
  locale = 'en-US',
  size = 'md',
  className,
}: {
  price: string;
  salePrice?: string | null;
  currency: string;
  locale?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const onSale = Boolean(salePrice);
  const current = salePrice ?? price;

  const sizes = {
    sm: { current: 'text-sm font-semibold', was: 'text-[10.5px]' },
    md: { current: 'text-base font-semibold', was: 'text-xs' },
    lg: { current: 'text-xl font-semibold', was: 'text-sm' },
    xl: { current: 'text-3xl font-bold', was: 'text-base' },
  }[size];

  return (
    /*
     * `flex-wrap` is kept as the safety net for a currency long enough to need
     * a second line, but the struck price is now a step smaller than the live
     * one at every size — so on a narrow card the pair fits on one line, which
     * is what stops one long price stretching every card in the row.
     */
    <p className={cn('flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5', className)}>
      <span className={cn(sizes.current, onSale ? 'text-sale' : 'text-foreground')}>
        {onSale ? <span className="sr-only"><CardText text="Sale price" /> </span> : null}
        {formatMoney(current, currency, locale)}
      </span>

      {onSale ? (
        <s className={cn(sizes.was, 'text-subtle')}>
          <span className="sr-only"><CardText text="Regular price" /> </span>
          {formatMoney(price, currency, locale)}
        </s>
      ) : null}
    </p>
  );
}

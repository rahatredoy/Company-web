import Image from 'next/image';
import Link from 'next/link';
import type { ProductSummary } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PriceDisplay } from '@/components/commerce/price-display';
import { cn } from '@/lib/utils';
import { Countdown } from './countdown';

/**
 * The "Deal of the Day" card: one product, a running clock, a saving.
 *
 * Renders nothing without a product. A deal panel with an empty slot in it is
 * worse than no deal panel, and the section config can name a product that has
 * since been unpublished.
 *
 * The saving comes from `discountPercent`, which the server computes from the
 * same two numbers it renders as the price — so the badge cannot claim 25% off
 * while the prices show 20%.
 */
export function DealOfTheDay({
  product,
  deadline,
  title = 'Deal of the Day',
  locale,
  layout = 'split',
  className,
}: {
  product: ProductSummary;
  /** Epoch milliseconds, or null to show the card without a clock. */
  deadline: number | null;
  title?: string | null;
  locale: string;
  /** `split` is the wide marketplace card; `stacked` fits a narrow column. */
  layout?: 'split' | 'stacked';
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden rounded-(--radius-card) border border-border bg-surface',
        layout === 'split' && 'sm:grid sm:grid-cols-2 sm:items-stretch',
        className,
      )}
    >
      <div className={cn('order-2 flex-1 p-5 sm:order-1 sm:p-6', layout === 'stacked' && 'order-2')}>
        <p className="text-lg font-semibold leading-tight sm:text-xl">{title}</p>

        {deadline ? <Countdown deadline={deadline} className="mt-4" size="md" /> : null}

        <h3 className="mt-5 text-base font-medium leading-snug">
          <Link href={`/product/${product.slug}`} className="hover:text-primary">
            {product.name}
          </Link>
        </h3>

        <PriceDisplay
          price={product.price}
          salePrice={product.salePrice}
          currency={product.currency}
          locale={locale}
          size="xl"
          className="mt-2"
        />

        {product.discountPercent ? (
          <Badge tone="soft" size="lg" className="mt-3">
            Save {product.discountPercent}%
          </Badge>
        ) : null}

        <Button asChild size="md" className="mt-5 w-full sm:w-auto">
          <Link href={`/product/${product.slug}`}>
            {product.inStock ? 'Shop now' : 'View product'}
          </Link>
        </Button>
      </div>

      {/*
        On the split layout the media fills the card's own height rather than
        holding a fixed aspect ratio. The copy column is the taller of the two,
        and a square image beside it left a third of the card empty.
      */}
      <div
        className={cn(
          'relative order-1 aspect-4/3 w-full bg-surface-alt sm:order-2',
          layout === 'split' && 'sm:aspect-auto sm:h-full sm:min-h-64',
        )}
      >
        {product.primaryImage ? (
          <Image
            src={product.primaryImage.url}
            alt={product.primaryImage.altText ?? product.name}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 40vw, 100vw"
            className="object-cover"
          />
        ) : null}

        {!product.inStock ? (
          <span className="absolute inset-x-0 bottom-0 bg-foreground/75 py-1.5 text-center text-xs font-medium text-white">
            Out of stock
          </span>
        ) : null}
      </div>
    </div>
  );
}

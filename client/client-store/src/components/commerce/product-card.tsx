import Image from 'next/image';
import Link from 'next/link';
import type { ProductSummary } from '@/types';
import { cn } from '@/lib/utils';
import { PriceDisplay } from './price-display';
import { WishlistButton } from './wishlist-button';
import { QuickAdd } from './quick-add';
import { MeasureAdd } from './measure-add';
import { CardText, MeasureRate } from './card-text';

export type ProductCardVariant = 'compact' | 'standard' | 'editorial' | 'spec' | 'wide';

/**
 * The one product card every template uses.
 *
 * A template picks a `variant` and gets a different presentation — density,
 * image ratio, which badges show — but the data, the links and the wishlist
 * behaviour are identical everywhere. Six bespoke cards would be six chances for
 * one of them to quietly stop showing a sale price.
 *
 * `cost price`, stock counts, supplier and internal notes are not in
 * `ProductSummary` at all, so no card can leak them by accident.
 */
export function ProductCard({
  product,
  variant = 'standard',
  locale = 'en-US',
  priority = false,
  className,
}: {
  product: ProductSummary;
  variant?: ProductCardVariant;
  locale?: string;
  /** Set only for above-the-fold images; everything else lazy-loads. */
  priority?: boolean;
  className?: string;
}) {
  const href = `/product/${product.slug}`;
  const image = product.primaryImage;
  const hover = product.secondaryImage;

  const isEditorial = variant === 'editorial';
  const isCompact = variant === 'compact';
  const isWide = variant === 'wide';
  const isSpec = variant === 'spec';

  const mediaRatio = isEditorial
    ? 'product-media-portrait'
    : isWide
      ? 'product-media-landscape'
      : '';

  // Minimal and editorial designs stay quiet: only a discount earns a badge.
  const showAllBadges = !isEditorial;

  return (
    <article
      className={cn(
        'group relative flex flex-col',
        !isEditorial &&
          'rounded-(--radius-card) border border-border bg-surface transition-shadow hover:shadow-[var(--shadow-card)]',
        className,
      )}
    >
      <div className={cn('product-media', mediaRatio, !isEditorial && 'rounded-b-none')}>
        <Link href={href} tabIndex={-1} aria-hidden className="absolute inset-0 z-10">
          <span className="sr-only">{product.name}</span>
        </Link>

        {image ? (
          <>
            <Image
              src={image.url}
              alt={image.altText ?? product.name}
              fill
              // Matches the widest grid any template uses, so the browser never
              // downloads a 1600px file for a 300px card.
              sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
              priority={priority}
              className={cn(
                'object-cover transition-opacity duration-300',
                hover && 'group-hover:opacity-0',
              )}
            />
            {hover ? (
              <Image
                src={hover.url}
                alt=""
                aria-hidden
                fill
                sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                className="object-cover opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />
            ) : null}
          </>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs text-subtle">
            <CardText text="No image" />
          </div>
        )}

        <div className="absolute left-2 top-2 z-20 flex flex-col items-start gap-1">
          {product.discountPercent ? (
            <span className="rounded-(--radius-button) bg-sale px-2 py-1 text-[10.5px] font-semibold leading-none text-white">
              <CardText text="−{percent}%" vars={{ percent: product.discountPercent }} />
            </span>
          ) : null}
          {showAllBadges && product.isNewArrival ? (
            <span className="rounded-(--radius-button) bg-primary px-2 py-1 text-[10.5px] font-semibold leading-none text-primary-foreground">
              <CardText text="New" />
            </span>
          ) : null}
          {showAllBadges && product.isBestSeller ? (
            <span className="rounded-(--radius-button) bg-accent-soft px-2 py-1 text-[10.5px] font-semibold leading-none text-foreground">
              <CardText text="Best seller" />
            </span>
          ) : null}
        </div>

        {/* Stock is stated in words, never by colour alone. */}
        {!product.inStock ? (
          <div className="absolute inset-x-0 bottom-0 z-20 bg-foreground/75 py-1.5 text-center text-xs font-medium text-white">
            <CardText text="Out of stock" />
          </div>
        ) : null}

        {/*
          Two client islands, so the card itself stays a Server Component.

          A product sold by weight takes its picker below the picture instead of
          the floating button — a size dropdown over the artwork would cover the
          thing the shopper is identifying it by.
        */}
        <WishlistButton product={product} />
        {product.measure ? null : <QuickAdd product={product} locale={locale} />}
      </div>

      <div
        className={cn(
          'flex flex-col gap-1',
          isCompact ? 'p-2.5' : isEditorial ? 'pt-3' : 'p-3',
        )}
      >
        {product.brand && !isEditorial ? (
          <p className="truncate text-[10.5px] font-medium uppercase leading-none tracking-wide text-subtle">
            {product.brand.name}
          </p>
        ) : null}

        {/*
          Clamped to two lines, and reserving two lines whether or not it needs
          them. A one-line name beside a two-line one used to leave the shorter
          card's price stranded halfway down — every card in a row is stretched
          to the tallest, and the slack landed in the middle. Fixing the text
          block's height puts every price on the same line across the row, and
          takes the wasted height out of the card entirely.
        */}
        {/*
          Line height is pinned in pixels and the min-height is exactly twice
          it, so a one-line and a two-line name occupy an identical box.
          `leading-snug` is a ratio, and `text-[12px]` carries no line-height of
          its own, so the pair resolved to a fractional height that rounded
          differently per card and put the prices a few pixels out of step down
          the row. Whole numbers remove the rounding entirely.
        */}
        <h3
          className={cn(
            'line-clamp-2 font-medium',
            isCompact ? 'min-h-9 text-[12px]/[18px]' : 'min-h-10 text-sm/[20px]',
          )}
        >
          <Link href={href} className="relative z-20 hover:text-primary">
            {product.name}
          </Link>
        </h3>

        {isSpec && product.keySpec ? (
          <p className="line-clamp-1 text-xs text-muted">{product.keySpec}</p>
        ) : null}

        {/*
          The price and what it buys, on one line.

          The rate is *part of the price* for a product sold by weight — "৳40"
          beside "Per 1kg" is a different offer from "৳40" alone — so it sits
          with the number rather than under the name, and the shop's floor sits
          with it because it is the other half of what the price means.
        */}
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          <PriceDisplay
            price={product.price}
            salePrice={product.salePrice}
            currency={product.currency}
            locale={locale}
            size={isCompact ? 'sm' : 'md'}
          />

          {product.measure ? (
            <span className="text-[10.5px] text-subtle">
              <MeasureRate measure={product.measure} />
            </span>
          ) : null}
        </div>

        {product.measure && product.inStock ? <MeasureAdd product={product} className="mt-1" /> : null}

        {isSpec && product.inStock ? (
          <p className={cn('text-xs font-medium', product.lowStock ? 'text-warning' : 'text-success')}>
            <CardText text={product.lowStock ? 'Low stock' : 'In stock'} />
          </p>
        ) : null}
      </div>
    </article>
  );
}

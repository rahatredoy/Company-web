'use client';

import Image from 'next/image';
import Link from 'next/link';
import { GitCompareArrows, ShoppingCart, X } from 'lucide-react';
import { toast } from 'sonner';
import type { ProductSummary } from '@/types';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { RatingStars } from '@/components/commerce/rating-stars';
import { PriceDisplay } from '@/components/commerce/price-display';
import { useCompare } from '@/lib/commerce/collections';
import { useCart } from '@/lib/commerce/cart';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import { useT, type MessageKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Side-by-side comparison.
 *
 * A real `<table>` with row headers, so a screen reader can announce "Price,
 * Running Sneakers, $89.99" instead of reading a grid of orphaned numbers. On a
 * phone the table scrolls sideways inside its own container and the first
 * column stays put — the alternative, stacking each product into its own card,
 * removes the only thing a comparison is for.
 */

interface Row {
  label: MessageKey;
  render: (product: ProductSummary) => React.ReactNode;
}

export function CompareTable({ locale }: { locale: string }) {
  const t = useT();
  const compare = useCompare();
  const { add } = useCart();
  const hydrated = useHydrated();

  if (!hydrated) {
    return (
      <div className="mt-8 grid gap-4 sm:grid-cols-3" aria-busy="true">
        <span className="sr-only">{t('Loading your comparison…')}</span>
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-96 rounded-(--radius-card)" />
        ))}
      </div>
    );
  }

  if (compare.items.length === 0) {
    return (
      <EmptyState
        icon={GitCompareArrows}
        title={t('Nothing to compare yet')}
        description={t(
          'Add up to {limit} products and their prices, ratings and specifications line up side by side here.',
          { limit: compare.limit },
        )}
        action={
          <Button asChild size="lg">
            <Link href="/shop">{t('Browse products')}</Link>
          </Button>
        }
        className="mt-6 rounded-(--radius-card) border border-dashed border-border"
      />
    );
  }

  const rows: Row[] = [
    {
      label: 'Price',
      render: (product) => (
        <PriceDisplay
          price={product.price}
          salePrice={product.salePrice}
          currency={product.currency}
          locale={locale}
          size="md"
        />
      ),
    },
    {
      label: 'Rating',
      render: (product) =>
        product.ratingCount > 0 ? (
          <RatingStars rating={product.ratingAverage} count={product.ratingCount} size="sm" />
        ) : (
          <span className="text-sm text-subtle">{t('No reviews yet')}</span>
        ),
    },
    {
      label: 'Brand',
      render: (product) =>
        product.brand ? (
          <Link href={`/brand/${product.brand.slug}`} className="text-sm hover:text-primary">
            {product.brand.name}
          </Link>
        ) : (
          <span className="text-sm text-subtle">—</span>
        ),
    },
    {
      label: 'Availability',
      render: (product) => (
        <span
          className={cn(
            'text-sm font-medium',
            product.inStock ? (product.lowStock ? 'text-warning' : 'text-success') : 'text-error',
          )}
        >
          {product.inStock ? (product.lowStock ? t('Low stock') : t('In stock')) : t('Out of stock')}
        </span>
      ),
    },
    {
      label: 'Key specification',
      render: (product) => (
        <span className="text-sm text-muted">{product.keySpec ?? '—'}</span>
      ),
    },
    {
      label: 'Options',
      render: (product) => (
        <span className="text-sm text-muted">
          {product.hasVariants ? t('Colours and sizes available') : t('Single option')}
        </span>
      ),
    },
  ];

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <p className="text-sm text-muted">
          {t('Comparing {count} of {limit}', { count: compare.items.length, limit: compare.limit })}
        </p>
        <Button size="sm" variant="ghost" onClick={compare.clear}>
          {t('Clear all')}
        </Button>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-left">
          <caption className="sr-only">
            {t('Product comparison across price, rating, brand, availability and specifications')}
          </caption>

          <thead>
            <tr>
              <th scope="col" className="w-36 p-3 align-bottom">
                <span className="sr-only">{t('Attribute')}</span>
              </th>

              {compare.items.map((product) => (
                <th key={product.id} scope="col" className="min-w-52 p-3 align-bottom">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => compare.remove(product.id)}
                      aria-label={t('Remove {name} from comparison', { name: product.name })}
                      className="absolute right-0 top-0 z-10 grid size-7 place-items-center rounded-full bg-surface text-muted shadow-[var(--shadow-card)] transition-colors hover:text-error"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>

                    <Link href={`/product/${product.slug}`} className="group block">
                      <span className="product-media block">
                        {product.primaryImage ? (
                          <Image
                            src={product.primaryImage.url}
                            alt={product.primaryImage.altText ?? product.name}
                            fill
                            sizes="208px"
                            className="object-cover"
                          />
                        ) : null}
                      </span>

                      <span className="mt-3 block text-sm font-medium leading-snug group-hover:text-primary">
                        {product.name}
                      </span>
                    </Link>
                  </div>
                </th>
              ))}
            </tr>
          </thead>

          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.label}>
                <th scope="row" className="p-3 align-top text-sm font-medium text-subtle">
                  {t(row.label)}
                </th>
                {compare.items.map((product) => (
                  <td key={product.id} className="p-3 align-top">
                    {row.render(product)}
                  </td>
                ))}
              </tr>
            ))}

            <tr>
              <th scope="row" className="p-3 text-sm font-medium text-subtle">
                <span className="sr-only">{t('Actions')}</span>
              </th>
              {compare.items.map((product) => (
                <td key={product.id} className="p-3">
                  <Button
                    size="sm"
                    disabled={!product.inStock}
                    onClick={() => {
                      add({
                        productId: product.id,
                        variantId: product.id,
                        slug: product.slug,
                        name: product.name,
                        variantTitle: null,
                        imageUrl: product.primaryImage?.url ?? null,
                        unitPrice: product.price,
                        unitSalePrice: product.salePrice,
                        currency: product.currency,
                        quantity: 1,
                      });
                      toast.success(t('{name} added to your cart', { name: product.name }));
                    }}
                    className="w-full"
                  >
                    <ShoppingCart aria-hidden />
                    {product.inStock ? t('Add to cart') : t('Out of stock')}
                  </Button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

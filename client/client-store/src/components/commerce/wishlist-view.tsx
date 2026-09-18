'use client';

import Link from 'next/link';
import { ShoppingCart, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ProductGridSkeleton } from '@/components/ui/skeleton';
import { ProductCard, type ProductCardVariant } from '@/components/commerce/product-card';
import { useWishlist } from '@/lib/commerce/collections';
import { WishlistIcon } from '@/lib/commerce/wishlist-icon';
import { useCart } from '@/lib/commerce/cart';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import { useT } from '@/lib/i18n';

/**
 * The wishlist.
 *
 * Prices shown are the ones captured when the item was saved, which can be
 * weeks old — so the page says so rather than presenting a stale number as
 * current. Adding to the cart is what re-reads the live price, and the cart is
 * in turn re-priced by the server at checkout.
 *
 * "Add all in-stock to cart" skips anything unavailable rather than failing the
 * whole action, and reports how many it actually added.
 */
export function WishlistView({
  locale,
  gridClassName,
  cardVariant,
}: {
  locale: string;
  gridClassName: string;
  cardVariant: ProductCardVariant;
}) {
  const t = useT();
  const wishlist = useWishlist();
  const { add } = useCart();
  const hydrated = useHydrated();

  if (!hydrated) {
    return <ProductGridSkeleton count={8} className={`mt-8 ${gridClassName}`} />;
  }

  if (wishlist.items.length === 0) {
    return (
      <EmptyState
        icon={WishlistIcon}
        title={t('Your wishlist is empty')}
        description={t('Tap the wishlist icon on anything you like and it will be waiting here.')}
        action={
          <Button asChild size="lg">
            <Link href="/shop">{t('Browse products')}</Link>
          </Button>
        }
        className="mt-6 rounded-(--radius-card) border border-dashed border-border"
      />
    );
  }

  const inStock = wishlist.items.filter((item) => item.inStock);

  const addAll = () => {
    for (const item of inStock) {
      add({
        productId: item.id,
        variantId: item.id,
        slug: item.slug,
        name: item.name,
        variantTitle: null,
        imageUrl: item.primaryImage?.url ?? null,
        unitPrice: item.price,
        unitSalePrice: item.salePrice,
        currency: item.currency,
        quantity: 1,
      });
    }

    const skipped = wishlist.items.length - inStock.length;
    toast.success(
      t.plural(inStock.length, '{count} item added to your cart', '{count} items added to your cart'),
      {
        description:
          skipped > 0
            ? t.plural(skipped, '{count} out-of-stock item skipped.', '{count} out-of-stock items skipped.')
            : undefined,
      },
    );
  };

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <p className="text-sm text-muted">
          {t.plural(wishlist.count, '{count} saved item', '{count} saved items')}
          {inStock.length < wishlist.count
            ? ' · ' + t('{count} currently unavailable', { count: wishlist.count - inStock.length })
            : ''}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={addAll} disabled={inStock.length === 0}>
            <ShoppingCart aria-hidden />
            {t('Add all in stock')}
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              wishlist.clear();
              toast.message(t('Wishlist cleared'));
            }}
          >
            <Trash2 aria-hidden />
            {t('Clear')}
          </Button>
        </div>
      </div>

      <div className={`mt-6 ${gridClassName}`}>
        {wishlist.items.map((product) => (
          <ProductCard key={product.id} product={product} variant={cardVariant} locale={locale} />
        ))}
      </div>

      <p className="mt-8 text-xs text-subtle">
        {t(
          'Prices were captured when you saved each item and may have changed. The current price is applied when you add something to your cart.',
        )}
      </p>
    </>
  );
}

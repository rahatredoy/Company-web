'use client';

import Link from 'next/link';
import { Heart, ShoppingCart, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ProductGridSkeleton } from '@/components/ui/skeleton';
import { ProductCard, type ProductCardVariant } from '@/components/commerce/product-card';
import { useWishlist } from '@/lib/commerce/collections';
import { useCart } from '@/lib/commerce/cart';
import { useHydrated } from '@/lib/hooks/use-hydrated';
import { pluralise } from '@/lib/utils';

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
  const wishlist = useWishlist();
  const { add } = useCart();
  const hydrated = useHydrated();

  if (!hydrated) {
    return <ProductGridSkeleton count={8} className={`mt-8 ${gridClassName}`} />;
  }

  if (wishlist.items.length === 0) {
    return (
      <EmptyState
        icon={Heart}
        title="Your wishlist is empty"
        description="Tap the heart on anything you like and it will be waiting here."
        action={
          <Button asChild size="lg">
            <Link href="/shop">Browse products</Link>
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
    toast.success(`${inStock.length} ${pluralise(inStock.length, 'item')} added to your cart`, {
      description: skipped > 0 ? `${skipped} out-of-stock ${pluralise(skipped, 'item')} skipped.` : undefined,
    });
  };

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <p className="text-sm text-muted">
          {wishlist.count} saved {pluralise(wishlist.count, 'item')}
          {inStock.length < wishlist.count
            ? ` · ${wishlist.count - inStock.length} currently unavailable`
            : ''}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={addAll} disabled={inStock.length === 0}>
            <ShoppingCart aria-hidden />
            Add all in stock
          </Button>

          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              wishlist.clear();
              toast.message('Wishlist cleared');
            }}
          >
            <Trash2 aria-hidden />
            Clear
          </Button>
        </div>
      </div>

      <div className={`mt-6 ${gridClassName}`}>
        {wishlist.items.map((product) => (
          <ProductCard key={product.id} product={product} variant={cardVariant} locale={locale} />
        ))}
      </div>

      <p className="mt-8 text-xs text-subtle">
        Prices were captured when you saved each item and may have changed. The current price is
        applied when you add something to your cart.
      </p>
    </>
  );
}

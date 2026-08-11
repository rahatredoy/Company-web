'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, ShoppingCart, Truck } from 'lucide-react';
import { toast } from 'sonner';
import type { ProductDetail } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { PriceDisplay } from '@/components/commerce/price-display';
import { RatingStars } from '@/components/commerce/rating-stars';
import { WishlistButton } from '@/components/commerce/wishlist-button';
import { useCart } from '@/lib/commerce/cart';
import { useRecentlyViewed } from '@/lib/commerce/collections';
import { cn } from '@/lib/utils';
import { ProductGallery } from './product-gallery';
import { VariantSelector, findVariant, initialSelection } from './variant-selector';
import { StockStatus } from './stock-status';
import { ShareButton } from './share-button';

/**
 * The buying half of the product page: gallery, variants, quantity, actions.
 *
 * One client component rather than several, because the gallery, the price, the
 * stock line and the Add to Cart button all depend on the selected variant.
 * Splitting them would mean lifting that selection into a context read by four
 * islands — more machinery for the same result.
 *
 * Everything below the fold (description, specifications, reviews, related)
 * stays server-rendered.
 */
export function ProductPurchase({
  product,
  locale,
}: {
  product: ProductDetail;
  locale: string;
}) {
  const router = useRouter();
  const { add } = useCart();
  const recentlyViewed = useRecentlyViewed();

  const [selection, setSelection] = React.useState(() =>
    initialSelection(product.variants, product.defaultVariantId),
  );
  const [quantity, setQuantity] = React.useState(product.minOrderQuantity || 1);
  const [justAdded, setJustAdded] = React.useState(false);

  const variant = findVariant(product.variants, selection);
  const hasVariants = product.variants.length > 0;

  // Without variants the product's own stock and price apply.
  const inStock = hasVariants ? Boolean(variant?.inStock) : product.inStock;
  const lowStock = hasVariants ? Boolean(variant?.lowStock) : product.lowStock;
  const price = variant?.price ?? product.price;
  const salePrice = variant?.salePrice ?? product.salePrice;
  const sku = variant?.sku ?? null;

  /*
   * Record the view once, on mount. Inside an effect rather than during render
   * because writing to storage while rendering is a side effect React is free
   * to run twice.
   */
  const recordedRef = React.useRef(false);
  React.useEffect(() => {
    if (recordedRef.current) return;
    recordedRef.current = true;

    const { images, ...summary } = product;
    recentlyViewed.add({
      ...summary,
      primaryImage: images[0] ?? null,
      secondaryImage: images[1] ?? null,
    });
    // `recentlyViewed` is a fresh object each render; depending on it would
    // re-run this on every keystroke elsewhere in the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  const addToCart = (): boolean => {
    if (!inStock) return false;
    if (hasVariants && !variant) {
      toast.error('That combination is not available. Please choose another.');
      return false;
    }

    add({
      productId: product.id,
      variantId: variant?.id ?? product.id,
      slug: product.slug,
      name: product.name,
      variantTitle: variant?.title ?? null,
      imageUrl: product.images[0]?.url ?? null,
      unitPrice: price,
      unitSalePrice: salePrice,
      currency: product.currency,
      quantity,
      maxQuantity: product.maxOrderQuantity,
    });

    return true;
  };

  const onAddToCart = () => {
    if (!addToCart()) return;

    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 2200);

    toast.success(`${product.name} added to your cart`, {
      description: variant?.title ?? undefined,
      action: { label: 'View cart', onClick: () => router.push('/cart') },
    });
  };

  const onBuyNow = () => {
    if (addToCart()) router.push('/checkout');
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-12">
      <ProductGallery
        images={product.images}
        productName={product.name}
        activeImageUrl={variant?.imageUrl}
      />

      <div>
        {product.brand ? (
          <p className="text-sm font-medium uppercase tracking-wide text-subtle">
            {product.brand.name}
          </p>
        ) : null}

        <h1 className="mt-1 text-2xl font-semibold leading-tight sm:text-3xl">{product.name}</h1>

        {product.ratingCount > 0 ? (
          <a href="#reviews" className="mt-3 inline-flex items-center gap-2 hover:text-primary">
            <RatingStars rating={product.ratingAverage} count={product.ratingCount} size="sm" />
          </a>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <PriceDisplay
            price={price}
            salePrice={salePrice}
            currency={product.currency}
            locale={locale}
            size="xl"
          />
          {product.discountPercent ? (
            <Badge tone="sale" size="lg">
              Save {product.discountPercent}%
            </Badge>
          ) : null}
        </div>

        {product.shortDescription ? (
          <p className="mt-4 text-sm leading-relaxed text-muted">{product.shortDescription}</p>
        ) : null}

        <div className="mt-6">
          <StockStatus inStock={inStock} lowStock={lowStock} remaining={variant?.remainingHint ?? null} />
        </div>

        {hasVariants ? (
          <VariantSelector
            options={product.options}
            variants={product.variants}
            selection={selection}
            onChange={setSelection}
            className="mt-6"
          />
        ) : null}

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <QuantityStepper
            value={quantity}
            onChange={setQuantity}
            min={product.minOrderQuantity || 1}
            max={product.maxOrderQuantity}
            disabled={!inStock}
          />

          <Button
            size="lg"
            onClick={onAddToCart}
            disabled={!inStock}
            className={cn('flex-1 sm:flex-none sm:min-w-48', justAdded && 'bg-success')}
          >
            {justAdded ? <Check aria-hidden /> : <ShoppingCart aria-hidden />}
            {justAdded ? 'Added to cart' : inStock ? 'Add to cart' : 'Out of stock'}
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            size="lg"
            variant="secondary"
            onClick={onBuyNow}
            disabled={!inStock}
            className="flex-1 sm:flex-none sm:min-w-48"
          >
            Buy now
          </Button>

          <WishlistButton
            product={{
              ...product,
              primaryImage: product.images[0] ?? null,
              secondaryImage: product.images[1] ?? null,
            }}
            variant="inline"
          />

          <ShareButton title={product.name} />
        </div>

        {!inStock ? (
          <p className="mt-4 text-sm text-muted">
            This item is out of stock. Add it to your wishlist and we will let you know when it is
            back.
          </p>
        ) : null}

        <dl className="mt-8 space-y-3 border-t border-border pt-6 text-sm">
          {sku ? (
            <div className="flex gap-2">
              <dt className="text-subtle">SKU</dt>
              <dd className="font-mono text-xs leading-5">{sku}</dd>
            </div>
          ) : null}

          {product.category ? (
            <div className="flex gap-2">
              <dt className="text-subtle">Category</dt>
              <dd>{product.category.name}</dd>
            </div>
          ) : null}

          {product.shippingInfo ? (
            <div className="flex items-start gap-2">
              <dt className="sr-only">Delivery</dt>
              <dd className="flex items-start gap-2 text-muted">
                <Truck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                {product.shippingInfo}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </div>
  );
}

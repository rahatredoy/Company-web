'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import type { ProductDetail } from '@/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import {
  defaultOption,
  minimumNote,
  priceForMeasure,
  pricingLabelOf,
  startingQuantity,
} from '@/lib/commerce/measure';
import { PriceDisplay } from '@/components/commerce/price-display';
import { RatingStars } from '@/components/commerce/rating-stars';
import { WishlistButton } from '@/components/commerce/wishlist-button';
import { useCart } from '@/lib/commerce/cart';
import { useRecentlyViewed } from '@/lib/commerce/collections';
import { useT } from '@/lib/i18n';
import { cn, formatMoney } from '@/lib/utils';
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
  const t = useT();
  const router = useRouter();
  const { add } = useCart();
  const recentlyViewed = useRecentlyViewed();

  const [selection, setSelection] = React.useState(() =>
    initialSelection(product.variants, product.defaultVariantId),
  );
  const [justAdded, setJustAdded] = React.useState(false);

  /*
   * The size, for a product sold by weight or volume — the same choice the card
   * offers, kept here so arriving from a card and arriving from a search land on
   * the same default.
   */
  const measure = product.measure;
  const [size, setSize] = React.useState(() => (measure ? defaultOption(measure).measure : 0));
  const option = measure
    ? (measure.options.find((entry) => entry.measure === size) ?? defaultOption(measure))
    : null;

  const [quantity, setQuantity] = React.useState(
    measure
      ? startingQuantity(defaultOption(measure).measure, measure.minMeasure)
      : product.minOrderQuantity || 1,
  );

  const variant = findVariant(product.variants, selection);
  const hasVariants = product.variants.length > 0;

  // Without variants the product's own stock and price apply.
  const inStock = hasVariants ? Boolean(variant?.inStock) : product.inStock;
  const lowStock = hasVariants ? Boolean(variant?.lowStock) : product.lowStock;
  /*
   * For a measure product the stored price is a *rate*, so what is displayed and
   * what is added to the basket is that rate scaled to the chosen size — the
   * same arithmetic, in the same order, that the API charges with.
   */
  const rate = variant?.price ?? product.price;
  const saleRate = variant?.salePrice ?? product.salePrice;
  const price =
    measure && option ? priceForMeasure(rate, option.measure, measure.pricingMeasure) : rate;
  const salePrice =
    measure && option && saleRate
      ? priceForMeasure(saleRate, option.measure, measure.pricingMeasure)
      : saleRate;
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
      toast.error(t('That combination is not available. Please choose another.'));
      return false;
    }

    add({
      productId: product.id,
      variantId: variant?.id ?? product.id,
      slug: product.slug,
      name: product.name,
      variantTitle: option?.label ?? variant?.title ?? null,
      imageUrl: product.images[0]?.url ?? null,
      unitPrice: price,
      unitSalePrice: salePrice,
      currency: product.currency,
      quantity,
      maxQuantity: product.maxOrderQuantity,
      measureLabel: option?.label ?? null,
      measure: option?.measure ?? null,
    });

    return true;
  };

  const onAddToCart = () => {
    if (!addToCart()) return;

    setJustAdded(true);
    window.setTimeout(() => setJustAdded(false), 2200);

    toast.success(t('{name} added to your cart', { name: product.name }), {
      description: variant?.title ?? undefined,
      action: { label: t('View cart'), onClick: () => router.push('/cart') },
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
              {t('Save {percent}%', { percent: product.discountPercent })}
            </Badge>
          ) : null}
        </div>

        {/*
          What the price above is the price *of*. The heading number changes as
          the size does, so without this a shopper who picked 250gm sees a figure
          that matches neither the card they came from nor the shelf rate.
        */}
        {measure && option ? (
          <p className="mt-1 text-sm text-muted">
            {t('{size} · {rate} is {price}', {
              size: option.label,
              rate: pricingLabelOf(measure, t),
              price: formatMoney(saleRate ?? rate, product.currency, locale),
            })}
            {minimumNote(measure, t) ? ' · ' + minimumNote(measure, t) : ''}
          </p>
        ) : null}

        <div className="mt-6">
          <StockStatus inStock={inStock} lowStock={lowStock} remaining={variant?.remainingHint ?? null} />
        </div>

        {/*
          Chips rather than a dropdown here, unlike the card: the product page
          has the width for them, and a shopper who has arrived to decide how
          much to buy should be able to see the sizes and their prices at once
          rather than opening a menu to compare them.
        */}
        {measure && measure.options.length > 1 ? (
          <div className="mt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-subtle">{t('Size')}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {measure.options.map((entry) => {
                const active = entry.measure === option?.measure;
                return (
                  <button
                    key={entry.measure}
                    type="button"
                    onClick={() => {
                      setSize(entry.measure);
                      // The floor is on the line's *total*, so switching to a
                      // smaller size has to raise the counter to match — landing
                      // on a quantity the till would refuse is worse than moving
                      // a number the shopper can still change.
                      setQuantity(startingQuantity(entry.measure, measure.minMeasure));
                    }}
                    aria-pressed={active}
                    className={cn(
                      'rounded-(--radius-button) border px-3 py-2 text-sm transition-colors',
                      active
                        ? 'border-primary bg-primary/5 text-primary'
                        : 'border-border text-foreground hover:border-primary/50',
                    )}
                  >
                    <span className="font-medium">{entry.label}</span>
                    <span className="ml-1.5 text-xs text-subtle">
                      {formatMoney(
                        priceForMeasure(saleRate ?? rate, entry.measure, measure.pricingMeasure),
                        product.currency,
                        locale,
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

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
            min={
              measure && option
                ? startingQuantity(option.measure, measure.minMeasure)
                : product.minOrderQuantity || 1
            }
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
            {justAdded ? t('Added to cart') : inStock ? t('Add to cart') : t('Out of stock')}
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
            {t('Buy now')}
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
            {t(
              'This item is out of stock. Add it to your wishlist and we will let you know when it is back.',
            )}
          </p>
        ) : null}

        <dl className="mt-8 space-y-3 border-t border-border pt-6 text-sm">
          {sku ? (
            <div className="flex gap-2">
              {/* i18n-ignore */}
              <dt className="text-subtle">SKU</dt>
              <dd className="font-mono text-xs leading-5">{sku}</dd>
            </div>
          ) : null}

          {product.category ? (
            <div className="flex gap-2">
              <dt className="text-subtle">{t('Category')}</dt>
              <dd>{product.category.name}</dd>
            </div>
          ) : null}

        </dl>
      </div>
    </div>
  );
}

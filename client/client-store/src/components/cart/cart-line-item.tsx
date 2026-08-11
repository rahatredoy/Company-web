'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Heart, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { CartLine } from '@/types';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { PriceDisplay } from '@/components/commerce/price-display';
import { useCart } from '@/lib/commerce/cart';
import { useWishlist } from '@/lib/commerce/collections';
import { formatMoney } from '@/lib/utils';
import { cn } from '@/lib/utils';

/**
 * One line in the basket.
 *
 * Shows both the unit price and the line total. A cart that shows only the line
 * total makes a shopper do the division to check the unit price they were
 * quoted, which is exactly when they lose confidence in the number.
 *
 * "Move to wishlist" removes and saves in one action, because that is what
 * someone means when they take an item out but are not done with it.
 */
export function CartLineItem({
  line,
  currency,
  locale,
  compact = false,
}: {
  line: CartLine;
  currency: string;
  locale: string;
  compact?: boolean;
}) {
  const { updateQuantity, remove } = useCart();
  const wishlist = useWishlist();

  const unit = line.unitSalePrice ?? line.unitPrice;

  const moveToWishlist = () => {
    wishlist.add({
      id: line.productId,
      slug: line.slug,
      name: line.name,
      brand: null,
      primaryImage: line.imageUrl
        ? { url: line.imageUrl, altText: line.name, width: 800, height: 800 }
        : null,
      secondaryImage: null,
      price: line.unitPrice,
      salePrice: line.unitSalePrice,
      discountPercent: null,
      currency,
      ratingAverage: 0,
      ratingCount: 0,
      inStock: line.inStock,
      lowStock: false,
      isNewArrival: false,
      isBestSeller: false,
      keySpec: null,
      hasVariants: false,
    });
    remove(line.id);
    toast.success('Moved to your wishlist');
  };

  return (
    <li className={cn('flex gap-4 py-5', compact && 'py-4')}>
      <Link
        href={`/product/${line.slug}`}
        className={cn(
          'relative shrink-0 overflow-hidden rounded-(--radius-button) bg-surface-alt',
          compact ? 'size-20' : 'size-24 sm:size-28',
        )}
      >
        {line.imageUrl ? (
          <Image
            src={line.imageUrl}
            alt={line.name}
            fill
            sizes="112px"
            className="object-cover"
          />
        ) : null}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className={cn('font-medium leading-snug', compact ? 'text-sm' : 'text-sm sm:text-base')}>
              <Link href={`/product/${line.slug}`} className="hover:text-primary">
                {line.name}
              </Link>
            </h3>

            {line.variantTitle ? (
              <p className="mt-0.5 text-xs text-subtle">{line.variantTitle}</p>
            ) : null}

            <PriceDisplay
              price={line.unitPrice}
              salePrice={line.unitSalePrice}
              currency={currency}
              locale={locale}
              size="sm"
              className="mt-1"
            />
          </div>

          {!compact ? (
            <p className="shrink-0 text-sm font-semibold tabular-nums sm:text-base">
              {formatMoney(line.lineTotal, currency, locale)}
            </p>
          ) : null}
        </div>

        {/* Set by the server when stock fell below the requested quantity. */}
        {!line.inStock ? (
          <p className="mt-2 text-xs font-medium text-error">
            Out of stock — remove this to check out
          </p>
        ) : line.availableQuantity !== null && line.availableQuantity < line.quantity ? (
          <p className="mt-2 text-xs font-medium text-warning">
            Only {line.availableQuantity} left — your quantity will be reduced
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-center gap-3 pt-3">
          <QuantityStepper
            value={line.quantity}
            onChange={(quantity) => updateQuantity(line.id, quantity)}
            min={1}
            max={line.availableQuantity}
            size="sm"
            label={`Quantity of ${line.name}`}
          />

          {compact ? (
            <p className="text-sm font-semibold tabular-nums">
              {formatMoney(line.lineTotal, currency, locale)}
            </p>
          ) : null}

          <div className="ml-auto flex items-center gap-1">
            {!compact ? (
              <button
                type="button"
                onClick={moveToWishlist}
                className="inline-flex items-center gap-1.5 rounded-(--radius-button) px-2 py-1.5 text-xs text-muted transition-colors hover:text-primary"
              >
                <Heart className="size-3.5" aria-hidden />
                Save for later
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => {
                remove(line.id);
                toast.message(`${line.name} removed from your cart`);
              }}
              aria-label={`Remove ${line.name} from cart`}
              className="grid size-8 place-items-center rounded-(--radius-button) text-muted transition-colors hover:text-error"
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        </div>

        <span className="sr-only">Unit price {formatMoney(unit, currency, locale)}</span>
      </div>
    </li>
  );
}

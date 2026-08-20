'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { ProductSummary } from '@/types';
import { useCart } from '@/lib/commerce/cart';
import { defaultOption, priceForMeasure, startingQuantity } from '@/lib/commerce/measure';
import { cn } from '@/lib/utils';

/**
 * Buying half a kilo of something, from the listing.
 *
 * A greengrocer's shopper is filling a basket with thirty things and knows
 * exactly how much of each they want. Sending them to a product page for every
 * one — to pick a size there, come back, and lose their place in a virtualised
 * list — is the visit they will not finish. So the size and the count are both
 * on the card.
 *
 * **The size is a `<select>`, not a custom menu.** On a phone that renders as
 * the platform's own wheel or sheet, which is what the shopper already knows how
 * to use and what an assistive technology already knows how to announce; a
 * bespoke listbox on a card that appears forty times on a page is forty focus
 * traps to get right. It also costs nothing to render, which matters here more
 * than anywhere else in the app.
 *
 * The counter appears only **after** something is in the basket, and that is
 * deliberate: before then the card's job is to advertise a price, and a stepper
 * showing "0" beside it invites the shopper to work out what one costs. This
 * mirrors what the plain `QuickAdd` does with its single button.
 */
export function MeasureAdd({
  product,
  className,
}: {
  product: ProductSummary;
  className?: string;
}) {
  const router = useRouter();
  const { cart, add, updateQuantity } = useCart();
  const measure = product.measure!;

  const [size, setSize] = React.useState(() => defaultOption(measure).measure);

  const option = measure.options.find((entry) => entry.measure === size) ?? defaultOption(measure);

  /*
   * The line for *this* size, not for this product. Two sizes of the same thing
   * are two lines, so the counter has to follow the picker — switching from 1kg
   * to 250gm shows what is in the basket at 250gm, which is usually nothing.
   */
  const lineIdFor = product.id + '::' + (product.defaultVariantId ?? '') + '::' + option.measure;
  const line = cart.lines.find((entry) => entry.id === lineIdFor) ?? null;

  const ceiling = product.maxOrderQuantity ?? Number.MAX_SAFE_INTEGER;
  const floor = startingQuantity(option.measure, measure.minMeasure);

  if (!product.inStock || !product.defaultVariantId) return null;

  const addToBasket = (quantity: number) => {
    const unit = priceForMeasure(product.price, option.measure, measure.pricingMeasure);
    const unitSale = product.salePrice
      ? priceForMeasure(product.salePrice, option.measure, measure.pricingMeasure)
      : null;

    add({
      productId: product.id,
      variantId: product.defaultVariantId!,
      slug: product.slug,
      name: product.name,
      /*
       * The size stands in for the variant title. A measure product has one
       * variant with no title of its own, and a basket line reading just the
       * product's name would not say which of the four sizes it is.
       */
      variantTitle: option.label,
      imageUrl: product.primaryImage?.url ?? null,
      unitPrice: unit,
      unitSalePrice: unitSale,
      currency: product.currency,
      quantity,
      maxQuantity: product.maxOrderQuantity,
      measureLabel: option.label,
      measure: option.measure,
    });
  };

  const onFirstAdd = () => {
    // Opens on whatever clears the shop's minimum: picking 100gm where the floor
    // is 350gm puts four in the basket rather than one the till would refuse.
    addToBasket(Math.min(ceiling, floor));

    toast.success(product.name + ' (' + option.label + ') added to your cart', {
      action: { label: 'View cart', onClick: () => router.push('/cart') },
    });
  };

  const step = (delta: number) => {
    if (!line) return;
    const next = line.quantity + delta;

    /*
     * Below the floor the line is removed rather than clamped. The floor is
     * often more than one, so "minus" on a basket of four 100gm lots has to be
     * able to reach empty — clamping there would leave the shopper unable to
     * take the item out from the card they added it on.
     */
    updateQuantity(line.id, next < floor ? 0 : Math.min(ceiling, next));
  };

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {measure.options.length > 1 ? (
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Size for {product.name}</span>
          <select
            value={option.measure}
            onChange={(event) => setSize(Number(event.target.value))}
            className="w-full appearance-none rounded-(--radius-button) border border-border bg-surface py-1.5 pl-2 pr-6 text-xs text-foreground"
          >
            {measure.options.map((entry) => (
              <option key={entry.measure} value={entry.measure}>
                {entry.label}
              </option>
            ))}
          </select>
          <svg
            aria-hidden
            viewBox="0 0 12 12"
            className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 fill-none stroke-current stroke-[1.5] text-subtle"
          >
            <path d="M3 4.5 6 7.5 9 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </label>
      ) : null}

      {line ? (
        <div className="flex shrink-0 items-center gap-1 rounded-(--radius-button) border border-border bg-surface">
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={'Less ' + product.name}
            className="grid size-7 place-items-center text-primary"
          >
            <Minus className="size-3.5" aria-hidden />
          </button>
          <span className="min-w-4 text-center text-xs font-semibold tabular-nums" aria-live="polite">
            {line.quantity}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={'More ' + product.name}
            disabled={line.quantity >= ceiling}
            className="grid size-7 place-items-center text-primary disabled:opacity-40"
          >
            <Plus className="size-3.5" aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onFirstAdd}
          aria-label={'Add ' + option.label + ' of ' + product.name + ' to cart'}
          className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-card)] transition-transform hover:scale-105 active:scale-95"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      )}
    </div>
  );
}

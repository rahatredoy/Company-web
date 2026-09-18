'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { ProductSummary } from '@/types';
import { useCart } from '@/lib/commerce/cart';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { QuickAddDialog } from './quick-add-dialog';

/**
 * Add to basket from the card itself.
 *
 * A shopper filling a basket with everyday things — five kinds of rice, a
 * washing-up liquid, two teas — was made to open five product pages and come
 * back from each of them, losing their place in the listing every time. The
 * button on the card is what that visit is actually made of.
 *
 * A separate client island for the reason `WishlistButton` is one: the card is
 * rendered up to a hundred times on a listing page, and turning the whole card
 * into client JavaScript to make one button work would ship its markup twice.
 *
 * **What it adds is a variant, never a product.** The price and the stock a
 * checkout reserves both live on the variant, so a `simple` product's single
 * variant travels with the summary (`defaultVariantId`) and this button needs no
 * request at all. A product that comes in sizes — 1 kg, 500 g, 250 g — has no
 * single answer, so the button opens a picker instead of guessing one: adding
 * the default weight because it was cheapest to do so is how somebody ends up
 * paying for a kilo of something they wanted a hundred grams of.
 *
 * **Once something is in the basket the button becomes the count**, exactly as
 * `MeasureAdd` already did for a product sold by weight. It used to flash a tick
 * for 1.8 seconds and go back to a plus, which answered "did that work" and
 * nothing else: a shopper who scrolled past and came back, or reloaded the page,
 * saw an untouched plus over a product they had already put two of in the
 * basket, and the only screen that said otherwise was the basket itself. The
 * stepper says *which* products are in there and *how many* without leaving the
 * listing, and it is read from the basket rather than from a timer, so it
 * survives a reload and agrees with the header's count.
 */
export function QuickAdd({
  product,
  locale,
  className,
}: {
  product: ProductSummary;
  locale: string;
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const { cart, add, updateQuantity } = useCart();
  const [picking, setPicking] = React.useState(false);

  /*
   * Out of stock renders nothing. The card already says so across the bottom of
   * its picture, and an Add button beside those words is a control whose only
   * possible outcome is a refusal.
   */
  if (!product.inStock) return null;

  /*
   * A picker for anything this button cannot complete on its own: a product with
   * options, and a product whose summary carries no variant id — which should
   * not happen, since even a simple product owns exactly one variant, but "add
   * nothing and say nothing" is the one behaviour a button must never have.
   */
  const needsPicker = product.hasVariants || !product.defaultVariantId;

  /*
   * What is in the basket for *this* product, across however many of its
   * variants are in there. The count is the total, because that is the question
   * the card is being asked: have I got this, and how much of it.
   *
   * Only a *single* line is stepped, and that is a limit rather than an
   * oversight — minus on a card standing for both a 1 kg line and a 250 g line
   * has no honest answer to which of the two it should take from. Two or more
   * lines keep the plus and its picker, so a size is always chosen where the
   * sizes are named, and the badge is what stops the card claiming the basket is
   * empty.
   */
  const lines = cart.lines.filter((line) => line.productId === product.id);
  const inBasket = lines.reduce((count, line) => count + line.quantity, 0);
  const line = lines.length === 1 ? lines[0] : null;

  // A product sold in threes reaches the basket as three, and leaves it at zero
  // rather than at one.
  const floor = Math.max(1, product.minOrderQuantity || 1);
  const ceiling = product.maxOrderQuantity ?? Number.MAX_SAFE_INTEGER;

  const onFirstAdd = () => {
    if (needsPicker) {
      setPicking(true);
      return;
    }

    add({
      productId: product.id,
      variantId: product.defaultVariantId!,
      slug: product.slug,
      name: product.name,
      variantTitle: null,
      imageUrl: product.primaryImage?.url ?? null,
      unitPrice: product.price,
      unitSalePrice: product.salePrice,
      currency: product.currency,
      quantity: floor,
      maxQuantity: product.maxOrderQuantity,
    });

    toast.success(t('{name} added to your cart', { name: product.name }), {
      action: { label: t('View cart'), onClick: () => router.push('/cart') },
    });
  };

  const step = (delta: number) => {
    if (!line) return;
    const next = line.quantity + delta;

    /*
     * Below the minimum the line is removed rather than clamped. The minimum is
     * sometimes more than one, so minus on a basket of three has to be able to
     * reach empty — clamping there would leave the shopper unable to take the
     * item back out from the card they added it on.
     */
    updateQuantity(line.id, next < floor ? 0 : Math.min(ceiling, next));
  };

  /*
   * Anchored bottom-right in either state, so the plus sits in the same place on
   * every card in the row and the stepper grows leftwards over the picture
   * instead of moving the control the shopper is aiming at.
   */
  const anchor = 'absolute bottom-2 right-2 z-20';

  return (
    <>
      {line ? (
        <div
          className={cn(
            anchor,
            'flex h-9 items-center rounded-full border border-border bg-surface shadow-[var(--shadow-card)]',
            className,
          )}
        >
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={
              line.quantity <= floor
                ? t('Remove {name} from cart', { name: product.name })
                : t('Less {name}', { name: product.name })
            }
            className="grid size-9 place-items-center rounded-full text-primary transition-transform active:scale-90"
          >
            <Minus className="size-4" aria-hidden />
          </button>

          {/*
            Announced, because the number changing is the whole confirmation —
            there is no toast on a step, and a screen reader would otherwise be
            told nothing at all happened.
          */}
          <span
            className="min-w-5 text-center text-sm font-semibold tabular-nums text-primary"
            aria-live="polite"
          >
            {t.number(line.quantity)}
            <span className="sr-only"> {t('{name} in your cart', { name: product.name })}</span>
          </span>

          <button
            type="button"
            onClick={() => step(1)}
            aria-label={t('More {name}', { name: product.name })}
            disabled={line.quantity >= ceiling}
            className="grid size-9 place-items-center rounded-full text-primary transition-transform active:scale-90 disabled:opacity-40"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onFirstAdd}
          aria-label={
            needsPicker
              ? t('Choose options for {name}', { name: product.name })
              : t('Add {name} to cart', { name: product.name })
          }
          className={cn(
            anchor,
            'grid size-9 place-items-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-card)] transition-transform hover:scale-105 active:scale-95',
            className,
          )}
        >
          <Plus className="size-4" aria-hidden />

          {inBasket > 0 ? (
            <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full border border-border bg-surface px-1 text-[10px] font-semibold leading-4 tabular-nums text-primary">
              {t.number(inBasket)}
              <span className="sr-only"> {t('in your cart')}</span>
            </span>
          ) : null}
        </button>
      )}

      {/*
        Mounted only while it is open. A Radix dialog per card would put a
        hundred portals on a listing page for the one a shopper may open.
      */}
      {picking ? (
        <QuickAddDialog product={product} locale={locale} onClose={() => setPicking(false)} />
      ) : null}
    </>
  );
}

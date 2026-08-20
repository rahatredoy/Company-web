'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ProductSummary } from '@/types';
import type { QuickAddOptions } from '@/app/api/products/[slug]/options/route';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { PriceDisplay } from '@/components/commerce/price-display';
import { StockStatus } from '@/components/product/stock-status';
import { VariantSelector, findVariant, initialSelection } from '@/components/product/variant-selector';
import { useCart } from '@/lib/commerce/cart';

/**
 * Choosing which one, without leaving the listing.
 *
 * The picker behind a card's Add button, for a product that comes in sizes — a
 * kilo, five hundred grams, a hundred — where "add this" is not yet an
 * instruction the basket can carry out.
 *
 * It renders `VariantSelector`, the same component the product page uses, so
 * the rules about which combinations exist and which are in stock are enforced
 * in exactly one place. A second, smaller implementation here is how a shopper
 * ends up being offered a weight on the listing that the product page then
 * refuses.
 *
 * Deliberately not the whole product page in a box. It shows the picture, the
 * name, the options, the price of what is currently selected and its stock —
 * and a link for everything else, because a shopper who wants the description
 * and the reviews wants the page rather than a scrolling panel over the one
 * they are on.
 */
export function QuickAddDialog({
  product,
  locale,
  onClose,
}: {
  product: ProductSummary;
  locale: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const { add } = useCart();

  const [data, setData] = React.useState<QuickAddOptions | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [selection, setSelection] = React.useState<Record<string, string>>({});
  const [quantity, setQuantity] = React.useState(1);

  /*
   * Fetched on mount and abandoned if the shopper closes the panel before it
   * arrives — which on a listing is a normal thing to do, and is the reason
   * this reads a route handler rather than calling a Server Action.
   */
  React.useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/products/${encodeURIComponent(product.slug)}/options`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as { data: QuickAddOptions };
      })
      .then((payload) => {
        setData(payload.data);
        setSelection(initialSelection(payload.data.variants, payload.data.defaultVariantId));
        setQuantity(Math.max(1, payload.data.minOrderQuantity || 1));
      })
      .catch((error: Error) => {
        if (error.name !== 'AbortError') setFailed(true);
      });

    return () => controller.abort();
  }, [product.slug]);

  const variant = data ? findVariant(data.variants, selection) : null;
  const price = variant?.price ?? product.price;
  const salePrice = variant?.salePrice ?? product.salePrice;
  const inStock = variant ? variant.inStock : product.inStock;

  const onAdd = () => {
    if (!data || !variant || !inStock) return;

    add({
      productId: data.id,
      variantId: variant.id,
      slug: data.slug,
      name: data.name,
      variantTitle: variant.title,
      imageUrl: variant.imageUrl ?? data.imageUrl,
      unitPrice: variant.price,
      unitSalePrice: variant.salePrice,
      currency: data.currency,
      quantity,
      maxQuantity: data.maxOrderQuantity,
    });

    onClose();
    toast.success(`${data.name} added to your cart`, {
      description: variant.title ?? undefined,
      action: { label: 'View cart', onClick: () => router.push('/cart') },
    });
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="pr-8 text-base">{product.name}</DialogTitle>
          <DialogDescription>Choose what you would like, then add it to your cart.</DialogDescription>
        </DialogHeader>

        {failed ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted">
              We could not load the options just now.
            </p>
            <Button asChild className="w-full">
              <Link href={`/product/${product.slug}`}>Open the product page</Link>
            </Button>
          </div>
        ) : !data ? (
          <div className="mt-6 flex items-center justify-center gap-2 py-8 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Loading options…
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            <div className="flex items-center gap-3">
              {data.imageUrl ? (
                <span className="relative size-16 shrink-0 overflow-hidden rounded-(--radius-card) bg-surface-alt">
                  <Image src={data.imageUrl} alt="" aria-hidden fill sizes="64px" className="object-cover" />
                </span>
              ) : null}

              <div className="min-w-0">
                <PriceDisplay price={price} salePrice={salePrice} currency={data.currency} locale={locale} />
                <StockStatus
                  inStock={inStock}
                  lowStock={variant?.lowStock}
                  remaining={variant?.remainingHint}
                  className="mt-1"
                />
              </div>
            </div>

            {data.options.length > 0 ? (
              <VariantSelector
                options={data.options}
                variants={data.variants}
                selection={selection}
                onChange={setSelection}
              />
            ) : null}

            <div className="flex items-center justify-between gap-3">
              <QuantityStepper
                value={quantity}
                onChange={setQuantity}
                min={Math.max(1, data.minOrderQuantity || 1)}
                max={data.maxOrderQuantity}
                size="sm"
              />
              <Link
                href={`/product/${product.slug}`}
                className="text-sm text-muted underline-offset-4 hover:text-primary hover:underline"
              >
                Full details
              </Link>
            </div>

            <Button className="w-full" onClick={onAdd} disabled={!variant || !inStock}>
              {/* A combination that does not exist is said plainly, rather than
                  being refused by a button that gives no reason. */}
              {!variant ? 'Not available in that combination' : inStock ? 'Add to cart' : 'Out of stock'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

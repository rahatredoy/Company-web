'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Plus, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import type { ProductSummary } from '@/types';
import { Button } from '@/components/ui/button';
import { CheckboxField } from '@/components/ui/checkbox';
import { useCart } from '@/lib/commerce/cart';
import { formatMoney, pluralise } from '@/lib/utils';
import { sum } from '@/lib/commerce/money';

/**
 * "Frequently bought together".
 *
 * Ticking items updates the total, and the total shown when everything is
 * selected is the **server's** bundle price — the browser never computes the
 * discount. A partial selection falls back to the plain sum of what is ticked,
 * because a bundle discount that applies to two of three items is a pricing rule
 * this side has no business inventing.
 */
export function FrequentlyBoughtTogether({
  items,
  bundlePrice,
  currency,
  locale,
}: {
  items: ProductSummary[];
  bundlePrice: string;
  currency: string;
  locale: string;
}) {
  const { add } = useCart();
  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(items.map((item) => item.id)),
  );

  if (items.length < 2) return null;

  const chosen = items.filter((item) => selected.has(item.id));
  const allSelected = chosen.length === items.length;

  const total = allSelected
    ? bundlePrice
    : sum(chosen.map((item) => item.salePrice ?? item.price));

  const listPrice = sum(chosen.map((item) => item.salePrice ?? item.price));
  const saving = allSelected ? sum([listPrice]) : null;

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addAll = () => {
    for (const item of chosen) {
      add({
        productId: item.id,
        // No variant chosen here — the default is used, which is why bundles
        // only ever offer products the server marked as bundle-safe.
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

    toast.success(`${chosen.length} ${pluralise(chosen.length, 'item')} added to your cart`);
  };

  return (
    <div className="rounded-(--radius-card) border border-border bg-surface p-5 sm:p-6">
      <h2 className="text-lg font-semibold">Frequently bought together</h2>

      <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-start">
        <ul className="flex flex-wrap items-center gap-3">
          {items.map((item, index) => (
            <li key={item.id} className="flex items-center gap-3">
              {index > 0 ? (
                <Plus className="size-4 shrink-0 text-subtle" aria-hidden />
              ) : null}
              <Link
                href={`/product/${item.slug}`}
                className="relative block size-20 overflow-hidden rounded-(--radius-button) bg-surface-alt sm:size-24"
              >
                {item.primaryImage ? (
                  <Image
                    src={item.primaryImage.url}
                    alt={item.primaryImage.altText ?? item.name}
                    fill
                    sizes="96px"
                    className="object-cover"
                  />
                ) : null}
              </Link>
            </li>
          ))}
        </ul>

        <div className="min-w-0 flex-1">
          <ul className="space-y-1">
            {items.map((item, index) => (
              <li key={item.id}>
                <CheckboxField
                  id={`fbt-${item.id}`}
                  checked={selected.has(item.id)}
                  onCheckedChange={() => toggle(item.id)}
                  label={
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className={index === 0 ? 'font-medium' : undefined}>
                        {index === 0 ? 'This item: ' : ''}
                        {item.name}
                      </span>
                      <span className="text-sm font-semibold">
                        {formatMoney(item.salePrice ?? item.price, item.currency, locale)}
                      </span>
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        </div>

        <div className="shrink-0 lg:w-56 lg:border-l lg:border-border lg:pl-6">
          <p className="text-sm text-muted">
            Total for {chosen.length} {pluralise(chosen.length, 'item')}
          </p>
          <p className="mt-1 text-2xl font-bold tabular-nums">
            {formatMoney(total, currency, locale)}
          </p>

          {allSelected && saving ? (
            <p className="mt-1 text-xs text-success">Bundle price — saves you money on the set</p>
          ) : null}

          <Button onClick={addAll} disabled={chosen.length === 0} className="mt-4 w-full">
            <ShoppingCart aria-hidden />
            Add selected to cart
          </Button>
        </div>
      </div>
    </div>
  );
}

import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import type { CollectionBlock, ProductSummary } from '@/types';
import type { TemplatePreset } from '@/templates/meta';
import type { ProductCardVariant } from '@/components/commerce/product-card';
import { ProductCarousel } from './product-carousel';

/**
 * A named collection: its cover and blurb beside the products in it.
 *
 * The distinction from a product carousel pointed at the same ids is the panel
 * on the left. A collection is something the store *named* — "Summer Essentials",
 * with a line about what it is for — and that framing is the whole reason to
 * group the products rather than list them. Drop the panel and this becomes a
 * second, worse product rail.
 *
 * The cover is optional and the panel survives without it, because a store that
 * has written a good blurb should not need a photographer before it can use the
 * block.
 */
export function CollectionShowcase({
  collection,
  products,
  href,
  perView,
  cardVariant,
  locale,
  ctaLabel,
}: {
  collection: CollectionBlock;
  products: ProductSummary[];
  href: string;
  perView: TemplatePreset['carouselPerView'];
  cardVariant: ProductCardVariant;
  locale: string;
  ctaLabel: string;
}) {
  if (products.length === 0) return null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.55fr)_minmax(0,2fr)] lg:items-stretch">
      <div className="relative flex min-h-56 flex-col justify-end overflow-hidden rounded-(--radius-card) bg-surface-alt p-6 sm:p-7">
        {collection.imageUrl ? (
          <>
            <Image
              src={collection.imageUrl}
              alt=""
              aria-hidden
              fill
              sizes="(min-width: 1024px) 30vw, 100vw"
              className="object-cover"
            />
            {/* The panel carries text over the photograph, so it needs its own
                ground rather than relying on the image being dark enough. */}
            <span aria-hidden className="absolute inset-0 bg-linear-to-t from-black/75 via-black/45 to-black/15" />
          </>
        ) : null}

        <div className={collection.imageUrl ? 'relative text-white' : 'relative'}>
          <h2 className="text-2xl font-semibold leading-tight sm:text-3xl">{collection.name}</h2>
          {collection.description ? (
            <p className={collection.imageUrl ? 'mt-2 text-sm text-white/85' : 'mt-2 text-sm text-muted'}>
              {collection.description}
            </p>
          ) : null}

          <Link
            href={href}
            className={
              collection.imageUrl
                ? 'mt-5 inline-flex w-fit items-center gap-2 rounded-(--radius-button) bg-surface px-5 py-2.5 text-sm font-medium text-foreground transition-opacity hover:opacity-90'
                : 'mt-5 inline-flex w-fit items-center gap-2 rounded-(--radius-button) border border-border-strong bg-surface px-5 py-2.5 text-sm font-medium transition-colors hover:border-primary hover:text-primary'
            }
          >
            {ctaLabel}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
      </div>

      <ProductCarousel
        products={products}
        perView={{ ...perView, lg: Math.max(perView.lg - 2, 2), xl: Math.max(perView.xl - 2, 3) }}
        cardVariant={cardVariant}
        locale={locale}
        label={collection.name}
      />
    </div>
  );
}

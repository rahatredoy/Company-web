import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PAGE_SIZE } from '@/config';
import { getStoreConfig, getPublishedStoreConfig } from '@/lib/api/store';
import {
  getFrequentlyBoughtTogether,
  getProductDetail,
  getProductReviews,
  getRelatedProducts,
} from '@/lib/api/product';
import { getProductList } from '@/lib/api/products';
import { getTemplate } from '@/templates/registry';
import { readLocalePreference } from '@/lib/locale/preference';
import { getT } from '@/lib/i18n/server';
import { BreadcrumbJsonLd, type Crumb } from '@/components/layout/breadcrumbs';
import { ProductPurchase } from '@/components/product/product-purchase';
import { ProductDetailsTabs } from '@/components/product/product-details-tabs';
import { FrequentlyBoughtTogether } from '@/components/product/frequently-bought-together';
import { ReviewList, ReviewSummaryPanel } from '@/components/product/reviews';
import { ProductRail } from '@/components/commerce/product-rail';
import { SectionHeading } from '@/components/sections/section-shell';
import { CatalogFeed } from '@/components/sections/catalog-feed';

/**
 * Product detail.
 *
 * Every `ProductCard` in the app has linked here since the day it was written,
 * and until now the destination did not exist — so the most-clicked link on the
 * storefront was a 404.
 *
 * Mostly a Server Component. Only the buying panel, the tabs, the bundle picker
 * and the review form are client islands; the description, specifications,
 * reviews and related rails are server-rendered and therefore indexable.
 */

interface PageProps {
  params: Promise<{ slug: string }>;
}

/**
 * The description as plain text on one line. It is stored as HTML, and a meta
 * tag or a JSON-LD string printing `<p>` is worse than printing nothing.
 */
function plainDescription(description: string | null): string | undefined {
  const text = description
    ?.replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text || undefined;
}

/**
 * The opening of the description, cut at a word near 160 characters — the
 * length a search result shows.
 *
 * What a product page is described as when the owner wrote no SEO description.
 * It used to be the short description, which no longer exists; the store-wide
 * description would describe every product in the shop with the same sentence.
 */
function descriptionExcerpt(description: string | null, limit = 160): string | undefined {
  const flat = plainDescription(description);
  if (!flat) return undefined;
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit - 1);
  const atWord = cut.lastIndexOf(' ');
  return `${(atWord > limit / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const [product, config] = await Promise.all([getProductDetail(slug), getPublishedStoreConfig()]);

  if (!product) {
    const t = await getT();
    return { title: t('Product not found'), robots: { index: false, follow: true } };
  }

  const title = product.seo.title ?? product.name;
  const description =
    product.seo.description ?? descriptionExcerpt(product.description) ?? config.seo.description ?? undefined;

  return {
    title,
    description,
    // Canonical uses the store's published origin, never a preview or a
    // currency-qualified URL, so the same product is not indexed several times.
    alternates: { canonical: `${config.store.canonicalOrigin}/product/${product.slug}` },
    openGraph: {
      type: 'website',
      title,
      description,
      url: `${config.store.canonicalOrigin}/product/${product.slug}`,
      ...(product.images[0] ? { images: [product.images[0].url] } : {}),
    },
  };
}

/** How many products the aisle rail carries before "view all" is the answer. */
const AISLE_RAIL_SIZE = 12;

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params;

  const [product, config, t] = await Promise.all([getProductDetail(slug), getStoreConfig(), getT()]);
  if (!product) notFound();

  /*
   * The aisle this product is in, and the department that aisle belongs to.
   *
   * `breadcrumb` is categories only — it ends with the product's own category
   * and the page appends the product's name to it separately — so the entry
   * before the last is the parent. A product filed directly under a top-level
   * category has no aisle above it, and gets the department grid alone rather
   * than a rail and a grid drawn from the same set under two headings.
   */
  const aisle = product.category;
  const department = product.breadcrumb.length > 1 ? (product.breadcrumb.at(-2) ?? null) : null;
  const browse = department ?? aisle;

  const [locale, template, related, bundle, reviews, aisleBatch, browseBatch] = await Promise.all([
    readLocalePreference(config),
    getTemplate(config.design.templateKey),
    getRelatedProducts(product.id, 12),
    getFrequentlyBoughtTogether(product.id),
    getProductReviews(slug),
    // One over the rail's width, because the product being read is filtered out
    // of its own aisle below and would otherwise cost the rail a card.
    department && aisle
      ? getProductList({
          category: aisle.slug,
          page: 1,
          pageSize: AISLE_RAIL_SIZE + 1,
          sort: 'best_selling',
        })
      : null,
    browse
      ? getProductList({ category: browse.slug, page: 1, pageSize: PAGE_SIZE.home, sort: 'newest' })
      : null,
  ]);

  /*
   * Nothing below is allowed to show the same card twice.
   *
   * The three blocks narrow outwards — this aisle, then what else suits, then
   * the whole department — and each one is drawn from a set that contains the
   * one above it, so without this the department grid would open on the twelve
   * products the visitor had just scrolled past. Everything already on screen
   * is therefore carried down as an exclusion; the grid pages its listing
   * unchanged and hides them, which is what keeps its "load more" honest.
   */
  const aisleProducts = (aisleBatch?.items ?? [])
    .filter((item) => item.id !== product.id)
    .slice(0, AISLE_RAIL_SIZE);

  const aisleIds = new Set(aisleProducts.map((item) => item.id));
  const relatedProducts = related.filter(
    (item) => item.id !== product.id && !aisleIds.has(item.id),
  );

  const browseExclude = [product.id, ...aisleIds, ...relatedProducts.map((item) => item.id)];
  const browseHidden = new Set(browseExclude);
  // Rendered on what survives rather than on the batch: a heading over a grid
  // whose whole first page was already shown above is a promise of nothing.
  const browseVisible = (browseBatch?.items ?? []).filter((item) => !browseHidden.has(item.id));

  const crumbs: Crumb[] = [
    ...product.breadcrumb.map((entry) => ({ label: entry.name, href: `/category/${entry.slug}` })),
    { label: product.name },
  ];

  return (
    <div className="container-store py-4 sm:py-6">
      {/*
        Crawlers still get the trail; the page no longer prints it. The same
        three category names are on the way in and in the header, and spending
        the first line of a product page on them delayed the picture and the
        price — which is the whole of what somebody opened this to see.
      */}
      <BreadcrumbJsonLd items={crumbs} origin={config.store.canonicalOrigin} />
      <ProductJsonLd
        product={product}
        origin={config.store.canonicalOrigin}
        storeName={config.store.name}
      />

      <ProductPurchase product={product} locale={locale.language} />

      <div className="mt-12 sm:mt-16">
        <ProductDetailsTabs product={product} />
      </div>

      {bundle ? (
        <div className="mt-12">
          <FrequentlyBoughtTogether
            items={bundle.items}
            bundlePrice={bundle.bundlePrice}
            currency={bundle.currency}
            locale={locale.language}
          />
        </div>
      ) : null}

      {reviews ? (
        <section id="reviews" className="mt-14 scroll-mt-24">
          <h2 className="text-xl font-semibold sm:text-2xl">{t('Customer reviews')}</h2>

          <ReviewSummaryPanel summary={reviews.summary} productSlug={slug} className="mt-4" />
          <ReviewList reviews={reviews.items} locale={locale.language} className="mt-2" />
        </section>
      ) : null}

      {/* The aisle first, because it is the shelf this product was taken off:
          a shopper comparing phones wants the other phones before they want
          anything the catalogue thinks is adjacent to them. */}
      {aisle && aisleProducts.length > 0 ? (
        <ProductRail
          title={t('More in {name}', { name: aisle.name })}
          products={aisleProducts}
          perView={template.preset.carouselPerView}
          cardVariant={template.cardVariant}
          locale={locale.language}
          action={{ label: t('View all'), href: `/category/${aisle.slug}` }}
          className="mt-16"
        />
      ) : null}

      {/* Same category first, then same brand — so once the aisle above has
          taken its share this is what is left, which is the cross-aisle half
          it was always the only source of. It hides itself when that is
          nothing, rather than repeating the rail under a vaguer heading. */}
      <ProductRail
        title={t('You may also like')}
        products={relatedProducts}
        perView={template.preset.carouselPerView}
        cardVariant={template.cardVariant}
        locale={locale.language}
        action={
          aisleProducts.length === 0 && product.category
            ? {
                label: t('All {name}', { name: product.category.name }),
                href: `/category/${product.category.slug}`,
              }
            : undefined
        }
        className="mt-16"
      />

      {/*
        The rest of the department, a page at a time.
        
        A grid rather than a third rail: the two rails above are previews of a
        shelf, and this is the shelf — a shopper who has read to the bottom of a
        product page without buying it is browsing, and the answer to browsing is
        breadth on screen at once rather than another row to drag sideways. It
        pages the ordinary listing through the same Server Action the homepage
        feed uses, so the block costs this page one extra read and the rest only
        when it is asked for.
      */}
      {browse && browseBatch && browseVisible.length > 0 ? (
        <section className="mt-16" aria-label={t('More from {name}', { name: browse.name })}>
          <SectionHeading
            title={t('More from {name}', { name: browse.name })}
            size="sm"
            action={{ label: t('Shop all'), href: `/category/${browse.slug}` }}
          />
          {/* Keyed on the batch for the reason the homepage feed is: when the
              first page has moved on, the pages appended below it belong to a
              list that no longer exists, and remounting is the whole reset. */}
          <CatalogFeed
            key={`${browse.slug}:${browseBatch.meta.total}:${browseBatch.items[0]?.id ?? ''}`}
            initial={browseBatch.items}
            total={browseBatch.meta.total}
            sort="newest"
            category={browse.slug}
            exclude={browseExclude}
            cardVariant={template.cardVariant}
            gridClassName={template.gridClassName}
            locale={locale.language}
          />
        </section>
      ) : null}
    </div>
  );
}

/**
 * Product structured data.
 *
 * `availability` and `price` come from the same fields the page renders, so the
 * rich result cannot advertise a price the page does not show — which is both a
 * search-engine policy violation and a promise to a customer.
 */
function ProductJsonLd({
  product,
  origin,
  storeName,
}: {
  product: Awaited<ReturnType<typeof getProductDetail>> & object;
  origin: string;
  storeName: string;
}) {
  const price = product.salePrice ?? product.price;

  const json = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: plainDescription(product.description),
    image: product.images.map((image) => image.url),
    sku: product.variants[0]?.sku ?? undefined,
    brand: product.brand ? { '@type': 'Brand', name: product.brand.name } : undefined,
    offers: {
      '@type': 'Offer',
      url: `${origin}/product/${product.slug}`,
      priceCurrency: product.currency,
      price,
      availability: product.inStock
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      seller: { '@type': 'Organization', name: storeName },
    },
    ...(product.ratingCount > 0
      ? {
          aggregateRating: {
            '@type': 'AggregateRating',
            ratingValue: product.ratingAverage,
            reviewCount: product.ratingCount,
          },
        }
      : {}),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json).replace(/</g, '\\u003c') }}
    />
  );
}

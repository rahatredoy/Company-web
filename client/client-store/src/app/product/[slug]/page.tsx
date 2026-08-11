import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getStoreConfig, getPublishedStoreConfig } from '@/lib/api/store';
import {
  getFrequentlyBoughtTogether,
  getProductDetail,
  getProductReviews,
  getRelatedProducts,
} from '@/lib/api/product';
import { getTemplate } from '@/templates/registry';
import { readLocalePreference } from '@/lib/locale/preference';
import { Breadcrumbs, BreadcrumbJsonLd, type Crumb } from '@/components/layout/breadcrumbs';
import { ProductPurchase } from '@/components/product/product-purchase';
import { ProductDetailsTabs } from '@/components/product/product-details-tabs';
import { FrequentlyBoughtTogether } from '@/components/product/frequently-bought-together';
import { ReviewList, ReviewSummaryPanel } from '@/components/product/reviews';
import { ProductRail } from '@/components/commerce/product-rail';

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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const [product, config] = await Promise.all([getProductDetail(slug), getPublishedStoreConfig()]);

  if (!product) return { title: 'Product not found', robots: { index: false, follow: true } };

  const title = product.seo.title ?? product.name;
  const description =
    product.seo.description ?? product.shortDescription ?? config.seo.description ?? undefined;

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

export default async function ProductPage({ params }: PageProps) {
  const { slug } = await params;

  const [product, config] = await Promise.all([getProductDetail(slug), getStoreConfig()]);
  if (!product) notFound();

  const [locale, template, related, bundle, reviews] = await Promise.all([
    readLocalePreference(config),
    getTemplate(config.design.templateKey),
    getRelatedProducts(product.id, 12),
    getFrequentlyBoughtTogether(product.id),
    getProductReviews(slug),
  ]);

  const crumbs: Crumb[] = [
    ...product.breadcrumb.map((entry) => ({ label: entry.name, href: `/category/${entry.slug}` })),
    { label: product.name },
  ];

  return (
    <div className="container-store py-4 sm:py-6">
      <Breadcrumbs items={crumbs} className="mb-6" />
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
          <h2 className="text-xl font-semibold sm:text-2xl">Customer reviews</h2>

          <div className="mt-6 grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-12">
            <ReviewSummaryPanel summary={reviews.summary} productSlug={slug} />
            <ReviewList reviews={reviews.items} locale={locale.language} />
          </div>
        </section>
      ) : null}

      <ProductRail
        title="You may also like"
        products={related}
        perView={template.preset.carouselPerView}
        cardVariant={template.cardVariant}
        locale={locale.language}
        action={
          product.category
            ? { label: `All ${product.category.name}`, href: `/category/${product.category.slug}` }
            : undefined
        }
        className="mt-16"
      />
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
    description: product.shortDescription ?? undefined,
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

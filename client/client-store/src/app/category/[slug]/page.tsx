import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Category } from '@/types';
import { getStoreConfig } from '@/lib/api/store';
import { getProductList, parseProductQuery } from '@/lib/api/products';
import { getTemplate } from '@/templates/registry';
import { ProductListing } from '@/components/catalog/product-listing';
import { apiFetch, isStoreNotFound } from '@/lib/api/client';
import { cookieHeader, storeCall } from '@/lib/tenant';
import { getT } from '@/lib/i18n/server';

async function getCategory(slug: string): Promise<Category | null> {

  try {
    return await apiFetch<Category>(`/api/v1/storefront/categories/${encodeURIComponent(slug)}`, {
      ...(await storeCall()),
      cookieHeader: await cookieHeader(),
      revalidate: 300,
      tags: ['categories'],
    });
  } catch (error) {
    if (isStoreNotFound(error)) throw error;
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) return { title: (await getT())('Category not found') };

  return {
    title: category.seo.title ?? category.name,
    description: category.seo.description ?? undefined,
    alternates: { canonical: `/category/${category.slug}` },
    openGraph: {
      title: category.seo.title ?? category.name,
      description: category.seo.description ?? undefined,
      ...(category.imageUrl ? { images: [category.imageUrl] } : {}),
    },
  };
}

export default async function CategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);

  const category = await getCategory(slug);
  if (!category) notFound();

  /*
   * Every filter on this page is the sidebar's, `sub` included.
   *
   * It used to be clamped to one value here, because the subcategory chips above
   * the grid were a single choice — "an aisle is a place you are in". The
   * Category group in the filter panel replaced those chips, and a checkbox list
   * with counts is genuinely multi-select: a shopper narrowing Electronics to
   * Phones *and* Laptops is asking one question, not two. `parseProductQuery`
   * validates the values and the API resolves each one to its own subtree, so a
   * hand-edited URL still cannot ask for more than the panel could.
   */
  const query = parseProductQuery(search, { category: slug });

  const [config, result, t] = await Promise.all([getStoreConfig(), getProductList(query), getT()]);
  const template = await getTemplate(config.design.templateKey);

  /*
   * The trail feeds the structured data below and nothing else — the visible
   * one is gone from every page on the storefront, and the header's back
   * button is what replaced it.
   *
   * `category.breadcrumb` already ends with this category, so appending the
   * name again produced "Home / Electronics / Electronics" — and still would,
   * in the `BreadcrumbList` handed to crawlers, which is the half that
   * survives. The last entry is the page you are on, so it gets no link.
   */
  const trail: { name: string; href?: string }[] = category.breadcrumb.length
    ? category.breadcrumb.map((crumb, index) => ({
        name: crumb.name,
        ...(index < category.breadcrumb.length - 1 ? { href: `/category/${crumb.slug}` } : {}),
      }))
    : [{ name: category.name }];

  /** Only factual data goes into structured data — no invented ratings. */
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: t('Home'), item: config.store.canonicalOrigin },
      ...trail.map((crumb, index) => ({
        '@type': 'ListItem',
        position: index + 2,
        name: crumb.name,
        ...(crumb.href ? { item: `${config.store.canonicalOrigin}${crumb.href}` } : {}),
      })),
    ],
  };

  return (
    <div className="container-store py-6">
      <script
        type="application/ld+json"
         
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      {/*
        The name is in the document, not on the screen.

        A page reached by clicking "Electronics" does not need "Home /
        Electronics" and then "Electronics" printed across the top of it — that
        is two lines and eighty pixels spent telling the visitor where they
        just chose to go, above the products they came for. Getting back out is
        the header's back button now. The heading stays in the markup because
        removing it would leave the page with no h1 at all, which breaks the
        outline a screen reader navigates by and is what a search result shows.
      */}
      <h1 className="sr-only">{category.name}</h1>

      <div className="mt-6">
        <ProductListing
          result={result}
          query={query}
          sort={query.sort ?? 'relevance'}
          cardVariant={template.cardVariant}
          gridClassName={template.gridClassName}
          locale={config.store.language}
          currency={config.store.currency}
          emptyTitle={t('Nothing in {name} matches those filters', { name: category.name })}
        />
      </div>
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { X } from 'lucide-react';
import { isMockData } from '@/config';
import type { Category } from '@/types';
import { getStoreConfig } from '@/lib/api/store';
import { getProductList, parseProductQuery } from '@/lib/api/products';
import { getTemplate } from '@/templates/registry';
import { Breadcrumb, ProductListing } from '@/components/catalog/product-listing';
import { apiFetch, isStoreNotFound } from '@/lib/api/client';
import { cookieHeader, storeCall } from '@/lib/tenant';
import { cn } from '@/lib/utils';

async function getCategory(slug: string): Promise<Category | null> {
  if (isMockData) {
    const { mockCategoryBySlug } = await import('@/lib/api/mock/products');
    return mockCategoryBySlug(slug);
  }

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
  if (!category) return { title: 'Category not found' };

  return {
    title: category.seo.title ?? category.name,
    description: category.seo.description ?? category.description ?? undefined,
    alternates: { canonical: `/category/${category.slug}` },
    openGraph: {
      title: category.seo.title ?? category.name,
      description: category.seo.description ?? category.description ?? undefined,
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

  const query = parseProductQuery(search, { category: slug });
  const [config, result] = await Promise.all([getStoreConfig(), getProductList(query)]);
  const template = await getTemplate(config.design.templateKey);

  /**
   * A child chip narrows this page; it does not navigate to the child's own
   * page. Everything the visitor is reading — the heading, the other chips, the
   * brand list they are half way down — has to survive the click, so the only
   * thing that changes is `sub`. It stays a real link rather than a button, so
   * a narrowed listing is still shareable, crawlable and back-button-friendly,
   * exactly like the sidebar filters.
   */
  const selectedSubs = query.subcategories ?? [];
  const subHref = (childSlug: string) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      // `page` goes because page 7 of a narrower result set is usually empty.
      if (key === 'sub' || key === 'page') continue;
      if (Array.isArray(value)) value.forEach((entry) => next.append(key, entry));
      else if (value !== undefined) next.set(key, value);
    }

    const after = selectedSubs.includes(childSlug)
      ? selectedSubs.filter((entry) => entry !== childSlug)
      : [...selectedSubs, childSlug];
    after.forEach((entry) => next.append('sub', entry));

    const queryString = next.toString();
    return queryString ? `/category/${category.slug}?${queryString}` : `/category/${category.slug}`;
  };

  const trail: { name: string; href?: string }[] = [
    ...category.breadcrumb.map((crumb) => ({ name: crumb.name, href: `/category/${crumb.slug}` })),
    { name: category.name },
  ];

  /** Only factual data goes into structured data — no invented ratings. */
  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: config.store.canonicalOrigin },
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

      <Breadcrumb trail={trail} />

      <h1 className="text-2xl font-semibold sm:text-3xl">{category.name}</h1>
      {category.description ? (
        <p className="mt-2 max-w-2xl text-sm text-muted">{category.description}</p>
      ) : null}

      {category.children.length > 0 ? (
        <ul aria-label={`Narrow ${category.name}`} className="mt-5 flex flex-wrap gap-2">
          {category.children.map((child) => {
            const selected = selectedSubs.includes(child.slug);

            return (
              <li key={child.id}>
                <Link
                  href={subHref(child.slug)}
                  // The chips sit above the grid, so re-rendering in place beats
                  // throwing the visitor back to the top of the page.
                  scroll={false}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-(--radius-pill) border px-4 py-2 text-sm transition-colors',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-surface hover:border-primary hover:text-primary',
                  )}
                >
                  {child.name}
                  {selected ? (
                    <>
                      <X className="size-3.5" aria-hidden />
                      <span className="sr-only">(selected — activate to remove)</span>
                    </>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="mt-8">
        <ProductListing
          result={result}
          sort={query.sort ?? 'relevance'}
          cardVariant={template.cardVariant}
          gridClassName={template.gridClassName}
          locale={config.store.language}
          emptyTitle={`Nothing in ${category.name} matches those filters`}
        />
      </div>
    </div>
  );
}

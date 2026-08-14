import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import type { Brand } from '@/types';
import { getStoreConfig } from '@/lib/api/store';
import { getProductList, parseProductQuery } from '@/lib/api/products';
import { getTemplate } from '@/templates/registry';
import { Breadcrumb, ProductListing } from '@/components/catalog/product-listing';
import { apiFetch, isStoreNotFound } from '@/lib/api/client';
import { cookieHeader, storeCall } from '@/lib/tenant';

async function getBrand(slug: string): Promise<Brand | null> {
  try {
    return await apiFetch<Brand>(`/api/v1/storefront/brands/${encodeURIComponent(slug)}`, {
      ...(await storeCall()),
      cookieHeader: await cookieHeader(),
      revalidate: 300,
      tags: ['brands'],
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
  const brand = await getBrand(slug);
  if (!brand) return { title: 'Brand not found' };

  return {
    title: brand.seo.title ?? brand.name,
    description: brand.seo.description ?? brand.description ?? undefined,
    alternates: { canonical: `/brand/${brand.slug}` },
  };
}

export default async function BrandPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slug }, search] = await Promise.all([params, searchParams]);

  const brand = await getBrand(slug);
  if (!brand) notFound();

  const query = parseProductQuery(search, { brand: [slug] });
  const [config, result] = await Promise.all([getStoreConfig(), getProductList(query)]);
  const template = await getTemplate(config.design.templateKey);

  return (
    <div className="container-store py-6">
      <Breadcrumb trail={[{ name: 'Brands', href: '/brands' }, { name: brand.name }]} />

      <div className="mb-8 flex flex-wrap items-center gap-5 rounded-(--radius-card) border border-border bg-surface p-6">
        {brand.logoUrl ? (
          <Image
            src={brand.logoUrl}
            alt={brand.name}
            width={120}
            height={48}
            className="h-12 w-auto object-contain"
          />
        ) : null}
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">{brand.name}</h1>
          {brand.description ? (
            <p className="mt-2 max-w-2xl text-sm text-muted">{brand.description}</p>
          ) : null}
        </div>
      </div>

      <ProductListing
        result={result}
        sort={query.sort ?? 'relevance'}
        cardVariant={template.cardVariant}
        gridClassName={template.gridClassName}
        locale={config.store.language}
        emptyTitle={`No ${brand.name} products match those filters`}
      />
    </div>
  );
}

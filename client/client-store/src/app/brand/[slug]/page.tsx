import type { Metadata } from 'next';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import type { Brand } from '@/types';
import { getStoreConfig } from '@/lib/api/store';
import { getProductList, parseProductQuery } from '@/lib/api/products';
import { getTemplate } from '@/templates/registry';
import { ProductListing } from '@/components/catalog/product-listing';
import { apiFetch, isStoreNotFound } from '@/lib/api/client';
import { cookieHeader, storeCall } from '@/lib/tenant';
import { getT } from '@/lib/i18n/server';

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
  if (!brand) return { title: (await getT())('Brand not found') };

  return {
    title: brand.name,
    description: brand.description ?? undefined,
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
  const [config, result, t] = await Promise.all([getStoreConfig(), getProductList(query), getT()]);
  const template = await getTemplate(config.design.templateKey);

  return (
    <div className="container-store py-6">
      <h1 className="sr-only">{brand.name}</h1>

      {/*
        The brand's own mark and its own words, with nothing framing them.

        A bordered panel wrapping a name the visitor clicked to get here is
        chrome, and it pushed the products the better part of a card's height
        down the page. A brand that has supplied neither a logo nor a
        description now gets no block at all, rather than an empty one.
      */}
      {brand.logoUrl || brand.description ? (
        <div className="mb-5 flex flex-wrap items-center gap-4">
          {brand.logoUrl ? (
            <Image
              src={brand.logoUrl}
              alt={brand.name}
              width={120}
              height={40}
              className="h-10 w-auto object-contain"
            />
          ) : null}
          {brand.description ? (
            <p className="max-w-2xl text-sm text-muted">{brand.description}</p>
          ) : null}
        </div>
      ) : null}

      <ProductListing
        result={result}
        query={query}
        sort={query.sort ?? 'relevance'}
        cardVariant={template.cardVariant}
        gridClassName={template.gridClassName}
        locale={config.store.language}
        currency={config.store.currency}
        emptyTitle={t('No {name} products match those filters', { name: brand.name })}
      />
    </div>
  );
}

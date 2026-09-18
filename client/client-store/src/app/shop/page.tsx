import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { getProductList, parseProductQuery } from '@/lib/api/products';
import { getTemplate } from '@/templates/registry';
import { ProductListing } from '@/components/catalog/product-listing';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const [config, t] = await Promise.all([getStoreConfig(), getT()]);
  return {
    title: t('Shop'),
    description: t('Browse every product available at {store}.', { store: config.store.name }),
    alternates: { canonical: '/shop' },
  };
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = parseProductQuery(params);

  const [config, result, t] = await Promise.all([getStoreConfig(), getProductList(query), getT()]);
  const template = await getTemplate(config.design.templateKey);

  const heading = query.sale ? t('Sale') : query.sort === 'newest' ? t('New Arrivals') : t('All Products');

  return (
    <div className="container-store py-6">
      {/* In the document for the heading outline, off the screen because the
          grid underneath is the whole page and already says so. */}
      <h1 className="sr-only">{heading}</h1>

      <ProductListing
        result={result}
        query={query}
        sort={query.sort ?? 'relevance'}
        cardVariant={template.cardVariant}
        gridClassName={template.gridClassName}
        locale={config.store.language}
        currency={config.store.currency}
      />
    </div>
  );
}

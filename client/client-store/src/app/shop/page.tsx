import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { getProductList, parseProductQuery } from '@/lib/api/products';
import { getTemplate } from '@/templates/registry';
import { Breadcrumb, ProductListing } from '@/components/catalog/product-listing';

export async function generateMetadata(): Promise<Metadata> {
  const config = await getStoreConfig();
  return {
    title: 'Shop',
    description: `Browse every product available at ${config.store.name}.`,
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

  const [config, result] = await Promise.all([getStoreConfig(), getProductList(query)]);
  const template = await getTemplate(config.design.templateKey);

  const heading = query.sale ? 'Sale' : query.sort === 'newest' ? 'New Arrivals' : 'All Products';

  return (
    <div className="container-store py-6">
      <Breadcrumb trail={[{ name: heading }]} />
      <h1 className="mb-6 text-2xl font-semibold sm:text-3xl">{heading}</h1>

      <ProductListing
        result={result}
        sort={query.sort ?? 'relevance'}
        cardVariant={template.cardVariant}
        gridClassName={template.gridClassName}
        locale={config.store.language}
      />
    </div>
  );
}

import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { getProductList, parseProductQuery } from '@/lib/api/products';
import { getTemplate } from '@/templates/registry';
import { Breadcrumb, ProductListing } from '@/components/catalog/product-listing';

export const metadata: Metadata = {
  title: 'Search',
  // Search result pages are thin, duplicative content — keep them out of the index.
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = parseProductQuery(params);

  const [config, result] = await Promise.all([getStoreConfig(), getProductList(query)]);
  const template = await getTemplate(config.design.templateKey);

  return (
    <div className="container-store py-6">
      <Breadcrumb trail={[{ name: 'Search' }]} />

      <h1 className="mb-1 text-2xl font-semibold sm:text-3xl">
        {query.q ? <>Results for “{query.q}”</> : 'Search'}
      </h1>
      <p className="mb-6 text-sm text-muted">
        {query.q ? `${result.meta.total} matching products` : 'Enter a product, brand or category above.'}
      </p>

      <ProductListing
        result={result}
        sort={query.sort ?? 'relevance'}
        cardVariant={template.cardVariant}
        gridClassName={template.gridClassName}
        locale={config.store.language}
        emptyTitle="No products matched that search"
        emptyBody="Check the spelling, try a shorter or more general word, or browse a category instead."
      />
    </div>
  );
}

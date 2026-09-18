import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { getProductList, parseProductQuery } from '@/lib/api/products';
import { getTemplate } from '@/templates/registry';
import { ProductListing } from '@/components/catalog/product-listing';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Search'),
    // Search result pages are thin, duplicative content — keep them out of the index.
    robots: { index: false, follow: true },
  };
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = parseProductQuery(params);

  const [config, result, t] = await Promise.all([getStoreConfig(), getProductList(query), getT()]);
  const template = await getTemplate(config.design.templateKey);

  return (
    <div className="container-store py-6">
      {/*
        Both lines said something the page says better on its own: the search
        box in the header still holds the term, and the listing counts its own
        results a few pixels below. Only the prompt for an empty search says
        anything new, so only that is still drawn.
      */}
      <h1 className="sr-only">{query.q ? t('Results for “{term}”', { term: query.q }) : t('Search')}</h1>
      {query.q ? null : (
        <p className="mb-6 text-sm text-muted">{t('Enter a product, brand or category above.')}</p>
      )}

      <ProductListing
        result={result}
        query={query}
        sort={query.sort ?? 'relevance'}
        cardVariant={template.cardVariant}
        gridClassName={template.gridClassName}
        locale={config.store.language}
        currency={config.store.currency}
        emptyTitle={t('No products matched that search')}
        emptyBody={t('Check the spelling, try a shorter or more general word, or browse a category instead.')}
      />
    </div>
  );
}

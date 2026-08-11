import { getStoreConfig } from '@/lib/api/store';
import { getProductList, parseProductQuery, type ProductQuery } from '@/lib/api/products';
import { getTemplate } from '@/templates/registry';
import { readLocalePreference } from '@/lib/locale/preference';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { ProductListing } from '@/components/catalog/product-listing';

/**
 * The shared body of every curated listing: New Arrivals, Best Sellers, Sale,
 * Featured, and the shop itself.
 *
 * They differ only in a heading, an intro line and which filter is pre-applied,
 * so they share this rather than five near-identical page files — which is how
 * one of them ends up not honouring a sort parameter.
 *
 * The pre-applied filter is passed as `defaults`, and `parseProductQuery` lets
 * the visitor's own parameters layer on top: someone can still sort the sale by
 * price, or narrow it to one brand.
 */
export async function CollectionPage({
  title,
  intro,
  defaults,
  searchParams,
  hero,
  headingHidden = false,
}: {
  title: string;
  intro?: string;
  defaults: Partial<ProductQuery>;
  searchParams: Record<string, string | string[] | undefined>;
  hero?: React.ReactNode;
  /**
   * Hides the heading visually while leaving it in the document.
   *
   * For a page whose hero already says what it is in large type, a repeated
   * text heading underneath is noise. It stays in the markup because removing
   * it outright would leave the page with no `h1` — which breaks the heading
   * outline a screen reader navigates by, and is what a search result shows.
   */
  headingHidden?: boolean;
}) {
  const query = parseProductQuery(searchParams, defaults);
  const config = await getStoreConfig();

  const [result, template, locale] = await Promise.all([
    getProductList(query),
    getTemplate(config.design.templateKey),
    readLocalePreference(config),
  ]);

  return (
    <div className="container-store py-6">
      <Breadcrumbs items={[{ label: title }]} className="mb-6" />

      {hero}

      <h1 className={headingHidden ? 'sr-only' : 'text-2xl font-semibold sm:text-3xl'}>{title}</h1>
      {intro ? <p className="mt-2 max-w-prose text-muted">{intro}</p> : null}

      <div className={headingHidden ? undefined : 'mt-6'}>
        <ProductListing
          result={result}
          sort={query.sort ?? 'relevance'}
          cardVariant={template.cardVariant}
          gridClassName={template.gridClassName}
          locale={locale.language}
        />
      </div>
    </div>
  );
}

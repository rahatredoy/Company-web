import { getStoreConfig } from '@/lib/api/store';
import { getProductList, parseProductQuery, type ProductQuery } from '@/lib/api/products';
import { getTemplate } from '@/templates/registry';
import { readLocalePreference } from '@/lib/locale/preference';
import { ProductListing } from '@/components/catalog/product-listing';

/**
 * The shared body of every curated listing: New Arrivals, Best Sellers, Sale,
 * Featured, and the shop itself.
 *
 * They differ only in a title and which filter is pre-applied, so they share
 * this rather than five near-identical page files — which is how one of them
 * ends up not honouring a sort parameter.
 *
 * The pre-applied filter is passed as `defaults`, and `parseProductQuery` lets
 * the visitor's own parameters layer on top: someone can still sort the sale by
 * price, or narrow it to one brand.
 */
export async function CollectionPage({
  title,
  defaults,
  searchParams,
  hero,
}: {
  title: string;
  defaults: Partial<ProductQuery>;
  searchParams: Record<string, string | string[] | undefined>;
  /**
   * A designed block above the grid, for a page that genuinely has something
   * to announce. It replaced the `intro` prop, which was a standing sentence
   * of prose on every one of these pages — see below.
   */
  hero?: React.ReactNode;
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
      {hero}

      {/*
        Heading in the document, off the screen — and the standing intro line
        that used to sit under it gone altogether.

        "Everything we have added recently, newest first" is a sentence written
        for no shop in particular and read once by nobody. Between it, the
        title and the trail above them, three lines of boilerplate stood
        between arriving here and seeing a single product.
      */}
      <h1 className="sr-only">{title}</h1>

      <ProductListing
        result={result}
        query={query}
        sort={query.sort ?? 'relevance'}
        cardVariant={template.cardVariant}
        gridClassName={template.gridClassName}
        locale={locale.language}
        currency={locale.currency}
      />
    </div>
  );
}

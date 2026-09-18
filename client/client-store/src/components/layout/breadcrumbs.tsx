import { getT } from '@/lib/i18n/server';

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Breadcrumb structured data — and only the structured data.
 *
 * The visible trails were removed from every page: "Home / Electronics" above
 * a page a visitor reached by clicking Electronics restated the click they had
 * just made, and did it across the top of the screen where the products go.
 * The header's back button answers the one question the trail was actually
 * good for, from a fixed position, on every page.
 *
 * A crawler has neither a back button nor the click, so it still gets the
 * hierarchy — the markup costs no space and search results render it as the
 * path under the title.
 */
export async function BreadcrumbJsonLd({ items, origin }: { items: Crumb[]; origin: string }) {
  // In the language the page is in: a search result prints this path under a title in that language.
  const t = await getT();
  const listItems = [
    { name: t('Home'), href: '/' },
    ...items.filter((item) => item.href).map((item) => ({ name: item.label, href: item.href! })),
  ];

  const json = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: listItems.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: new URL(item.href, origin).toString(),
    })),
  };

  return (
    <script
      type="application/ld+json"
      // Serialised from values this app assembled, never from raw input, and
      // `<` is escaped so a product name can never close the script element.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(json).replace(/</g, '\\u003c') }}
    />
  );
}

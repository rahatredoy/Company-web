import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Breadcrumb trail.
 *
 * Rendered as an ordered list inside a labelled `nav`, with the current page
 * marked `aria-current` and not linked — a breadcrumb whose last item links to
 * the page you are already on is a control that does nothing.
 *
 * The separators are `aria-hidden`: a screen reader announces list structure
 * already, and reading "chevron right" between every crumb is noise.
 */
export function Breadcrumbs({ items, className }: { items: Crumb[]; className?: string }) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex flex-wrap items-center gap-1 text-xs text-muted sm:text-sm">
        <li className="flex items-center gap-1">
          <Link href="/" className="hover:text-primary">
            Home
          </Link>
          <ChevronRight className="size-3.5 shrink-0 text-subtle" aria-hidden />
        </li>

        {items.map((item, index) => {
          const last = index === items.length - 1;

          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1">
              {item.href && !last ? (
                <Link href={item.href} className="hover:text-primary">
                  {item.label}
                </Link>
              ) : (
                <span aria-current={last ? 'page' : undefined} className={cn(last && 'truncate text-foreground')}>
                  {item.label}
                </span>
              )}

              {!last ? <ChevronRight className="size-3.5 shrink-0 text-subtle" aria-hidden /> : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Breadcrumb structured data.
 *
 * Emitted separately from the visual trail so the JSON-LD carries absolute
 * URLs — search engines need them fully qualified, while the links on the page
 * should stay relative.
 */
export function BreadcrumbJsonLd({ items, origin }: { items: Crumb[]; origin: string }) {
  const listItems = [
    { name: 'Home', href: '/' },
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

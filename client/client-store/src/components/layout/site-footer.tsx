import Link from 'next/link';
import type { StoreConfig } from '@/types';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { PaymentBadges } from './payment-badges';
import { SocialLinks } from './social-links';
import { LocaleSelects } from './locale-selects';
import { StoreLogo } from '@/templates/chrome';

/**
 * The footer every template uses.
 *
 * One implementation rather than six, because a footer is a list of links to
 * pages that exist and policies that are legally required — and six hand-copied
 * versions is six places for a policy link to quietly go missing when a new
 * page is added.
 *
 * Templates vary it through `tone` and `columns`, not by writing their own.
 *
 * On a phone the link columns collapse into an accordion: four stacked lists of
 * five links each is most of a screen's worth of scrolling past things nobody
 * came for.
 */

export interface FooterColumn {
  id: string;
  title: string;
  links: { label: string; href: string }[];
}

const SERVICE_LINKS = [
  { label: 'Contact Us', href: '/contact' },
  { label: 'FAQs', href: '/faq' },
  { label: 'Shipping & Delivery', href: '/page/shipping-policy' },
  { label: 'Returns & Refunds', href: '/page/return-policy' },
  { label: 'Track Your Order', href: '/track-order' },
];

const ACCOUNT_LINKS = [
  { label: 'My Orders', href: '/account/orders' },
  { label: 'Wishlist', href: '/wishlist' },
  { label: 'Account Details', href: '/account/profile' },
  { label: 'Addresses', href: '/account/addresses' },
  { label: 'Returns', href: '/account/returns' },
];

const HELP_LINKS = [
  { label: 'Payment Methods', href: '/faq' },
  { label: 'Compare Products', href: '/compare' },
  { label: 'New Arrivals', href: '/new-arrivals' },
  { label: 'Best Sellers', href: '/best-sellers' },
  { label: 'Sale', href: '/sale' },
];

export function buildFooterColumns(config: StoreConfig): FooterColumn[] {
  const shopLinks =
    config.navigation.footer.length > 0
      ? config.navigation.footer.map((item) => ({ label: item.label, href: item.href }))
      : [
          { label: 'All Products', href: '/shop' },
          { label: 'New Arrivals', href: '/new-arrivals' },
          { label: 'Best Sellers', href: '/best-sellers' },
          { label: 'On Sale', href: '/sale' },
        ];

  return [
    { id: 'shop', title: 'Shop', links: shopLinks },
    { id: 'service', title: 'Customer Service', links: SERVICE_LINKS },
    { id: 'account', title: 'My Account', links: ACCOUNT_LINKS },
    {
      id: 'company',
      title: 'Company',
      links: [
        { label: 'About Us', href: '/about' },
        // Policy pages are whatever the store has published, not a fixed list.
        ...config.policyPages.map((page) => ({ label: page.title, href: `/page/${page.slug}` })),
      ],
    },
    { id: 'help', title: 'Help Center', links: HELP_LINKS },
  ];
}

export function SiteFooter({
  config,
  locale,
  tone = 'surface',
  serif = false,
  className,
}: {
  config: StoreConfig;
  locale: { language: string; currency: string };
  tone?: 'surface' | 'dark' | 'alt';
  serif?: boolean;
  className?: string;
}) {
  const columns = buildFooterColumns(config);
  const year = new Date().getFullYear();
  const dark = tone === 'dark';

  return (
    <footer
      className={cn(
        'mt-16 border-t',
        dark ? 'border-transparent bg-secondary text-secondary-foreground' : 'border-border',
        tone === 'surface' && 'bg-surface',
        tone === 'alt' && 'bg-surface-alt',
        className,
      )}
    >
      <div className="container-store py-12">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,3.4fr)_minmax(0,0.9fr)]">
          {/* Identity */}
          <div>
            <StoreLogo config={config} serif={serif} />

            {config.store.tagline ? (
              <p className={cn('mt-3 max-w-xs text-sm', dark ? 'opacity-75' : 'text-muted')}>
                {config.store.tagline}
              </p>
            ) : null}

            <ul className={cn('mt-5 space-y-1.5 text-sm', dark ? 'opacity-75' : 'text-muted')}>
              {config.contact.phone ? <li>{config.contact.phone}</li> : null}
              {config.contact.email ? <li>{config.contact.email}</li> : null}
              {config.contact.address ? <li>{config.contact.address}</li> : null}
            </ul>

            <SocialLinks className="mt-5" tone={dark ? 'inherit' : 'muted'} />
          </div>

          {/* Link columns — a grid on desktop, an accordion on a phone. */}
          <div className="hidden gap-8 sm:grid sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            {columns.map((column) => (
              <nav key={column.id} aria-label={column.title}>
                <h2 className="mb-3 text-sm font-semibold">{column.title}</h2>
                <ul className="space-y-2">
                  {column.links.map((link) => (
                    <li key={`${column.id}-${link.href}-${link.label}`}>
                      <Link
                        href={link.href}
                        className={cn(
                          'text-sm transition-colors hover:text-primary',
                          dark ? 'opacity-75 hover:opacity-100' : 'text-muted',
                        )}
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>

          <div className="sm:hidden">
            <Accordion type="multiple" className="border-t border-current/10">
              {columns.map((column) => (
                <AccordionItem key={column.id} value={column.id} className="border-current/10">
                  <AccordionTrigger>{column.title}</AccordionTrigger>
                  <AccordionContent>
                    <ul className="space-y-2.5">
                      {column.links.map((link) => (
                        <li key={`${column.id}-${link.href}-${link.label}`}>
                          <Link href={link.href} className="text-sm hover:text-primary">
                            {link.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>

          <PaymentBadges payment={config.payment} />
        </div>
      </div>

      <div className={cn('border-t', dark ? 'border-white/10' : 'border-border')}>
        <div className="container-store flex flex-wrap items-center justify-between gap-3 py-5 text-xs">
          <p className={dark ? 'opacity-70' : 'text-subtle'}>
            © {year} {config.store.name}. All rights reserved.
          </p>

          <LocaleSelects
            languages={config.store.languages}
            currencies={config.store.currencies}
            language={locale.language}
            currency={locale.currency}
            tone={dark ? 'inherit' : 'muted'}
          />
        </div>
      </div>
    </footer>
  );
}

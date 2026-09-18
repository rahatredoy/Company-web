import Link from 'next/link';
import type { FooterColumn, StoreConfig } from '@/types';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import { PaymentBadges } from './payment-badges';
import { SocialLinks } from './social-links';
import { LocaleSelects } from './locale-selects';
import { StoreLogo } from '@/templates/chrome';
import { getT } from '@/lib/i18n/server';

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

/**
 * The link columns, entirely from store configuration.
 *
 * Three fixed arrays used to live here — Customer Service, My Account, Help
 * Center — rendered identically for every store on the platform. They were
 * wrong in the way invented links are always wrong: `Shipping & Delivery`
 * pointed at `/page/shipping-policy` and `Returns & Refunds` at
 * `/page/return-policy`, but the slug the seed actually publishes is
 * `returns-policy`, so every store on the platform shipped a 404 in its footer.
 * Nobody noticed, because nobody had authored those links and so nobody owned
 * them.
 *
 * Now a column exists only if the store wrote it. The `company` column is the
 * exception and is still derived, because policy pages are a legal requirement
 * rather than an editorial choice — it lists whatever the store has actually
 * published, which cannot go stale.
 */
export function buildFooterColumns(config: StoreConfig): FooterColumn[] {
  const policyLinks = config.policyPages.map((page) => ({
    label: page.title,
    href: `/page/${page.slug}`,
  }));

  return [
    ...config.footerColumns,
    ...(policyLinks.length > 0 ? [{ id: 'company', title: 'Company', links: policyLinks }] : []),
  ];
}

export async function SiteFooter({
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
  const t = await getT();
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

            <SocialLinks links={config.social} className="mt-5" tone={dark ? 'inherit' : 'muted'} />
          </div>

          {/* Link columns — a grid on desktop, an accordion on a phone. */}
          <div className="hidden gap-8 sm:grid sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            {columns.map((column) => (
              <nav key={column.id} aria-label={t.loose(column.title)}>
                <h2 className="mb-3 text-sm font-semibold">{t.loose(column.title)}</h2>
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
                        {t.loose(link.label)}
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
                  <AccordionTrigger>{t.loose(column.title)}</AccordionTrigger>
                  <AccordionContent>
                    <ul className="space-y-2.5">
                      {column.links.map((link) => (
                        <li key={`${column.id}-${link.href}-${link.label}`}>
                          <Link href={link.href} className="text-sm hover:text-primary">
                            {t.loose(link.label)}
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
            {t('© {year} {store}. All rights reserved.', { year: String(year), store: config.store.name })}
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

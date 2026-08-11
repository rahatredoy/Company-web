import Image from 'next/image';
import Link from 'next/link';
import type { StoreConfig } from '@/types';
import { cn } from '@/lib/utils';

/**
 * Header and footer building blocks shared by every template.
 *
 * Templates differ in how they *arrange* these — a two-tier marketplace bar, a
 * thin editorial rule, a minimal logo-left line — but the links, the account
 * controls and the policy list are assembled once. Six hand-written footers
 * would be six places for a policy link to go missing.
 */

export function StoreLogo({
  config,
  className,
  serif = false,
  priority = false,
}: {
  config: StoreConfig;
  className?: string;
  serif?: boolean;
  priority?: boolean;
}) {
  return (
    <Link href="/" className={cn('flex shrink-0 items-center gap-2', className)}>
      {config.store.logoUrl ? (
        <Image
          src={config.store.logoUrl}
          alt={config.store.name}
          width={160}
          height={40}
          priority={priority}
          className="h-9 w-auto object-contain"
        />
      ) : (
        <span
          className={cn(
            'font-bold tracking-tight',
            serif ? 'font-display text-xl uppercase tracking-[0.18em]' : 'text-xl text-primary',
          )}
        >
          {config.store.name}
        </span>
      )}
    </Link>
  );
}

export function DesktopNav({
  config,
  className,
  linkClassName,
}: {
  config: StoreConfig;
  className?: string;
  linkClassName?: string;
}) {
  if (config.navigation.header.length === 0) return null;

  return (
    <nav aria-label="Main" className={cn('hidden lg:block', className)}>
      <ul className="flex items-center gap-7">
        {config.navigation.header.map((item) => (
          <li key={item.id}>
            <Link
              href={item.href}
              target={item.opensInNewTab ? '_blank' : undefined}
              rel={item.opensInNewTab ? 'noreferrer' : undefined}
              className={cn(
                'text-sm font-medium text-foreground transition-colors hover:text-primary',
                linkClassName,
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The always-visible category rail the marketplace and electronics designs put
 * beside their hero. Categories come from store configuration, never hard-coded.
 */
export function CategorySidebar({ config, title = 'All Categories' }: { config: StoreConfig; title?: string }) {
  if (config.categoryMenu.length === 0) return null;

  return (
    <nav aria-label="Categories" className="hidden overflow-hidden rounded-(--radius-card) border border-border bg-surface lg:block">
      <p className="bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground">{title}</p>
      <ul className="max-h-[26rem] overflow-y-auto py-1">
        {config.categoryMenu.map((category) => (
          <li key={category.id}>
            <Link
              href={`/category/${category.slug}`}
              className="block px-4 py-2.5 text-sm text-foreground transition-colors hover:bg-surface-alt hover:text-primary"
            >
              {category.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

const ACCOUNT_LINKS = [
  { label: 'My Orders', href: '/account/orders' },
  { label: 'Wishlist', href: '/wishlist' },
  { label: 'Account Details', href: '/account/profile' },
  { label: 'Addresses', href: '/account/addresses' },
  // `/order-track` was never a route. The page map says `/track-order`.
  { label: 'Track Your Order', href: '/track-order' },
];

const SERVICE_LINKS = [
  { label: 'Contact Us', href: '/contact' },
  { label: 'FAQs', href: '/faq' },
  { label: 'Returns & Refunds', href: '/account/returns' },
];

/**
 * The footer link columns. Every entry is either store-configured or a route
 * that genuinely exists — no dead links to pages we have not built.
 */
export function FooterColumns({ config }: { config: StoreConfig }) {
  return (
    <>
      <nav aria-label="Shop">
        <h2 className="mb-3 text-sm font-semibold">Shop</h2>
        <ul className="space-y-2">
          {config.navigation.footer.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="text-sm text-muted hover:text-primary">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <nav aria-label="Customer service">
        <h2 className="mb-3 text-sm font-semibold">Customer Service</h2>
        <ul className="space-y-2">
          {SERVICE_LINKS.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="text-sm text-muted hover:text-primary">
                {item.label}
              </Link>
            </li>
          ))}
          {config.policyPages.map((page) => (
            <li key={page.slug}>
              <Link href={`/page/${page.slug}`} className="text-sm text-muted hover:text-primary">
                {page.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <nav aria-label="Your account">
        <h2 className="mb-3 text-sm font-semibold">My Account</h2>
        <ul className="space-y-2">
          {ACCOUNT_LINKS.map((item) => (
            <li key={item.href}>
              <Link href={item.href} className="text-sm text-muted hover:text-primary">
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </>
  );
}

/** Store identity block: tagline and whichever contact details are configured. */
export function FooterIdentity({ config, serif = false }: { config: StoreConfig; serif?: boolean }) {
  return (
    <div>
      <StoreLogo config={config} serif={serif} />
      {config.store.tagline ? (
        <p className="mt-3 max-w-xs text-sm text-muted">{config.store.tagline}</p>
      ) : null}

      <ul className="mt-5 space-y-1.5 text-sm text-muted">
        {config.contact.phone ? <li>{config.contact.phone}</li> : null}
        {config.contact.email ? <li>{config.contact.email}</li> : null}
        {config.contact.address ? <li>{config.contact.address}</li> : null}
      </ul>
    </div>
  );
}

export function FooterBase({ config, className }: { config: StoreConfig; className?: string }) {
  const year = new Date().getFullYear();

  return (
    <div className={cn('border-t border-border', className)}>
      <div className="container-store flex flex-wrap items-center justify-between gap-3 py-5 text-xs text-subtle">
        <p>
          © {year} {config.store.name}. All rights reserved.
        </p>
        {/* Only the methods this store has actually enabled are named. */}
        {config.payment.providers.length > 0 ? (
          <p>We accept: {config.payment.providers.map((provider) => provider.label).join(' · ')}</p>
        ) : null}
      </div>
    </div>
  );
}

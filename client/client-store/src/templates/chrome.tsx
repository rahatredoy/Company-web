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

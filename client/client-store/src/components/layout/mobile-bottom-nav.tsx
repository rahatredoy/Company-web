'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Grid2x2,
  Heart,
  Home,
  Search,
  ShoppingBag,
  ShoppingCart,
  Tag,
  User,
  type LucideIcon,
} from 'lucide-react';
import type { MobileNavItem } from '@/types';
import { cn } from '@/lib/utils';

/**
 * The fixed bottom bar on phones.
 *
 * `StorefrontTemplate.mobileBottomNav` has existed since the registry was
 * written and was never read by anything — three templates declared they wanted
 * this bar and none of them got one. It is mounted from the root layout so all
 * six behave consistently and no template has to remember.
 *
 * Destinations come from store configuration, capped at five by the API: more
 * than five targets in a thumb-width row makes each one too small to hit.
 * Deliberately not a duplicate of the header nav — the drawer already holds the
 * full menu — and a store that has configured none gets no bar rather than a
 * guess at what its shoppers want.
 *
 * Icons are keys into this closed set, not URLs. This bar is fixed over every
 * page on the site, which makes it the worst possible place to render a remote
 * image from admin-authored data.
 *
 * `pb-[env(safe-area-inset-bottom)]` keeps the row clear of the home indicator;
 * without it the bottom third of every icon sits under it on a modern phone.
 */

const ICONS: Record<string, LucideIcon> = {
  home: Home,
  categories: Grid2x2,
  shop: ShoppingBag,
  wishlist: Heart,
  account: User,
  cart: ShoppingCart,
  search: Search,
  offers: Tag,
};

/** Grid columns as literal classes — Tailwind cannot see `grid-cols-${n}`. */
const COLUMNS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
};

export function MobileBottomNav({ items }: { items: MobileNavItem[] }) {
  const pathname = usePathname();
  const shown = items.filter((item) => ICONS[item.icon]).slice(0, 5);

  if (shown.length === 0) return null;

  return (
    <nav
      aria-label="Quick navigation"
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface lg:hidden',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <ul className={cn('grid', COLUMNS[shown.length])}>
        {shown.map((item) => {
          // `/` would otherwise prefix-match every page on the site.
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          const Icon = ICONS[item.icon]!;

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                  active ? 'text-primary' : 'text-muted',
                )}
              >
                <Icon className="size-5" aria-hidden />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Spacer matching the bar's height.
 *
 * Without it a fixed bar covers the last rows of the footer, and on a listing
 * page it hides the pagination — the two places people most need to reach.
 */
export function MobileBottomNavSpacer() {
  return <div aria-hidden className="h-14 pb-[env(safe-area-inset-bottom)] lg:hidden" />;
}

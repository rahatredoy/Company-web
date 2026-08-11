'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Grid2x2, Heart, Home, ShoppingBag, User } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The fixed bottom bar on phones.
 *
 * `StorefrontTemplate.mobileBottomNav` has existed since the registry was
 * written and was never read by anything — three templates declared they wanted
 * this bar and none of them got one. It is mounted from the root layout so all
 * six behave consistently and no template has to remember.
 *
 * Five destinations, chosen because they are the ones a thumb reaches for.
 * Deliberately not a duplicate of the header nav: the drawer already holds the
 * full menu.
 *
 * `pb-[env(safe-area-inset-bottom)]` keeps the row clear of the home indicator;
 * without it the bottom third of every icon sits under it on a modern phone.
 */

const ITEMS = [
  { href: '/', label: 'Home', icon: Home, exact: true },
  { href: '/categories', label: 'Categories', icon: Grid2x2, exact: false },
  { href: '/shop', label: 'Shop', icon: ShoppingBag, exact: false },
  { href: '/wishlist', label: 'Wishlist', icon: Heart, exact: false },
  { href: '/account', label: 'Account', icon: User, exact: false },
];

export function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Quick navigation"
      className={cn(
        'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface lg:hidden',
        'pb-[env(safe-area-inset-bottom)]',
      )}
    >
      <ul className="grid grid-cols-5">
        {ITEMS.map((item) => {
          const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);

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
                <item.icon className="size-5" aria-hidden />
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

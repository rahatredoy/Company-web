'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  LogOut,
  MapPin,
  Package,
  RotateCcw,
  ShieldCheck,
  User,
} from 'lucide-react';
import { WishlistIcon } from '@/lib/commerce/wishlist-icon';
import { useT, type MessageKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Account navigation.
 *
 * A sidebar on desktop, a horizontal scroller on a phone. Not an accordion:
 * these are seven destinations, not seven panels, and collapsing them hides
 * where you are.
 *
 * Sign out is a form posting to the logout endpoint rather than a link, because
 * it changes state — a `GET` that ends a session can be triggered by any
 * `<img>` tag on any page.
 */

const ITEMS: { href: string; label: MessageKey; icon: typeof LayoutDashboard; exact: boolean }[] = [
  { href: '/account', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { href: '/account/orders', label: 'Orders', icon: Package, exact: false },
  { href: '/account/returns', label: 'Returns', icon: RotateCcw, exact: false },
  { href: '/account/addresses', label: 'Addresses', icon: MapPin, exact: false },
  { href: '/wishlist', label: 'Wishlist', icon: WishlistIcon, exact: false },
  { href: '/account/profile', label: 'Profile', icon: User, exact: false },
  { href: '/account/security', label: 'Security', icon: ShieldCheck, exact: false },
];

export function AccountNav() {
  const t = useT();
  const pathname = usePathname();

  const isActive = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <nav aria-label={t('Account')} className="lg:sticky lg:top-24">
      <ul className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
        {ITEMS.map((item) => {
          const active = isActive(item.href, item.exact);

          return (
            <li key={item.href} className="shrink-0 lg:shrink">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 whitespace-nowrap rounded-(--radius-button) px-3 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary-soft text-primary'
                    : 'text-muted hover:bg-surface-alt hover:text-foreground',
                )}
              >
                <item.icon className="size-4 shrink-0" aria-hidden />
                {t(item.label)}
              </Link>
            </li>
          );
        })}

        <li className="shrink-0 lg:mt-2 lg:shrink lg:border-t lg:border-border lg:pt-2">
          <form action="/api/auth/logout" method="post">
            <button
              type="submit"
              className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-(--radius-button) px-3 py-2.5 text-sm font-medium text-muted transition-colors hover:bg-surface-alt hover:text-error"
            >
              <LogOut className="size-4 shrink-0" aria-hidden />
              {t('Sign out')}
            </button>
          </form>
        </li>
      </ul>
    </nav>
  );
}

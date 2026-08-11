'use client';

import Link from 'next/link';
import { ExternalLink, Grid3x3, LayoutDashboard, LifeBuoy, Settings2, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { publicEnv } from '@/lib/env';
import { cn } from '@/lib/utils';
import type { StoreView } from '@/lib/types';

interface AppEntry {
  key: string;
  name: string;
  description: string;
  detail: string | null;
  href: string;
  external: boolean;
  icon: typeof Store;
  disabled?: boolean;
}

/**
 * The one place the three applications a client touches are visible together:
 * this account, their storefront, and their store admin panel. The last two are
 * separate deployments, so they open in a new tab and only appear once the store
 * is actually ready — a link to a store that does not exist is worse than none.
 */
export function AppsSwitcher({ store }: { store: StoreView | null }) {
  const ready = store?.storeStatus === 'ready';

  const apps: AppEntry[] = [
    {
      key: 'account',
      name: 'Account Dashboard',
      description: 'Plan, billing, domains and support',
      detail: publicEnv.siteUrl.replace(/^https?:\/\//, ''),
      href: '/dashboard',
      external: false,
      icon: LayoutDashboard,
    },
    {
      key: 'storefront',
      name: ready ? store!.storeName : 'My Store',
      description: ready ? 'Open your storefront' : 'Not set up yet',
      detail: ready ? store!.customDomain ?? store!.platformSubdomain : null,
      href: ready ? store!.storefrontUrl : '/dashboard/store',
      external: ready,
      icon: Store,
      disabled: !ready,
    },
    {
      key: 'store-admin',
      name: 'Store Admin',
      description: ready ? 'Products, orders and customers' : 'Available once your store is created',
      detail: ready ? store!.adminUrl.replace(/^https?:\/\//, '') : null,
      href: ready ? store!.adminUrl : '/dashboard/store',
      external: ready,
      icon: Settings2,
      disabled: !ready,
    },
    {
      key: 'support',
      name: 'Support',
      description: 'Talk to our team',
      detail: null,
      href: '/dashboard/support',
      external: false,
      icon: LifeBuoy,
    },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2 sm:px-3">
          <Grid3x3 className="size-4.5" aria-hidden />
          <span className="hidden sm:inline">Apps</span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-1.5">
        <DropdownMenuLabel className="px-2.5">Apps</DropdownMenuLabel>
        <DropdownMenuSeparator />

        <ul className="space-y-0.5 pt-1">
          {apps.map((app) => {
            const content = (
              <>
                <span
                  className={cn(
                    'mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg',
                    app.disabled ? 'bg-muted text-muted-foreground' : 'bg-primary-soft text-accent-foreground',
                  )}
                >
                  <app.icon className="size-4.5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{app.name}</span>
                    {app.external ? (
                      <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    ) : null}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{app.description}</span>
                  {app.detail ? (
                    <span className="block truncate font-mono text-[11px] text-muted-foreground/80">
                      {app.detail}
                    </span>
                  ) : null}
                </span>
              </>
            );

            const className =
              'flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none';

            return (
              <li key={app.key}>
                {app.external ? (
                  <a href={app.href} target="_blank" rel="noreferrer noopener" className={className}>
                    {content}
                  </a>
                ) : (
                  <Link href={app.href} className={className}>
                    {content}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

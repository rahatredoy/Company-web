'use client';

import * as React from 'react';
import Link from 'next/link';
import { LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Avatar, AvatarFallback, initialsOf } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AppsSwitcher } from '@/components/dashboard/apps-switcher';
import { NotificationBell } from '@/components/dashboard/notification-bell';
import { SignOutButton } from '@/components/dashboard/sign-out-button';
import { api } from '@/lib/api';
import type { ClientMe, StoreView } from '@/lib/types';

/**
 * The marketing pages stay statically rendered, so who is signed in cannot be
 * known while rendering them. This resolves it in the browser instead: signed-out
 * actions show immediately (the common case for these pages) and are replaced
 * once the session is confirmed. The session cookie is HttpOnly, so asking the
 * API is the only way to know.
 */
export function SiteHeaderActions({ mobile = false }: { mobile?: boolean }) {
  const [account, setAccount] = React.useState<ClientMe | null>(null);
  const [store, setStore] = React.useState<StoreView | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const me = await api.get<ClientMe>('/api/v1/client/me');
        if (cancelled || !me) return;
        setAccount(me);

        const view = await api.get<StoreView>('/api/v1/client/store').catch(() => null);
        if (!cancelled) setStore(view);
      } catch {
        // Not signed in — the signed-out actions are already correct.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (mobile) {
    return account ? (
      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
        <Button asChild>
          <Link href="/dashboard">
            <LayoutDashboard /> Go to dashboard
          </Link>
        </Button>
        <SignOutButton variant="outline" />
      </div>
    ) : (
      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
        <Button asChild variant="outline">
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button asChild>
          <Link href="/register">Start Free Trial</Link>
        </Button>
      </div>
    );
  }

  if (!account) {
    return (
      <>
        <ThemeToggle />
        <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button asChild size="sm" className="hidden sm:inline-flex">
          <Link href="/register">Start Free Trial</Link>
        </Button>
      </>
    );
  }

  return (
    <>
      <Button asChild size="sm" className="hidden sm:inline-flex">
        <Link href="/dashboard">
          <LayoutDashboard /> Dashboard
        </Link>
      </Button>
      <AppsSwitcher store={store} />
      <NotificationBell />
      <ThemeToggle />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="rounded-lg p-1 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
            aria-label="Account menu"
          >
            <Avatar className="size-8">
              <AvatarFallback>{initialsOf(account.fullName)}</AvatarFallback>
            </Avatar>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Signed in</DropdownMenuLabel>
          <div className="px-2.5 pb-2">
            <p className="truncate text-sm font-medium">{account.fullName}</p>
            <p className="truncate text-xs text-muted-foreground">{account.email}</p>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/dashboard">Dashboard</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/billing">Billing</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/security">Security</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/support">Support</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <div className="p-1">
            <SignOutButton variant="ghost" size="sm" className="w-full justify-start" />
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExternalLink, Lock, Menu, X } from 'lucide-react';
import { Logo } from '@/components/brand/logo';
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
import { SignOutButton } from './sign-out-button';
import { AppsSwitcher } from './apps-switcher';
import { NotificationBell } from './notification-bell';
import { BillingRequiredBanner } from './billing-required';
import { ACCOUNT_NAV } from './account-nav';
import { cn } from '@/lib/utils';
import { rendersBillingGate, type BillingGate } from '@/lib/billing-gate';
import type { ClientMe, StoreView } from '@/lib/types';

function NavLinks({ billingComplete, onNavigate }: { billingComplete: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="space-y-5" aria-label="Dashboard">
      {ACCOUNT_NAV.map((group, index) => (
        <div key={group.label ?? `group-${index}`} className="space-y-1">
          {group.label ? (
            <p className="px-3 pb-1 text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">
              {group.label}
            </p>
          ) : null}

          {group.items.map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            const locked = Boolean(item.requiresBilling) && !billingComplete;

            // Still listed, so the shape of the account is visible from the
            // start — but not a link, because there is nothing behind it yet.
            if (locked) {
              return (
                <span
                  key={item.href}
                  aria-disabled
                  title="Available once your bill is paid"
                  className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground/60"
                >
                  <item.icon className="size-4.5 shrink-0" aria-hidden />
                  <span className="flex-1">{item.label}</span>
                  <Lock className="size-3.5 shrink-0" aria-hidden />
                  <span className="sr-only">Locked until your bill is paid</span>
                </span>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                  active
                    ? 'bg-primary text-primary-foreground shadow-[0_6px_18px_-10px_var(--primary)]'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <item.icon className="size-4.5 shrink-0" aria-hidden />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function DashboardShell({
  account,
  store,
  businessName,
  billing,
  children,
}: {
  account: ClientMe;
  store: StoreView | null;
  businessName: string | null;
  billing: BillingGate;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const [lastPathname, setLastPathname] = React.useState(pathname);

  // Navigating on mobile closes the drawer; leaving it open hides the page that
  // was just asked for. Adjusted during render rather than in an effect, which
  // would paint the new page underneath the drawer first.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  // Above every page while the bill is outstanding — except on the pages that
  // already lead with the gate in full.
  const showBanner = !billing.complete && !rendersBillingGate(pathname);

  return (
    <div className="min-h-dvh bg-surface">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="flex h-16 items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <X /> : <Menu />}
            </Button>
            <Logo href="/dashboard" subtitle="Account" />
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {store?.storeStatus === 'ready' ? (
              <Button asChild variant="outline" size="sm" className="hidden md:inline-flex">
                <a href={store.storefrontUrl} target="_blank" rel="noreferrer noopener">
                  View store <ExternalLink />
                </a>
              </Button>
            ) : null}

            <AppsSwitcher store={store} />
            <NotificationBell />
            <ThemeToggle />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="flex items-center gap-2 rounded-lg p-1 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
                  aria-label="Account menu"
                >
                  <Avatar className="size-8">
                    <AvatarFallback>{initialsOf(account.fullName)}</AvatarFallback>
                  </Avatar>
                  <span className="hidden min-w-0 text-left lg:block">
                    <span className="block max-w-36 truncate text-sm font-medium leading-tight">
                      {account.fullName}
                    </span>
                    {businessName ? (
                      <span className="block max-w-36 truncate text-xs leading-tight text-muted-foreground">
                        {businessName}
                      </span>
                    ) : null}
                  </span>
                </button>
              </DropdownMenuTrigger>

              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Signed in</DropdownMenuLabel>
                <div className="px-2.5 pb-2">
                  <p className="truncate text-sm font-medium">{account.fullName}</p>
                  {businessName ? (
                    <p className="truncate text-xs text-muted-foreground">{businessName}</p>
                  ) : null}
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
                  <Link href="/dashboard/settings">Settings</Link>
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
          </div>
        </div>
      </header>

      <div className="flex">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 shrink-0 overflow-y-auto border-r border-border bg-background p-4 lg:block">
          <NavLinks billingComplete={billing.complete} />
        </aside>

        {open ? (
          <div className="fixed inset-0 top-16 z-30 lg:hidden">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-hidden />
            <div className="relative h-full w-72 max-w-[80vw] overflow-y-auto border-r border-border bg-background p-4">
              <NavLinks billingComplete={billing.complete} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        ) : null}

        {/* id="main" is the target of the root layout's skip link. */}
        <main id="main" className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-6xl space-y-6">
            {showBanner ? <BillingRequiredBanner gate={billing} /> : null}
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

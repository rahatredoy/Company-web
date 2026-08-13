'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
import { AdminSidebar, AdminLogo, AdminNavLinks } from './admin-sidebar';
import { AdminTopbar } from './admin-topbar';
import { ReauthProvider } from './reauth-provider';
import { Button } from '@/components/ui/button';
import { ADMIN_NAV } from './nav';
import type { AdminMe } from '@/lib/types';

const STORAGE_KEY = 'admin.sidebar.collapsed';

/**
 * The collapsed preference lives in `localStorage`, which React cannot see
 * during the server render. Reading it through `useSyncExternalStore` rather
 * than in an effect means the value is picked up as part of hydration instead
 * of a render after it, and a change in one tab reaches the others.
 */
const collapseListeners = new Set<() => void>();

function subscribeToCollapse(onChange: () => void): () => void {
  collapseListeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    collapseListeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

// A primitive, so React can compare snapshots without looping.
const readCollapsed = () => window.localStorage.getItem(STORAGE_KEY) === '1';
const readCollapsedOnServer = () => false;

function writeCollapsed(next: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
  // `storage` only fires in *other* tabs, so this tab is notified by hand.
  for (const listener of collapseListeners) listener();
}

function titleFor(pathname: string): string {
  const match = ADMIN_NAV.filter((item) => pathname.startsWith(item.href)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0];
  return match?.label ?? 'Dashboard';
}

export function AdminShell({
  admin,
  unreadCount,
  children,
}: {
  admin: AdminMe;
  unreadCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const collapsed = React.useSyncExternalStore(
    subscribeToCollapse,
    readCollapsed,
    readCollapsedOnServer,
  );
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [lastPathname, setLastPathname] = React.useState(pathname);

  // Navigating on mobile closes the drawer; leaving it open hides the page the
  // admin just asked for. Adjusted during render rather than in an effect,
  // which would paint the new page underneath the drawer first.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMobileOpen(false);
  }

  const toggle = () => writeCollapsed(!collapsed);

  return (
    <div className="flex min-h-dvh bg-surface">
      <AdminSidebar collapsed={collapsed} onToggle={toggle} />

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} aria-hidden />
          <div className="relative flex h-full w-72 max-w-[82vw] flex-col border-r border-border bg-card">
            <div className="flex h-16 items-center justify-between border-b border-border px-3">
              <AdminLogo />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close menu"
                onClick={() => setMobileOpen(false)}
              >
                <X />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <AdminNavLinks onNavigate={() => setMobileOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar
          admin={admin}
          title={titleFor(pathname)}
          unreadCount={unreadCount}
          onOpenMobileNav={() => setMobileOpen(true)}
        />
        <main id="main" className="min-w-0 flex-1 p-4 sm:p-6">
          {/* Every dashboard page gets the re-auth prompt with no prop drilling. */}
          <ReauthProvider>
            <div className="mx-auto max-w-[100rem] space-y-5">{children}</div>
          </ReauthProvider>
        </main>
      </div>
    </div>
  );
}

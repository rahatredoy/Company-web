'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { AdminSidebar } from './admin-sidebar';
import { AdminTopbar } from './admin-topbar';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = React.useState(false);

  // Navigating on mobile should close the drawer; leaving it open hides the page
  // the user just asked for.
  React.useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <div className="min-h-svh bg-surface">
      <AdminSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="lg:pl-72">
        <AdminTopbar onOpenMenu={() => setMenuOpen(true)} />
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

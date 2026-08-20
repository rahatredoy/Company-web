'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { AdminSidebar } from './admin-sidebar';
import { AdminTopbar } from './admin-topbar';

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [lastPathname, setLastPathname] = React.useState(pathname);

  // Navigating on mobile should close the drawer; leaving it open hides the page
  // the user just asked for. Adjusted during render rather than in an effect —
  // an effect would paint the new page with the drawer still over it first.
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    setMenuOpen(false);
  }

  return (
    <div className="min-h-svh bg-surface">
      <AdminSidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="lg:pl-72">
        <AdminTopbar onOpenMenu={() => setMenuOpen(true)} />
        {/*
          * Full width, with padding rather than a centred column. The panel is a
          * working screen — tables, filter rows, stat cards — and capping it at a
          * reading width left a wide monitor showing empty margins while a table
          * scrolled sideways inside them. Nothing about small screens depends on
          * this: a cap only ever applies above its own width, and the layout
          * below it comes from the padding here and the responsive grids on each
          * page.
          */}
        <main className="w-full px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

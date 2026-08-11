'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { ADMIN_NAV } from './nav';
import { publicEnv } from '@/lib/env';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function AdminLogo({ collapsed }: { collapsed?: boolean }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-1">
      <span
        className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground shadow-[0_6px_18px_-8px_var(--primary)]"
        aria-hidden
      >
        <svg viewBox="0 0 24 24" fill="none" className="size-5" strokeWidth={2} stroke="currentColor">
          <path d="M4 8h16l-1.2 10.2a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8L4 8Z" strokeLinejoin="round" />
          <path d="M8.5 8V6.5a3.5 3.5 0 1 1 7 0V8" strokeLinecap="round" />
        </svg>
      </span>
      {collapsed ? null : (
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight">{publicEnv.platformName}</span>
          <span className="mt-0.5 text-[11px] text-muted-foreground">Company Admin</span>
        </span>
      )}
    </Link>
  );
}

export function AdminNavLinks({
  collapsed,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="space-y-1" aria-label="Admin sections">
      {ADMIN_NAV.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);

        const link = (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              collapsed && 'justify-center px-0',
              active
                ? 'bg-primary text-primary-foreground shadow-[0_8px_20px_-12px_var(--primary)]'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            <item.icon className="size-4.5 shrink-0" aria-hidden />
            {collapsed ? <span className="sr-only">{item.label}</span> : item.label}
          </Link>
        );

        return collapsed ? (
          <Tooltip key={item.href}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        ) : (
          link
        );
      })}
    </nav>
  );
}

export function AdminSidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      className={cn(
        'sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-border bg-card transition-[width] duration-200 lg:flex',
        collapsed ? 'w-[4.5rem]' : 'w-64',
      )}
    >
      <div className={cn('flex h-16 items-center border-b border-border px-3', collapsed && 'justify-center px-0')}>
        <AdminLogo collapsed={collapsed} />
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <AdminNavLinks collapsed={collapsed} />
      </div>

      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none',
            collapsed && 'justify-center px-0',
          )}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronsRight className="size-4.5" aria-hidden />
          ) : (
            <>
              <ChevronsLeft className="size-4.5" aria-hidden />
              Collapse
            </>
          )}
        </button>
      </div>
    </aside>
  );
}

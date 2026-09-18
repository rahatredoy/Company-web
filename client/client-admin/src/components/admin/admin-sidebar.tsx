'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExternalLink, Store, X } from 'lucide-react';
import { NAV_SECTIONS, isActive } from './nav';
import { useSession } from './session-provider';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { storefrontUrl } from '@/lib/env';
import { cn } from '@/lib/utils';

export function AdminSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const { store, can } = useSession();
  const t = useT();

  // Sections with nothing the admin may see are dropped entirely, so a limited
  // staff member gets a short, honest menu rather than a wall of dead links.
  const sections = React.useMemo(
    () =>
      NAV_SECTIONS.map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          Array.isArray(item.permission) ? item.permission.some(can) : can(item.permission),
        ),
      })).filter((section) => section.items.length > 0),
    [can],
  );

  return (
    <>
      {open ? (
        <div
          className="fixed inset-0 z-40 bg-foreground/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
          aria-hidden
        />
      ) : null}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-border bg-card transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-4">
          <Link href="/dashboard" className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <Store className="size-4.5" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{store.name}</span>
              <span className="block truncate text-xs text-muted-foreground">{store.slug}</span>
            </span>
          </Link>
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onClose} aria-label={t('Close menu')}>
            <X />
          </Button>
        </div>

        <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5" aria-label={t('Store admin')}>
          {sections.map((section) => (
            <div key={section.label}>
              <p className="px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(section.label)}
              </p>
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = isActive(pathname, item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onClose}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          active
                            ? 'bg-primary-soft text-primary'
                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                        )}
                      >
                        <item.icon className="size-4.5 shrink-0" aria-hidden />
                        {t(item.label)}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-border p-3">
          <a
            href={storefrontUrl(store.slug)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {t('View storefront')}
            <ExternalLink className="size-4" aria-hidden />
          </a>
        </div>
      </aside>
    </>
  );
}

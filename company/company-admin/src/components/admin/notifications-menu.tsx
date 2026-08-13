'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ACTIVITY_ICONS } from './activity-feed';
import { api, apiFetchPaginated } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { NotificationItem } from '@/lib/types';

const POLL_MS = 60_000;

/**
 * Real platform-event feed. `activity_events` is already written by
 * provisioning, billing, trials and support; this surfaces it with read state.
 */
export function NotificationsMenu({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<NotificationItem[]>([]);
  const [unread, setUnread] = React.useState(initialUnread);
  const [loading, setLoading] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiFetchPaginated<NotificationItem>('/api/v1/admin/notifications', {
        query: { pageSize: 8 },
      });
      setItems(result.data);
      const meta = result.meta as { unread?: number };
      if (typeof meta.unread === 'number') setUnread(meta.unread);
    } catch {
      // The bell is ambient — a failure here must not interrupt the page.
    } finally {
      setLoading(false);
    }
  }, []);

  // Poll the cheap count endpoint; only fetch the list when the menu opens.
  React.useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const result = await api.get<{ unread: number }>('/api/v1/admin/notifications/counts');
        if (!cancelled) setUnread(result.unread);
      } catch {
        /* ignore */
      }
    };
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Opening the menu is an event, not something to synchronise to — fetching
  // from the handler keeps the request on the interaction that caused it.
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) void load();
  };

  const markAll = async () => {
    setUnread(0);
    setItems((current) => current.map((item) => ({ ...item, read: true })));
    try {
      await api.post('/api/v1/admin/notifications/read-all');
      router.refresh();
    } catch {
      void load();
    }
  };

  const markOne = async (id: string) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, read: true } : item)));
    setUnread((count) => Math.max(0, count - 1));
    try {
      await api.post(`/api/v1/admin/notifications/${id}/read`);
    } catch {
      void load();
    }
  };

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`} className="relative">
          <Bell />
          {unread > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 grid min-w-4.5 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-88 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold">Notifications</p>
          {unread > 0 ? (
            <button
              type="button"
              onClick={markAll}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
            >
              <CheckCheck className="size-3.5" /> Mark all read
            </button>
          ) : null}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {loading && items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing to report.</p>
          ) : (
            <ul>
              {items.map((item) => {
                const config = ACTIVITY_ICONS[item.type] ?? ACTIVITY_ICONS.client_registered;
                const Icon = config.icon;
                const href = item.clientId ? `/clients/${item.clientId}` : '/notifications';

                return (
                  <li key={item.id}>
                    <Link
                      href={href}
                      onClick={() => {
                        if (!item.read) void markOne(item.id);
                        setOpen(false);
                      }}
                      className={cn(
                        'flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted',
                        !item.read && 'bg-primary-soft/40',
                      )}
                    >
                      <span className={cn('mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg', config.tint)}>
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{item.title}</span>
                          {!item.read ? <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden /> : null}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {item.businessName ?? item.subject}
                        </span>
                        <span className="block text-[11px] text-muted-foreground/70">
                          {formatRelative(item.createdAt)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-border p-1">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block rounded-md px-2.5 py-2 text-center text-sm font-medium text-primary hover:bg-muted"
          >
            View all notifications
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

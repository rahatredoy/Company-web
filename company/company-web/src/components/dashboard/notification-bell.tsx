'use client';

import * as React from 'react';
import Link from 'next/link';
import { Bell, Mail, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { api } from '@/lib/api';
import { formatRelative, titleCase } from '@/lib/format';

interface NotificationRow {
  id: string;
  template: string;
  subject: string | null;
  channel: 'email' | 'sms' | 'whatsapp' | 'in_app';
  status: 'queued' | 'sent' | 'failed';
  createdAt: string;
}

const CHANNEL_ICONS = { email: Mail, sms: MessageSquare, whatsapp: MessageSquare, in_app: Bell } as const;

/**
 * Everything the platform has sent this account — store ready, trial ending,
 * payment received, support replies. Loaded on open rather than on every page
 * render, because most visits never touch it.
 */
export function NotificationBell() {
  const [items, setItems] = React.useState<NotificationRow[] | null>(null);
  const [loading, setLoading] = React.useState(false);

  const load = async (open: boolean) => {
    if (!open || items !== null || loading) return;
    setLoading(true);
    try {
      const rows = await api.get<NotificationRow[]>('/api/v1/client/notifications');
      setItems(rows ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DropdownMenu onOpenChange={load}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Notifications">
          <Bell className="size-4.5" aria-hidden />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-1.5">
        <DropdownMenuLabel className="px-2.5">Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {loading || items === null ? (
          <ul className="space-y-2 p-2.5" aria-busy>
            {[0, 1, 2].map((row) => (
              <li key={row} className="h-9 animate-pulse rounded-md bg-muted" />
            ))}
          </ul>
        ) : items.length === 0 ? (
          <p className="px-2.5 py-6 text-center text-sm text-muted-foreground">Nothing yet.</p>
        ) : (
          <ul className="max-h-80 space-y-0.5 overflow-y-auto pt-1">
            {items.slice(0, 8).map((item) => {
              const Icon = CHANNEL_ICONS[item.channel] ?? Bell;
              return (
                <li key={item.id} className="flex items-start gap-2.5 rounded-lg px-2 py-2">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{item.subject ?? titleCase(item.template)}</span>
                    <span className="block text-xs text-muted-foreground">{formatRelative(item.createdAt)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <DropdownMenuSeparator />
        <div className="p-1">
          <Button asChild variant="ghost" size="sm" className="w-full justify-center">
            <Link href="/dashboard/activity">View all activity</Link>
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

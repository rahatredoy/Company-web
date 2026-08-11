'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Laptop, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toaster';
import { formatDateTime } from '@/lib/format';
import { api, errorMessage } from '@/lib/api';

export interface SessionView {
  id: string;
  current: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string | null;
}

/** Very small UA sniff — only used to pick an icon, never for security. */
function isMobile(userAgent: string | null): boolean {
  return /mobile|android|iphone|ipad/i.test(userAgent ?? '');
}

function describe(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  const browser =
    /edg/i.test(userAgent) ? 'Edge'
    : /chrome/i.test(userAgent) ? 'Chrome'
    : /safari/i.test(userAgent) ? 'Safari'
    : /firefox/i.test(userAgent) ? 'Firefox'
    : 'Browser';
  const os =
    /windows/i.test(userAgent) ? 'Windows'
    : /mac os/i.test(userAgent) ? 'macOS'
    : /android/i.test(userAgent) ? 'Android'
    : /iphone|ipad/i.test(userAgent) ? 'iOS'
    : /linux/i.test(userAgent) ? 'Linux'
    : 'Unknown OS';
  return `${browser} on ${os}`;
}

export function SessionsList({ sessions }: { sessions: SessionView[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const revoke = async (id: string) => {
    setBusyId(id);
    try {
      await api.delete(`/api/v1/client/sessions/${id}`);
      toast.success('Session signed out');
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  if (sessions.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">No other active sessions.</p>;
  }

  return (
    <ul className="divide-y divide-border">
      {sessions.map((session) => {
        const Icon = isMobile(session.userAgent) ? Smartphone : Laptop;
        return (
          <li key={session.id} className="flex flex-wrap items-center gap-3 py-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                {describe(session.userAgent)}
                {session.current ? <Badge variant="success">This device</Badge> : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {session.ipAddress ?? 'Unknown IP'} · last active {formatDateTime(session.lastSeenAt ?? session.createdAt)}
              </p>
            </div>
            {session.current ? null : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => revoke(session.id)}
                loading={busyId === session.id}
              >
                Sign out
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

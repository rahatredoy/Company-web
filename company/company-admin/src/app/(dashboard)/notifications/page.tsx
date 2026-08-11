import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { Bell } from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
import { EmptyState } from '@/components/admin/empty-state';
import { ACTIVITY_ICONS } from '@/components/admin/activity-feed';
import { MarkAllReadButton } from '@/components/admin/mark-all-read-button';
import { Card, CardContent } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { listOrEmpty } from '@/lib/admin-api';
import { formatDateTime, formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { NotificationItem } from '@/lib/types';

export const metadata: Metadata = { title: 'Notifications' };

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const result = await listOrEmpty<NotificationItem>('/api/v1/admin/notifications', {
    ...params,
    pageSize: 30,
  });

  const { unavailable } = result;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Everything that happened across the platform, newest first."
        actions={<MarkAllReadButton />}
      />

      {unavailable ? (
        <Alert variant="warning" title="Could not reach the API">
          This list is empty because the company API did not respond — not because there is nothing
          to show. Check that it is running, then refresh.
        </Alert>
      ) : null}

      {result.data.length === 0 && !unavailable ? (
        <EmptyState icon={Bell} title="Nothing to report yet" description="Platform events will appear here." />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <ul className="divide-y divide-border">
              {result.data.map((item) => {
                const config = ACTIVITY_ICONS[item.type] ?? ACTIVITY_ICONS.client_registered;
                const Icon = config.icon;

                const row = (
                  <div
                    className={cn(
                      'flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/60',
                      !item.read && 'bg-primary-soft/30',
                    )}
                  >
                    <span className={cn('mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg', config.tint)}>
                      <Icon className="size-4.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {item.title}
                        {!item.read ? <span className="size-1.5 rounded-full bg-primary" aria-hidden /> : null}
                      </p>
                      <p className="truncate text-sm text-muted-foreground">
                        {item.businessName ? `${item.businessName} — ` : ''}
                        {item.subject}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-muted-foreground">{formatRelative(item.createdAt)}</p>
                      <p className="text-[11px] text-muted-foreground/70">{formatDateTime(item.createdAt)}</p>
                    </div>
                  </div>
                );

                return (
                  <li key={item.id}>
                    {item.clientId ? <Link href={`/clients/${item.clientId}`}>{row}</Link> : row}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <Suspense fallback={null}>
        <Pagination {...result.meta} />
      </Suspense>
    </>
  );
}

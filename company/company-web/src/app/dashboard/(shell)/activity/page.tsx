import type { Metadata } from 'next';
import Link from 'next/link';
import { Bell, Mail, MessageSquare, Send } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { serverGetOptional } from '@/lib/server-api';
import { formatDateTime, formatRelative, titleCase } from '@/lib/format';

export const metadata: Metadata = { title: 'Activity', robots: { index: false, follow: false } };

interface NotificationRow {
  id: string;
  template: string;
  subject: string | null;
  channel: 'email' | 'sms' | 'whatsapp' | 'in_app';
  status: 'queued' | 'sent' | 'failed';
  createdAt: string;
}

const CHANNEL_ICONS = {
  email: Mail,
  sms: MessageSquare,
  whatsapp: MessageSquare,
  in_app: Bell,
} as const;

/** Everything the platform has sent this account — verification, billing, trial reminders. */
export default async function ActivityPage() {
  const notifications = (await serverGetOptional<NotificationRow[]>('/api/v1/client/notifications')) ?? [];

  return (
    <>
      <PageHeader
        title="Activity"
        description="Every message we have sent you about your account and store."
      />

      {notifications.length === 0 ? (
        <EmptyState
          icon={Send}
          title="Nothing sent yet"
          description="Verification, billing and trial reminder emails will be listed here."
        />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <ul className="divide-y divide-border">
              {notifications.map((item) => {
                const Icon = CHANNEL_ICONS[item.channel] ?? Bell;
                return (
                  <li key={item.id} className="flex items-start gap-3 px-4 py-3.5 sm:px-6">
                    <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <Icon className="size-4.5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{item.subject ?? titleCase(item.template)}</p>
                      <p className="text-xs text-muted-foreground">
                        {titleCase(item.channel)} · {formatDateTime(item.createdAt)}
                      </p>
                    </div>
                    <div className="shrink-0 space-y-1 text-right">
                      <StatusBadge status={item.status} />
                      <p className="text-[11px] text-muted-foreground">{formatRelative(item.createdAt)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">
        Not receiving emails? Check your spam folder, or{' '}
        <Link href="/dashboard/support" className="text-primary hover:underline">
          open a support ticket
        </Link>
        .
      </p>
    </>
  );
}

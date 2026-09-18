'use client';

import { Eye } from 'lucide-react';
import type { ListMeta } from '@/lib/api';
import { useInfiniteList } from '@/hooks/use-infinite-list';
import { useViewTarget } from '@/hooks/use-detail';
import type { ContactMessageRow } from '@/lib/types';
import { useT } from '@/lib/i18n';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { InfiniteStack } from './infinite-table';
import { MessageDetail } from './message-detail';

/**
 * The contact-form inbox. Cards rather than table rows, so it uses
 * `InfiniteStack` — same cursor batching, same measured virtualisation, no
 * columns to keep in step.
 *
 * The card already shows the whole message, so the eye is not here to reveal
 * prose. It opens the two things the card leaves out: the address the form was
 * submitted from, and whether the sender has an account on this store.
 */
export function MessageList({
  initial,
  query,
  filtered,
}: {
  initial: { rows: ContactMessageRow[]; meta: ListMeta };
  query: Record<string, string | undefined>;
  filtered: boolean;
}) {
  const t = useT();
  const list = useInfiniteList<ContactMessageRow>({
    path: '/api/v1/admin/contact-messages',
    query,
    initial,
  });

  /** One panel for the whole list; a card's button names which record it shows. */
  const viewing = useViewTarget<ContactMessageRow>();

  return (
    <>
      <InfiniteStack
        rows={list.rows}
        total={list.total}
        noun="message"
        hasMore={list.hasMore}
        loading={list.loading}
        error={list.error}
        onLoadMore={list.loadMore}
        onRetry={list.retry}
        estimateRowHeight={180}
        empty={filtered ? t('No message matches that filter.') : t('No messages yet.')}
        render={(row) => (
          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {row.subject || t('No subject')}
                    {row.status === 'new' ? (
                      <Badge variant="info" className="ml-2">
                        {t('New')}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {row.name} ·{' '}
                    <a href={`mailto:${row.email}`} className="hover:underline">
                      {row.email}
                    </a>
                    {row.phone ? ` · ${row.phone}` : ''}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t.dateTime(row.createdAt)}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('View the message from {name}', { name: row.name })}
                    onClick={() => viewing.view(row)}
                  >
                    <Eye />
                  </Button>
                </div>
              </div>

              <p className="text-sm whitespace-pre-wrap">{row.message}</p>
            </CardContent>
          </Card>
        )}
      />

      <MessageDetail row={viewing.row} open={viewing.open} onOpenChange={viewing.onOpenChange} />
    </>
  );
}

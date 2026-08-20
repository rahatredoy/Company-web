'use client';

import Link from 'next/link';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDetail } from '@/hooks/use-detail';
import { formatDateTime, titleCase } from '@/lib/format';
import type { SubscriberRow, SubscriberView } from '@/lib/types';
import { DetailBool, DetailField, DetailGrid, DetailId, DetailSection, DetailSheet } from './detail-sheet';

/**
 * One address on the mailing list.
 *
 * A short record, and the panel is here because two of its fields decide whether
 * anything may be sent at all. `status` is the instruction — an unsubscribe
 * marks the row rather than deleting it, precisely so a later import cannot
 * silently re-add somebody who asked to be left alone. And a row that names a
 * `customer_id` is a shopper with an account, whose own `accepts_marketing` flag
 * is a second answer to the same question; the two are shown together because
 * they can disagree.
 *
 * `unsubscribe_token_hash` is the one column the API refuses to send. It is the
 * secret in the unsubscribe link, and displaying it would hand whoever is
 * reading the screen the ability to unsubscribe that address. Whether one exists
 * is reported instead.
 */
export function SubscriberDetail({
  row,
  open,
  onOpenChange,
}: {
  row: SubscriberRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = useDetail<SubscriberView>({
    path: '/api/v1/admin/newsletter',
    id: row?.id ?? null,
    enabled: open,
  });

  const subscriber = detail.data;

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={subscriber?.email ?? row?.email ?? 'Subscriber'}
      subtitle={subscriber?.source ? `Signed up from ${titleCase(subscriber.source)}` : undefined}
      badge={<StatusBadge status={subscriber?.status ?? row?.status ?? 'subscribed'} />}
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
    >
      {subscriber ? (
        <div className="space-y-6">
          <DetailSection title="Subscription">
            <DetailGrid className="sm:grid-cols-1">
              <DetailField label="Email" value={subscriber.email} />
              <DetailField label="Status" value={<StatusBadge status={subscriber.status} />} />
              <DetailField label="Where from" value={subscriber.source ? titleCase(subscriber.source) : null} />
              <DetailField label="Signed up" value={formatDateTime(subscriber.subscribedAt)} />
              <DetailField
                label="Unsubscribed"
                value={formatDateTime(subscriber.unsubscribedAt)}
                hint={
                  subscriber.status === 'unsubscribed'
                    ? 'The row is kept so a later signup cannot silently re-add them.'
                    : undefined
                }
              />
              <DetailField
                label="Unsubscribe link issued"
                value={<DetailBool value={subscriber.hasUnsubscribeToken} />}
                hint="The token itself is stored hashed and is never shown."
              />
              <DetailField label="Subscriber ID" value={<DetailId value={subscriber.id} />} />
            </DetailGrid>
          </DetailSection>

          <DetailSection
            title="Account"
            description="An address on this list may or may not belong to a shopper with an account."
          >
            {subscriber.customerId ? (
              <DetailGrid className="sm:grid-cols-1">
                <DetailField
                  label="Customer"
                  value={
                    <Link href={`/customers/${subscriber.customerId}`} className="hover:underline">
                      {subscriber.customerName ?? subscriber.customerEmail ?? 'Open account'}
                    </Link>
                  }
                />
                <DetailField label="Account email" value={subscriber.customerEmail} />
                <DetailField
                  label="Account status"
                  value={subscriber.customerStatus ? <StatusBadge status={subscriber.customerStatus} /> : null}
                />
                <DetailField
                  label="Account marketing consent"
                  value={<DetailBool value={subscriber.acceptsMarketing} />}
                  hint="Separate from the list status above; the two can disagree."
                />
                <DetailField label="Account ID" value={<DetailId value={subscriber.customerId} />} />
              </DetailGrid>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                An address only — no account on this store.
              </p>
            )}
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}

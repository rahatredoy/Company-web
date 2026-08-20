'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDetail } from '@/hooks/use-detail';
import { formatDate, formatDateTime, formatNumber } from '@/lib/format';
import type { ContactMessageRow, ContactMessageView } from '@/lib/types';
import {
  DetailField,
  DetailGrid,
  DetailId,
  DetailProse,
  DetailSection,
  DetailSheet,
} from './detail-sheet';

/**
 * One message from the storefront's contact form.
 *
 * The list card already shows the whole message — this is not a case of hidden
 * prose. What it adds is the two things the card deliberately leaves out:
 * `ip_address`, which is what separates one person writing twice from a form
 * being scripted, and whether the sender has an account on this store.
 *
 * That account is a **lookup by email, not a link**. The contact form does not
 * require signing in and the message stores no `customer_id`, so an address that
 * matches an account today may not have belonged to one when the message was
 * sent. The panel says so rather than presenting it as a relation.
 */
export function MessageDetail({
  row,
  open,
  onOpenChange,
}: {
  row: ContactMessageRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const detail = useDetail<ContactMessageView>({
    path: '/api/v1/admin/contact-messages',
    id: row?.id ?? null,
    enabled: open,
  });

  const message = detail.data;

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={message?.subject || row?.subject || 'No subject'}
      subtitle={message ? `${message.name} · ${message.email}` : row?.name}
      badge={<StatusBadge status={message?.status ?? row?.status ?? 'new'} />}
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
      footer={
        message ? (
          <Button asChild variant="outline" size="sm">
            <a href={`mailto:${message.email}?subject=${encodeURIComponent(`Re: ${message.subject ?? ''}`)}`}>
              Reply by email
            </a>
          </Button>
        ) : null
      }
    >
      {message ? (
        <div className="space-y-6">
          <DetailSection title="Message">
            <DetailProse>{message.message}</DetailProse>
          </DetailSection>

          <DetailSection title="Who sent it">
            <DetailGrid>
              <DetailField label="Name" value={message.name} />
              <DetailField
                label="Email"
                value={
                  <a href={`mailto:${message.email}`} className="hover:underline">
                    {message.email}
                  </a>
                }
              />
              <DetailField label="Phone" value={message.phone} />
              <DetailField label="Subject" value={message.subject} />
              <DetailField
                label="Sent from"
                value={message.ipAddress}
                mono
                hint="Recorded by the form. The same address writing repeatedly is worth noticing."
              />
              <DetailField label="Received" value={formatDateTime(message.createdAt)} />
              <DetailField label="Status" value={<StatusBadge status={message.status} />} />
              <DetailField label="Replied" value={formatDateTime(message.repliedAt)} />
              <DetailField label="Message ID" value={<DetailId value={message.id} />} />
            </DetailGrid>
          </DetailSection>

          <DetailSection
            title="Account with this address"
            description="Matched by email. The form does not require signing in, so this is a lookup rather than a link."
          >
            {message.account ? (
              <DetailGrid>
                <DetailField
                  label="Customer"
                  value={
                    <Link href={`/customers/${message.account.id}`} className="hover:underline">
                      {message.account.fullName}
                    </Link>
                  }
                />
                <DetailField label="Status" value={<StatusBadge status={message.account.status} />} />
                <DetailField label="Orders placed" value={formatNumber(message.account.orderCount)} />
                <DetailField label="Registered" value={formatDate(message.account.createdAt)} />
              </DetailGrid>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                No account on this store uses that address.
              </p>
            )}
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}

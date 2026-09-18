'use client';

import Link from 'next/link';
import { Star } from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDetail } from '@/hooks/use-detail';
import { titleCase } from '@/lib/format';
import type { ReviewRow, ReviewView } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useT, type MessageKey } from '@/lib/i18n';
import {
  DetailBool,
  DetailEmpty,
  DetailField,
  DetailGrid,
  DetailId,
  DetailProse,
  DetailSection,
  DetailSheet,
} from './detail-sheet';
import { LazyImage } from './lazy-image';

const STATUS_LABELS: Record<ReviewView['status'], MessageKey> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

const PRODUCT_STATUS_LABELS: Record<ReviewView['productStatus'], MessageKey> = {
  draft: 'Draft',
  active: 'Active',
  inactive: 'Inactive',
};

/**
 * One review, as the moderator needs to see it.
 *
 * The list shows eight of the row's twenty columns, which is right for scanning
 * a queue and wrong for deciding one. What decides a review is usually the part
 * the list truncates — the whole body, the photographs, and whether the person
 * writing it actually bought the thing. The moderation trail is here for the
 * same reason: a review that was approved and is now pending was changed by
 * somebody, and `moderated_by` / `moderated_at` is the only record of it.
 */
export function ReviewDetail({
  row,
  open,
  onOpenChange,
}: {
  row: ReviewRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const detail = useDetail<ReviewView>({
    path: '/api/v1/admin/reviews',
    id: row?.id ?? null,
    enabled: open,
  });

  const review = detail.data;
  const rating = review?.rating ?? row?.rating ?? 0;

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={review?.customerName ?? row?.customerName ?? t('Review')}
      subtitle={review?.productName ?? row?.productName}
      badge={
        <>
          <StatusBadge
            status={review?.status ?? row?.status ?? 'pending'}
            label={t(STATUS_LABELS[review?.status ?? row?.status ?? 'pending'])}
          />
          {(review?.verifiedPurchase ?? row?.verifiedPurchase) ? (
            <StatusBadge status="verified" label={t('Verified purchase')} />
          ) : null}
        </>
      }
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
    >
      {review ? (
        <div className="space-y-6">
          <DetailSection title={t('Rating')}>
            <div className="flex items-center gap-2">
              <span className="flex" aria-label={t('{rating} out of 5', { rating })}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star
                    key={star}
                    aria-hidden
                    className={cn(
                      'size-5',
                      star <= rating ? 'fill-warning text-warning' : 'text-muted-foreground/40',
                    )}
                  />
                ))}
              </span>
              <span className="text-sm font-medium">{t('{rating} / 5', { rating })}</span>
            </div>
          </DetailSection>

          <DetailSection title={t('What they wrote')}>
            {review.body ? <DetailProse>{review.body}</DetailProse> : <DetailEmpty>{t('Rating only.')}</DetailEmpty>}
          </DetailSection>

          {review.images.length > 0 ? (
            <DetailSection
              title={t('Photographs')}
              action={<span className="text-xs text-muted-foreground">{t.number(review.images.length)}</span>}
            >
              <div className="flex flex-wrap gap-2">
                {review.images.map((image) => (
                  <a key={image.id} href={image.url} target="_blank" rel="noreferrer">
                    <LazyImage
                      src={image.url}
                      alt=""
                      className="size-24 rounded-lg border border-border bg-muted"
                      fallback={<span className="text-[10px] text-muted-foreground">—</span>}
                    />
                  </a>
                ))}
              </div>
            </DetailSection>
          ) : null}

          <DetailSection title={t('Who wrote it')}>
            <DetailGrid>
              <DetailField
                label={t('Signed as')}
                value={review.customerName}
                hint={t('A snapshot taken when it was written.')}
              />
              <DetailField
                label={t('Account')}
                value={
                  review.customerId ? (
                    <Link href={`/customers?view=${review.customerId}`} className="hover:underline">
                      {review.customerEmail ?? t('Open account')}
                    </Link>
                  ) : null
                }
                hint={review.customerId ? undefined : t('The account has since been deleted.')}
              />
              <DetailField
                label={t('Account status')}
                value={
                  review.customerStatus ? (
                    <StatusBadge status={review.customerStatus} label={t.loose(titleCase(review.customerStatus))} />
                  ) : null
                }
              />
              <DetailField label={t('Verified purchase')} value={<DetailBool value={review.verifiedPurchase} />} />
              <DetailField
                label={t('From order')}
                value={
                  review.orderId ? (
                    <Link href={`/orders?view=${review.orderId}`} className="font-mono text-[12px] hover:underline">
                      {review.orderNumber ?? t('Open order')}
                    </Link>
                  ) : null
                }
              />
              <DetailField label={t('Found helpful by')} value={t.number(review.helpfulCount)} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title={t('Product')}>
            <DetailGrid>
              <DetailField
                label={t('Name')}
                value={
                  <Link href={`/products/${review.productId}`} className="hover:underline">
                    {review.productName}
                  </Link>
                }
              />
              <DetailField label={t('Address')} value={review.productSlug} mono />
              <DetailField
                label={t('Product status')}
                value={
                  <StatusBadge status={review.productStatus} label={t(PRODUCT_STATUS_LABELS[review.productStatus])} />
                }
              />
              <DetailField label={t('Product ID')} value={<DetailId value={review.productId} />} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title={t("Shop's reply")} description={t('Published under the review on the storefront.')}>
            {review.adminReply ? (
              <div className="space-y-1">
                <DetailProse>{review.adminReply}</DetailProse>
                <p className="text-xs text-muted-foreground">
                  {t('Sent {date}', { date: t.dateTime(review.adminRepliedAt) })}
                </p>
              </div>
            ) : (
              <DetailEmpty>{t('No reply.')}</DetailEmpty>
            )}
          </DetailSection>

          <DetailSection title={t('Moderation')}>
            <DetailGrid>
              <DetailField
                label={t('Status')}
                value={<StatusBadge status={review.status} label={t(STATUS_LABELS[review.status])} />}
              />
              <DetailField label={t('Decided')} value={t.dateTime(review.moderatedAt)} />
              <DetailField label={t('Decided by')} value={<DetailId value={review.moderatedBy} />} />
              <DetailField label={t('Review ID')} value={<DetailId value={review.id} />} />
              <DetailField label={t('Written')} value={t.dateTime(review.createdAt)} />
              <DetailField label={t('Last changed')} value={t.dateTime(review.updatedAt)} />
            </DetailGrid>
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}

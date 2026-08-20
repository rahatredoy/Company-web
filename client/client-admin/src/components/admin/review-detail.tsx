'use client';

import Link from 'next/link';
import { Star } from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDetail } from '@/hooks/use-detail';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { ReviewRow, ReviewView } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  DetailBool,
  DetailEmpty,
  DetailField,
  DetailGrid,
  DetailId,
  DetailProse,
  DetailSection,
  DetailSheet,
  DetailStorefrontLink,
} from './detail-sheet';
import { LazyImage } from './lazy-image';

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
  storefrontBase,
}: {
  row: ReviewRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storefrontBase: string | null;
}) {
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
      title={review?.customerName ?? row?.customerName ?? 'Review'}
      subtitle={review?.productName ?? row?.productName}
      badge={
        <>
          <StatusBadge status={review?.status ?? row?.status ?? 'pending'} />
          {(review?.verifiedPurchase ?? row?.verifiedPurchase) ? (
            <StatusBadge status="verified" label="Verified purchase" />
          ) : null}
        </>
      }
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
      footer={
        storefrontBase && (review?.productSlug ?? row?.productSlug) ? (
          <DetailStorefrontLink
            href={`${storefrontBase}/product/${review?.productSlug ?? row?.productSlug}`}
            label="View the product"
          />
        ) : null
      }
    >
      {review ? (
        <div className="space-y-6">
          <DetailSection title="Rating">
            <div className="flex items-center gap-2">
              <span className="flex" aria-label={`${rating} out of 5`}>
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
              <span className="text-sm font-medium">{rating} / 5</span>
            </div>
          </DetailSection>

          <DetailSection title="What they wrote">
            {review.body ? <DetailProse>{review.body}</DetailProse> : <DetailEmpty>Rating only.</DetailEmpty>}
          </DetailSection>

          {review.images.length > 0 ? (
            <DetailSection
              title="Photographs"
              action={<span className="text-xs text-muted-foreground">{review.images.length}</span>}
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

          <DetailSection title="Who wrote it">
            <DetailGrid>
              <DetailField
                label="Signed as"
                value={review.customerName}
                hint="A snapshot taken when it was written."
              />
              <DetailField
                label="Account"
                value={
                  review.customerId ? (
                    <Link href={`/customers/${review.customerId}`} className="hover:underline">
                      {review.customerEmail ?? 'Open account'}
                    </Link>
                  ) : null
                }
                hint={review.customerId ? undefined : 'The account has since been deleted.'}
              />
              <DetailField
                label="Account status"
                value={review.customerStatus ? <StatusBadge status={review.customerStatus} /> : null}
              />
              <DetailField label="Verified purchase" value={<DetailBool value={review.verifiedPurchase} />} />
              <DetailField
                label="From order"
                value={
                  review.orderId ? (
                    <Link href={`/orders/${review.orderId}`} className="font-mono text-[13px] hover:underline">
                      {review.orderNumber ?? 'Open order'}
                    </Link>
                  ) : null
                }
              />
              <DetailField label="Found helpful by" value={formatNumber(review.helpfulCount)} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Product">
            <DetailGrid>
              <DetailField
                label="Name"
                value={
                  <Link href={`/products/${review.productId}`} className="hover:underline">
                    {review.productName}
                  </Link>
                }
              />
              <DetailField label="Address" value={review.productSlug} mono />
              <DetailField label="Product status" value={<StatusBadge status={review.productStatus} />} />
              <DetailField label="Product ID" value={<DetailId value={review.productId} />} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Shop's reply" description="Published under the review on the storefront.">
            {review.adminReply ? (
              <div className="space-y-1">
                <DetailProse>{review.adminReply}</DetailProse>
                <p className="text-xs text-muted-foreground">
                  Sent {formatDateTime(review.adminRepliedAt)}
                </p>
              </div>
            ) : (
              <DetailEmpty>No reply.</DetailEmpty>
            )}
          </DetailSection>

          <DetailSection title="Moderation">
            <DetailGrid>
              <DetailField label="Status" value={<StatusBadge status={review.status} />} />
              <DetailField label="Decided" value={formatDateTime(review.moderatedAt)} />
              <DetailField label="Decided by" value={<DetailId value={review.moderatedBy} />} />
              <DetailField label="Review ID" value={<DetailId value={review.id} />} />
              <DetailField label="Written" value={formatDateTime(review.createdAt)} />
              <DetailField label="Last changed" value={formatDateTime(review.updatedAt)} />
            </DetailGrid>
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}

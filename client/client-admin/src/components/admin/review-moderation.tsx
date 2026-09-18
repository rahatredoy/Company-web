'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, Eye, MessageSquare, Star, Trash2, X } from 'lucide-react';
import type { ReviewRow } from '@/lib/types';
import { api, errorMessage, type ListMeta } from '@/lib/api';
import { useInfiniteList } from '@/hooks/use-infinite-list';
import { useViewTarget } from '@/hooks/use-detail';
import { InfiniteStack } from './infinite-table';
import { ReviewDetail } from './review-detail';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { toast } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { useT, type MessageKey } from '@/lib/i18n';

const STATUS_LABELS: Record<ReviewRow['status'], MessageKey> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
};

function Stars({ rating }: { rating: number }) {
  const t = useT();
  return (
    <span className="flex gap-0.5" aria-label={t('{rating} out of 5', { rating })}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn('size-3.5', n <= rating ? 'fill-warning text-warning' : 'text-border')}
          aria-hidden
        />
      ))}
    </span>
  );
}

/**
 * The moderation queue.
 *
 * A review is invisible on the storefront until it is approved — the read
 * endpoint filters on `status = 'approved'` and nothing else — so these three
 * buttons are the whole of what a shopper eventually sees. Approving and
 * rejecting both recompute the product's rating from the approved rows, which is
 * why a rejection changes the star average as well as the list.
 */
export function ReviewModeration({
  initial,
  query,
  canManage,
  filtered,
}: {
  /** The first batch, rendered on the server. The rest arrive by cursor. */
  initial: { rows: ReviewRow[]; meta: ListMeta };
  query: Record<string, string | undefined>;
  canManage: boolean;
  filtered: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const list = useInfiniteList<ReviewRow>({ path: '/api/v1/admin/reviews', query, initial });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const [replying, setReplying] = React.useState<ReviewRow | null>(null);
  /*
   * The read-only panel. The card here already shows the body, so this is for
   * the twelve columns it does not: the photographs, the moderation trail, the
   * order that made it a verified purchase, and who wrote it.
   */
  const viewing = useViewTarget<ReviewRow>();
  const [saving, setSaving] = React.useState(false);

  // i18n-ignore — a type, not copy.
  const act = async (review: ReviewRow, run: () => Promise<unknown>, message: string) => {
    setBusy(review.id);
    setError('');

    try {
      await run();
      toast.success(message);
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(null);
    }
  };

  const onReply = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!replying || saving) return;

    const value = String(new FormData(event.currentTarget).get('adminReply') ?? '').trim();
    setSaving(true);

    try {
      await api.patch(`/api/v1/admin/reviews/${replying.id}/reply`, { adminReply: value || null });
      setReplying(null);
      toast.success(t('Reply saved.'));
      router.refresh();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {error ? <Alert variant="danger">{error}</Alert> : null}

      <InfiniteStack
        rows={list.rows}
        total={list.total}
        noun="review"
        hasMore={list.hasMore}
        loading={list.loading}
        error={list.error}
        onLoadMore={list.loadMore}
        onRetry={list.retry}
        estimateRowHeight={200}
        gap={16}
        empty={filtered ? t('Nothing matches those filters.') : t('No reviews yet.')}
        render={(review) => (
          <div className="rounded-lg border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Stars rating={review.rating} />
                <span className="font-medium">{review.customerName}</span>
                {review.verifiedPurchase ? (
                  <StatusBadge status="verified" label={t('Verified purchase')} />
                ) : null}
                <StatusBadge status={review.status} label={t(STATUS_LABELS[review.status])} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {review.productName} · {t.date(review.createdAt)}
              </p>
            </div>

            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('View the review by {name}', { name: review.customerName })}
              onClick={() => viewing.view(review)}
            >
              <Eye />
            </Button>
          </div>

          {review.body ? <p className="mt-3 text-sm leading-relaxed">{review.body}</p> : null}

          {review.adminReply ? (
            <p className="mt-3 rounded-md bg-muted p-3 text-sm">
              <span className="font-medium">{t('Your reply:')} </span>
              {review.adminReply}
            </p>
          ) : null}

          {canManage ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {review.status !== 'approved' ? (
                <Button
                  size="sm"
                  disabled={busy !== null}
                  loading={busy === review.id}
                  onClick={() =>
                    act(
                      review,
                      () => api.patch(`/api/v1/admin/reviews/${review.id}`, { status: 'approved' }),
                      t('Review published.'),
                    )
                  }
                >
                  <Check aria-hidden /> {t('Approve')}
                </Button>
              ) : null}

              {review.status !== 'rejected' ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy !== null}
                  onClick={() =>
                    act(
                      review,
                      () => api.patch(`/api/v1/admin/reviews/${review.id}`, { status: 'rejected' }),
                      t('Review rejected and hidden.'),
                    )
                  }
                >
                  <X aria-hidden /> {t('Reject')}
                </Button>
              ) : null}

              <Button size="sm" variant="ghost" onClick={() => setReplying(review)}>
                <MessageSquare aria-hidden /> {review.adminReply ? t('Edit reply') : t('Reply')}
              </Button>

              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => {
                  if (!window.confirm(t('Delete this review permanently?'))) return;
                  void act(
                    review,
                    () => api.delete(`/api/v1/admin/reviews/${review.id}`),
                    t('Review deleted.'),
                  );
                }}
              >
                <Trash2 aria-hidden /> {t('Delete')}
              </Button>
            </div>
          ) : null}
          </div>
        )}
      />

      <ReviewDetail
        row={viewing.row}
        open={viewing.open}
        onOpenChange={viewing.onOpenChange}
      />

      <Dialog open={replying !== null} onOpenChange={(open) => !open && setReplying(null)}>
        <DialogContent>
          <form onSubmit={onReply}>
            <DialogHeader>
              <DialogTitle>{t('Reply publicly')}</DialogTitle>
              <DialogDescription>
                {t(
                  'Your answer appears under the review on the product page. Leave it empty to remove an existing reply.',
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <Field label={t('Your reply')} htmlFor="adminReply">
                <Textarea
                  id="adminReply"
                  name="adminReply"
                  rows={5}
                  maxLength={2000}
                  defaultValue={replying?.adminReply ?? ''}
                />
              </Field>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setReplying(null)}>
                {t('Cancel')}
              </Button>
              <Button type="submit" loading={saving}>
                {t('Save reply')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

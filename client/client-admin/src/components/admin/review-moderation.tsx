'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, MessageSquare, Star, Trash2, X } from 'lucide-react';
import type { ReviewRow } from '@/lib/types';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
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

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex gap-0.5" aria-label={`${rating} out of 5`}>
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
export function ReviewModeration({ rows, canManage }: { rows: ReviewRow[]; canManage: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState('');
  const [replying, setReplying] = React.useState<ReviewRow | null>(null);
  const [saving, setSaving] = React.useState(false);

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
      toast.success('Reply saved.');
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

      <ul className="space-y-4">
        {rows.map((review) => (
          <li key={review.id} className="rounded-lg border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Stars rating={review.rating} />
                  <span className="font-medium">{review.customerName}</span>
                  {review.verifiedPurchase ? (
                    <StatusBadge status="verified" label="Verified purchase" />
                  ) : null}
                  <StatusBadge status={review.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {review.productName} · {formatDate(review.createdAt)}
                </p>
              </div>
            </div>

            {review.body ? <p className="mt-3 text-sm leading-relaxed">{review.body}</p> : null}

            {review.adminReply ? (
              <p className="mt-3 rounded-md bg-muted p-3 text-sm">
                <span className="font-medium">Your reply: </span>
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
                        'Review published.',
                      )
                    }
                  >
                    <Check aria-hidden /> Approve
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
                        'Review rejected and hidden.',
                      )
                    }
                  >
                    <X aria-hidden /> Reject
                  </Button>
                ) : null}

                <Button size="sm" variant="ghost" onClick={() => setReplying(review)}>
                  <MessageSquare aria-hidden /> {review.adminReply ? 'Edit reply' : 'Reply'}
                </Button>

                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  onClick={() => {
                    if (!window.confirm('Delete this review permanently?')) return;
                    void act(
                      review,
                      () => api.delete(`/api/v1/admin/reviews/${review.id}`),
                      'Review deleted.',
                    );
                  }}
                >
                  <Trash2 aria-hidden /> Delete
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <Dialog open={replying !== null} onOpenChange={(open) => !open && setReplying(null)}>
        <DialogContent>
          <form onSubmit={onReply}>
            <DialogHeader>
              <DialogTitle>Reply publicly</DialogTitle>
              <DialogDescription>
                Your answer appears under the review on the product page. Leave it empty to remove an
                existing reply.
              </DialogDescription>
            </DialogHeader>

            <div className="py-4">
              <Field label="Your reply" htmlFor="adminReply">
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
                Cancel
              </Button>
              <Button type="submit" loading={saving}>
                Save reply
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

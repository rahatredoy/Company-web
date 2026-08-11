import { BadgeCheck } from 'lucide-react';
import type { Review, ReviewSummary } from '@/types';
import { RatingStars } from '@/components/commerce/rating-stars';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate, initials, pluralise } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { WriteReviewDialog } from './write-review-dialog';

/**
 * Reviews: the summary, the histogram, and the reviews themselves.
 *
 * A Server Component — reviews are content, they are indexable, and nothing
 * about reading them needs JavaScript. Only the write form is a client island.
 */

export function ReviewSummaryPanel({
  summary,
  productSlug,
}: {
  summary: ReviewSummary;
  productSlug: string;
}) {
  const total = summary.distribution.reduce((sum, count) => sum + count, 0);

  return (
    <div className="rounded-(--radius-card) border border-border bg-surface p-6">
      <div className="flex items-baseline gap-3">
        <p className="text-4xl font-bold tabular-nums">{summary.average.toFixed(1)}</p>
        <div>
          <RatingStars rating={summary.average} size="sm" />
          <p className="mt-1 text-xs text-subtle">
            {summary.count} {pluralise(summary.count, 'review')}
          </p>
        </div>
      </div>

      {/* Five to one, top down — the order everyone reads a histogram in. */}
      <ul className="mt-6 space-y-1.5">
        {[5, 4, 3, 2, 1].map((stars) => {
          const count = summary.distribution[stars - 1] ?? 0;
          const percent = total > 0 ? Math.round((count / total) * 100) : 0;

          return (
            <li key={stars} className="flex items-center gap-2 text-xs">
              <span className="w-8 shrink-0 tabular-nums text-subtle">{stars} ★</span>

              <span
                className="h-2 flex-1 overflow-hidden rounded-full bg-surface-alt"
                role="img"
                aria-label={`${stars} stars: ${percent}% of reviews`}
              >
                <span
                  className="block h-full rounded-full bg-star"
                  style={{ width: `${percent}%` }}
                />
              </span>

              <span className="w-9 shrink-0 text-right tabular-nums text-subtle">{percent}%</span>
            </li>
          );
        })}
      </ul>

      <WriteReviewDialog productSlug={productSlug} className="mt-6 w-full" />
    </div>
  );
}

export function ReviewList({
  reviews,
  locale,
  className,
}: {
  reviews: Review[];
  locale: string;
  className?: string;
}) {
  if (reviews.length === 0) {
    return (
      <EmptyState
        title="No reviews yet"
        description="Be the first to tell other shoppers what you thought of this."
        className="rounded-(--radius-card) border border-dashed border-border py-12"
      />
    );
  }

  return (
    <ul className={cn('divide-y divide-border', className)}>
      {reviews.map((review) => (
        <li key={review.id} className="py-6 first:pt-0">
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-alt text-xs font-semibold text-muted"
            >
              {initials(review.customerName)}
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-sm font-medium">{review.customerName}</p>
                {review.verifiedPurchase ? (
                  <Badge tone="success" size="sm">
                    <BadgeCheck className="size-3" aria-hidden />
                    Verified purchase
                  </Badge>
                ) : null}
                <time dateTime={review.createdAt} className="text-xs text-subtle">
                  {formatDate(review.createdAt, locale)}
                </time>
              </div>

              <RatingStars rating={review.rating} size="xs" className="mt-1.5" />

              {review.body ? (
                <p className="mt-2 text-sm leading-relaxed text-muted">{review.body}</p>
              ) : null}

              {review.adminReply ? (
                <div className="mt-3 rounded-(--radius-button) border-l-2 border-primary bg-surface-alt p-3">
                  <p className="text-xs font-semibold">Store response</p>
                  <p className="mt-1 text-sm text-muted">{review.adminReply}</p>
                </div>
              ) : null}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

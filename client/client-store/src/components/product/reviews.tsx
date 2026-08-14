import { BadgeCheck, ChevronDown } from 'lucide-react';
import type { Review, ReviewSummary } from '@/types';
import { RatingStars } from '@/components/commerce/rating-stars';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate, initials, pluralise } from '@/lib/utils';
import { cn } from '@/lib/utils';
import { WriteReviewDialog } from './write-review-dialog';

/**
 * Reviews: the summary and the reviews themselves.
 *
 * A Server Component — reviews are content, they are indexable, and nothing
 * about reading them needs JavaScript. Only the write form is a client island,
 * and "show all" is a `<details>` rather than state, so every review is in the
 * HTML whether or not it is on screen.
 *
 * There is no star histogram. It cost a whole sidebar to say what the average
 * and the count already say, and pushed the reviews themselves below the fold.
 */

/** How many reviews stand above the fold before the rest are folded away. */
const PREVIEW_COUNT = 2;

export function ReviewSummaryPanel({
  summary,
  productSlug,
  className,
}: {
  summary: ReviewSummary;
  productSlug: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-(--radius-card) border border-border bg-surface px-5 py-4',
        className,
      )}
    >
      <div className="flex items-center gap-3">
        <p className="text-3xl font-bold tabular-nums">{summary.average.toFixed(1)}</p>
        <div>
          <RatingStars rating={summary.average} size="sm" />
          <p className="mt-0.5 text-xs text-subtle">
            {summary.count} {pluralise(summary.count, 'review')}
          </p>
        </div>
      </div>

      <WriteReviewDialog productSlug={productSlug} className="shrink-0" />
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

  const preview = reviews.slice(0, PREVIEW_COUNT);
  const rest = reviews.slice(PREVIEW_COUNT);

  return (
    <div className={className}>
      <ul className="divide-y divide-border">
        {preview.map((review) => (
          <ReviewItem key={review.id} review={review} locale={locale} />
        ))}
      </ul>

      {rest.length > 0 ? (
        <details className="group border-t border-border">
          <summary className="flex cursor-pointer list-none items-center justify-center gap-2 py-3 text-sm font-medium text-primary hover:underline [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show all {reviews.length} reviews</span>
            <span className="hidden group-open:inline">Show fewer reviews</span>
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
          </summary>

          <ul className="divide-y divide-border border-t border-border">
            {rest.map((review) => (
              <ReviewItem key={review.id} review={review} locale={locale} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ReviewItem({ review, locale }: { review: Review; locale: string }) {
  return (
    <li className="py-5">
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
  );
}

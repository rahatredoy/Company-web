import Image from 'next/image';
import { Quote } from 'lucide-react';
import type { Testimonial } from '@/types';
import { RatingStars } from '@/components/commerce/rating-stars';
import { initials } from '@/lib/utils';
import { cn } from '@/lib/utils';

/**
 * Customer quotes.
 *
 * Renders nothing when the store has no testimonials — the fallback rule says
 * to hide an optional section rather than fill it with placeholders, and
 * invented praise on a shopfront is worse than an absent section.
 */
export function Testimonials({
  testimonials,
  className,
}: {
  testimonials: Testimonial[];
  className?: string;
}) {
  if (testimonials.length === 0) return null;

  return (
    <ul className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {testimonials.slice(0, 6).map((testimonial) => (
        <li
          key={testimonial.id}
          className="flex flex-col rounded-(--radius-card) border border-border bg-surface p-5"
        >
          <Quote className="size-6 text-accent" aria-hidden />

          {testimonial.rating !== null ? (
            <RatingStars rating={testimonial.rating} size="sm" className="mt-3" />
          ) : null}

          <blockquote className="mt-3 flex-1 text-sm leading-relaxed text-muted">
            {testimonial.quote}
          </blockquote>

          {/* An unattributed quote keeps the quote and loses the byline —
              inventing a name for it would be the one part of a testimonial a
              store must not make up. */}
          {testimonial.authorName ? (
            <figcaption className="mt-5 flex items-center gap-3">
              {testimonial.avatarUrl ? (
                <span className="relative size-9 shrink-0 overflow-hidden rounded-full">
                  <Image src={testimonial.avatarUrl} alt="" aria-hidden fill sizes="36px" className="object-cover" />
                </span>
              ) : (
                <span
                  aria-hidden
                  className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-semibold text-primary"
                >
                  {initials(testimonial.authorName)}
                </span>
              )}

              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{testimonial.authorName}</span>
                {testimonial.authorTitle ? (
                  <span className="block truncate text-xs text-subtle">{testimonial.authorTitle}</span>
                ) : null}
              </span>
            </figcaption>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

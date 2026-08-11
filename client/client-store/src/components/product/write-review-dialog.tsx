'use client';

import * as React from 'react';
import { PenLine, Star } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

/**
 * Write a review.
 *
 * The rating is a radio group styled as stars, not a row of buttons — arrow
 * keys move between values, the group has one tab stop, and every option has a
 * real accessible name. A star widget built from `<div onClick>` is unusable
 * without a mouse and is the most common accessibility failure on a product
 * page.
 *
 * Whether the review counts as a verified purchase is decided by the server
 * from the order history, never claimed here.
 *
 * There is no headline field: an optional one asked most people to invent a
 * summary of a review they had not written yet, and the rating already says in
 * one glance what a headline was there to say.
 */
export function WriteReviewDialog({
  productSlug,
  className,
}: {
  productSlug: string;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [rating, setRating] = React.useState(0);
  const [hovered, setHovered] = React.useState(0);
  const [body, setBody] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const reset = () => {
    setRating(0);
    setHovered(0);
    setBody('');
    setError(null);
  };

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (rating === 0) {
      setError('Please choose a rating.');
      return;
    }
    if (body.trim().length < 10) {
      setError('Please write at least a sentence so it is useful to other shoppers.');
      return;
    }

    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch(`/api/products/${encodeURIComponent(productSlug)}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, body: body.trim() }),
      });

      if (!response.ok) throw new Error('failed');

      setOpen(false);
      reset();
      toast.success('Thank you — your review has been submitted', {
        description: 'It will appear once our team has checked it over.',
      });
    } catch {
      setError('We could not submit your review just now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const shown = hovered || rating;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className={className}>
          <PenLine aria-hidden />
          Write a review
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Write a review</DialogTitle>
          <DialogDescription>
            Tell other shoppers what you thought. Reviews are checked before they appear.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-5" noValidate>
          <fieldset onMouseLeave={() => setHovered(0)}>
            <legend className="mb-2 text-sm font-medium">
              Your rating
              <span aria-hidden className="ml-0.5 text-error">
                *
              </span>
            </legend>

            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((value) => (
                <label
                  key={value}
                  onMouseEnter={() => setHovered(value)}
                  className="cursor-pointer p-1"
                >
                  <input
                    type="radio"
                    name="rating"
                    value={value}
                    checked={rating === value}
                    onChange={() => setRating(value)}
                    className="sr-only-focusable absolute size-0"
                  />
                  <span className="sr-only">
                    {value} {value === 1 ? 'star' : 'stars'}
                  </span>
                  <Star
                    aria-hidden
                    className={cn(
                      'size-7 transition-colors',
                      value <= shown ? 'fill-star text-star' : 'text-border-strong',
                    )}
                  />
                </label>
              ))}
            </div>
          </fieldset>

          <Field name="review-body" label="Your review" required>
            {(props) => (
              <Textarea
                {...props}
                value={body}
                rows={5}
                maxLength={2000}
                onChange={(event) => setBody(event.target.value)}
                placeholder="What did you like or dislike? How did it fit? Would you buy it again?"
              />
            )}
          </Field>

          {error ? (
            <p role="alert" className="text-sm font-medium text-error">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Spinner /> : null}
              Submit review
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

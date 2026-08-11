'use client';

import * as React from 'react';
import { Check, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * Share.
 *
 * Uses the Web Share API where the browser has it — on a phone that opens the
 * real share sheet, which is what someone actually wants. Everywhere else it
 * copies the URL, and says so.
 *
 * Both paths are inside a click handler because both require a user gesture,
 * and `navigator.share` rejects if called any other way.
 */
export function ShareButton({ title, className }: { title: string; className?: string }) {
  const [copied, setCopied] = React.useState(false);

  const onClick = async () => {
    const url = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch (error) {
        // A dismissed share sheet rejects with AbortError. That is the visitor
        // changing their mind, not a failure to report.
        if ((error as Error).name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Link copied to your clipboard');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy the link. Please copy it from the address bar.');
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Share ${title}`}
      className={cn(
        'grid size-11 place-items-center rounded-(--radius-button) border border-border-strong text-foreground transition-colors hover:bg-surface-alt',
        className,
      )}
    >
      {copied ? <Check className="size-4 text-success" aria-hidden /> : <Share2 className="size-4" aria-hidden />}
    </button>
  );
}

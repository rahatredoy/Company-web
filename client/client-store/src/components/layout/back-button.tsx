'use client';

import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

/**
 * Go back to wherever this visitor came from.
 *
 * It stands where the breadcrumb trails used to. "Home / Electronics" printed
 * above a page already headed Electronics answered nothing and cost the top of
 * every screen; the one question a trail did answer — how do I get out of here
 * — is answered here instead, from the one place that is on every page and
 * always in the same spot, so it needs no reading to find.
 *
 * Hidden on the home page, and hidden *deterministically*: `usePathname` is
 * rendered on the server as well, so the header is laid out correctly in the
 * first frame. Deciding from `window.history` instead would leave the logo to
 * shift sideways a frame after hydration, on every page.
 *
 * `history.length === 1` means the tab opened straight onto this page — a deep
 * link out of a search result or a shared URL — so there is nothing behind it.
 * Those visitors go home, because a control that visibly does nothing is worse
 * than one that goes somewhere useful.
 */
export function BackButton({ className }: { className?: string }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();

  if (pathname === '/') return null;

  return (
    <button
      type="button"
      aria-label={t('Go back')}
      title={t('Go back')}
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push('/');
      }}
      className={cn(
        'grid size-11 shrink-0 place-items-center rounded-(--radius-button) text-foreground transition-colors hover:bg-surface-alt',
        className,
      )}
    >
      <ChevronLeft className="size-5" aria-hidden />
    </button>
  );
}

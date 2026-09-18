'use client';

import * as React from 'react';
import { ArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

/**
 * Back-to-top button.
 *
 * Appears only after a screenful of scrolling — at the top of the page it is a
 * control that does nothing, and a permanently floating button on a phone is
 * one more thing covering the content.
 *
 * Sits above the mobile bottom bar rather than on top of it, and honours the
 * safe-area inset so it clears the home indicator on a modern phone.
 */
export function BackToTop({ enabled = true, offset = false }: { enabled?: boolean; offset?: boolean }) {
  const t = useT();
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    if (!enabled) return;

    const onScroll = () => setVisible(window.scrollY > window.innerHeight * 0.8);
    onScroll();

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label={t('Back to top')}
      // Hidden from the accessibility tree while off-screen, so a keyboard user
      // does not tab into an invisible control.
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      className={cn(
        'fixed right-5 z-30 grid size-11 place-items-center rounded-full',
        'bg-secondary text-secondary-foreground shadow-[var(--shadow-raised)]',
        'transition-all duration-200',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
        offset ? 'bottom-[calc(5.5rem+env(safe-area-inset-bottom))]' : 'bottom-20',
      )}
    >
      <ArrowUp className="size-5" aria-hidden />
    </button>
  );
}

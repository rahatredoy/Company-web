import type { StoreConfig } from '@/types';
import { cn } from '@/lib/utils';

/**
 * Floating WhatsApp contact button.
 *
 * Rendered only when the store has both switched it on and given a number —
 * a support button that opens a chat with nobody is worse than no button.
 *
 * The number is stripped to digits before it goes into the `wa.me` URL, because
 * the stored value is formatted for humans ("+880 1700 000000") and WhatsApp
 * wants an unpunctuated international number.
 *
 * Positioned above the mobile bottom bar so it never covers Add to Cart, which
 * is the one control on the page that must always be reachable.
 */
export function WhatsAppButton({
  contact,
  offset = false,
  message = 'Hello! I have a question about a product.',
}: {
  contact: StoreConfig['contact'];
  offset?: boolean;
  message?: string;
}) {
  if (!contact.whatsappEnabled || !contact.whatsappNumber) return null;

  const number = contact.whatsappNumber.replace(/\D/g, '');
  if (number.length < 8) return null;

  return (
    <a
      href={`https://wa.me/${number}?text=${encodeURIComponent(message)}`}
      target="_blank"
      rel="noreferrer noopener"
      aria-label="Chat with us on WhatsApp"
      className={cn(
        'fixed left-5 z-30 grid size-12 place-items-center rounded-full',
        'bg-[#25D366] text-white shadow-[var(--shadow-raised)]',
        'transition-transform hover:scale-105',
        offset ? 'bottom-[calc(5.5rem+env(safe-area-inset-bottom))]' : 'bottom-20',
      )}
    >
      {/* WhatsApp's mark is not in lucide; this is the glyph drawn inline. */}
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="size-6">
        <path d="M17.5 14.4c-.3-.2-1.8-.9-2-1-.3-.1-.5-.2-.7.1-.2.3-.7 1-.9 1.2-.2.2-.3.2-.6.1-1.6-.8-2.7-1.5-3.7-3.3-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5s-.7-1.6-.9-2.2c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5 4.4 1.9.8 2.6.9 3.5.8.6-.1 1.8-.7 2-1.4.3-.7.3-1.3.2-1.4-.1-.2-.3-.2-.6-.4M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2m0 18.2c-1.6 0-3.2-.4-4.6-1.3l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2" />
      </svg>
    </a>
  );
}

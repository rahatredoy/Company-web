import type { SocialLink } from '@/types';
import { cn } from '@/lib/utils';

/**
 * Social icon row, from the store's own profiles.
 *
 * The marks are inline SVG rather than icon-library components: lucide dropped
 * every brand glyph at v1, and pulling a second icon package in for eight
 * shapes would cost more than the shapes do.
 *
 * Destinations used to be the platforms' own homepages — `facebook.com`,
 * `instagram.com` — standing in until the config contract grew a `social`
 * block. It has one now, so a store with no profiles configured renders no row
 * at all: sending a customer to Facebook's front page is worse than not
 * offering the link.
 *
 * `platform` selects the glyph from this closed set. The store supplies a name
 * and a URL, never an image, so nothing here can pull a remote asset into the
 * footer of every page.
 */

type Glyph = (props: { className?: string }) => React.ReactElement;

const Facebook: Glyph = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
    <path d="M9 8H6v4h3v12h5V12h3.6l.4-4h-4V6.3c0-1 .2-1.3 1.1-1.3H18V0h-3.8C10.6 0 9 1.6 9 4.6V8Z" />
  </svg>
);

const Instagram: Glyph = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden className={className}>
    <rect x="2" y="2" width="20" height="20" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

const X: Glyph = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
    <path d="M18.9 1.2h3.7l-8 9.2L24 22.8h-7.4l-5.8-7.6-6.6 7.6H.5l8.6-9.9L0 1.2h7.6l5.2 6.9 6.1-6.9Zm-1.3 19.4h2L6.5 3.3H4.3l13.3 17.3Z" />
  </svg>
);

const YouTube: Glyph = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
    <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8ZM9.5 15.6V8.4l6.3 3.6-6.3 3.6Z" />
  </svg>
);

const TikTok: Glyph = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
    <path d="M16.5 1.5h-3.2v14.3a2.6 2.6 0 1 1-2.6-2.6c.3 0 .5 0 .8.1v-3.2a6 6 0 0 0-.8-.1 5.8 5.8 0 1 0 5.8 5.8V8.4a7 7 0 0 0 4.1 1.3V6.5a3.9 3.9 0 0 1-4.1-3.8V1.5Z" />
  </svg>
);

const LinkedIn: Glyph = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
    <path d="M4.98 3.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5ZM2.4 9.5h5.2V22H2.4V9.5Zm7.2 0h5v1.7a5.4 5.4 0 0 1 4.5-2.2c3.4 0 4.9 2.1 4.9 5.9V22h-5.2v-6c0-1.6-.6-2.6-2-2.6-1.2 0-1.9.8-2.2 1.6-.1.3-.1.7-.1 1V22H9.6V9.5Z" />
  </svg>
);

const Pinterest: Glyph = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
    <path d="M12 .5a11.5 11.5 0 0 0-4.2 22.2c-.1-.9-.2-2.3 0-3.3l1.4-5.9s-.3-.7-.3-1.8c0-1.7 1-3 2.2-3 1 0 1.5.8 1.5 1.7 0 1-.7 2.6-1 4-.3 1.2.6 2.2 1.8 2.2 2.1 0 3.7-2.3 3.7-5.5 0-2.9-2-4.9-5-4.9-3.4 0-5.4 2.5-5.4 5.1 0 1 .4 2.1.9 2.7.1.1.1.2.1.3l-.3 1.3c0 .2-.2.3-.4.2-1.5-.7-2.4-2.9-2.4-4.6 0-3.8 2.7-7.2 7.9-7.2 4.1 0 7.3 3 7.3 6.9 0 4.1-2.6 7.4-6.2 7.4-1.2 0-2.4-.6-2.8-1.4l-.7 2.9c-.3 1-1 2.3-1.5 3.1A11.5 11.5 0 1 0 12 .5Z" />
  </svg>
);

const WhatsApp: Glyph = ({ className }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
    <path d="M12 2a10 10 0 0 0-8.5 15.2L2 22l4.9-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-2.9.8.8-2.8-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.1-.2 0-.4.1-.5l.4-.5c.1-.2.1-.3 0-.5l-.7-1.7c-.2-.4-.4-.4-.5-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4c1.6.6 2 .5 2.4.5a2.5 2.5 0 0 0 1.7-1.2 2 2 0 0 0 .1-1.2l-.4-.2Z" />
  </svg>
);

/** Platform key → mark. A profile naming a key not in here is dropped. */
const GLYPHS: Record<string, { label: string; Glyph: Glyph }> = {
  facebook: { label: 'Facebook', Glyph: Facebook },
  instagram: { label: 'Instagram', Glyph: Instagram },
  x: { label: 'X', Glyph: X },
  youtube: { label: 'YouTube', Glyph: YouTube },
  tiktok: { label: 'TikTok', Glyph: TikTok },
  linkedin: { label: 'LinkedIn', Glyph: LinkedIn },
  pinterest: { label: 'Pinterest', Glyph: Pinterest },
  whatsapp: { label: 'WhatsApp', Glyph: WhatsApp },
};

export function SocialLinks({
  links,
  className,
  tone = 'muted',
}: {
  links: SocialLink[];
  className?: string;
  tone?: 'muted' | 'inherit';
}) {
  const known = links.filter((link) => GLYPHS[link.platform]);
  if (known.length === 0) return null;

  return (
    <ul className={cn('flex items-center gap-1', className)}>
      {known.map((link) => {
        const { label, Glyph } = GLYPHS[link.platform]!;

        return (
          <li key={link.platform}>
            {/*
              A bare `<a>`, not `next/link`: these leave the site, so there is
              no client-side route to prefetch or intercept.
            */}
            <a
              href={link.url}
              target="_blank"
              /* `noopener` on every outbound `target="_blank"`: without it the
                 opened page can reach back through `window.opener`. */
              rel="noreferrer noopener"
              aria-label={label}
              className={cn(
                'grid size-9 place-items-center rounded-full transition-colors',
                tone === 'muted'
                  ? 'text-muted hover:bg-surface-alt hover:text-primary'
                  : 'opacity-75 hover:opacity-100',
              )}
            >
              <Glyph className="size-4" />
            </a>
          </li>
        );
      })}
    </ul>
  );
}

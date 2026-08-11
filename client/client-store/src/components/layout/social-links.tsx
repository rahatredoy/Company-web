import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * Social icon row.
 *
 * The marks are inline SVG rather than icon-library components: lucide dropped
 * every brand glyph at v1, and pulling a second icon package in for four shapes
 * would cost more than the shapes do.
 *
 * Destinations are placeholders until `StoreConfig.contact` carries social
 * handles. Rather than invent a field and pretend it is wired, these point at
 * the platforms themselves and are one grep away when the contract grows a
 * `social` block.
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

const NETWORKS: { name: string; href: string; Glyph: Glyph }[] = [
  { name: 'Facebook', href: 'https://facebook.com', Glyph: Facebook },
  { name: 'Instagram', href: 'https://instagram.com', Glyph: Instagram },
  { name: 'X', href: 'https://x.com', Glyph: X },
  { name: 'YouTube', href: 'https://youtube.com', Glyph: YouTube },
];

export function SocialLinks({
  className,
  tone = 'muted',
}: {
  className?: string;
  tone?: 'muted' | 'inherit';
}) {
  return (
    <ul className={cn('flex items-center gap-1', className)}>
      {NETWORKS.map((network) => (
        <li key={network.name}>
          <Link
            href={network.href}
            target="_blank"
            /* `noopener` on every outbound `target="_blank"`: without it the
               opened page can reach back through `window.opener`. */
            rel="noreferrer noopener"
            aria-label={network.name}
            className={cn(
              'grid size-9 place-items-center rounded-full transition-colors',
              tone === 'muted'
                ? 'text-muted hover:bg-surface-alt hover:text-primary'
                : 'opacity-75 hover:opacity-100',
            )}
          >
            <network.Glyph className="size-4" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

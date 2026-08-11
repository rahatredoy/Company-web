import { cn } from '@/lib/utils';

/**
 * The store page's two pieces of art.
 *
 * Both are drawn inline against the theme tokens rather than shipped as images:
 * the CSP allows no external asset host, and one flat PNG would be wrong in one
 * of the two themes. Decorative only — every fact they illustrate is written
 * beside them in text.
 */

/** Before the store exists: a storefront being built on a screen. */
export function SetupIllustration({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 260 200" role="presentation" aria-hidden className={cn('w-[220px]', className)}>
      <circle cx="140" cy="96" r="92" className="fill-[var(--primary-soft)]" />

      {/* Desktop storefront */}
      <rect
        x="42"
        y="34"
        width="168"
        height="112"
        rx="10"
        className="fill-[var(--card)] stroke-[var(--border-strong)]"
        strokeWidth="2"
      />
      <path d="M42 52h168" className="stroke-[var(--border)]" strokeWidth="2" />
      <circle cx="56" cy="43" r="3" className="fill-[var(--border-strong)]" />
      <circle cx="67" cy="43" r="3" className="fill-[var(--border-strong)]" />
      <circle cx="78" cy="43" r="3" className="fill-[var(--border-strong)]" />

      <rect x="58" y="66" width="52" height="44" rx="6" className="fill-[var(--primary)]" opacity="0.16" />
      <path
        d="M74 80h4l3 14h13l3-9H80"
        className="stroke-[var(--primary)]"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="85" cy="99" r="2.5" className="fill-[var(--primary)]" />
      <circle cx="94" cy="99" r="2.5" className="fill-[var(--primary)]" />

      <rect x="122" y="66" width="66" height="8" rx="4" className="fill-[var(--border-strong)]" />
      <rect x="122" y="82" width="52" height="8" rx="4" className="fill-[var(--border)]" />
      <rect x="122" y="98" width="40" height="12" rx="6" className="fill-[var(--primary)]" />

      <path d="M100 146h54v6h-54z" className="fill-[var(--border-strong)]" />

      {/* Phone */}
      <rect
        x="176"
        y="96"
        width="52"
        height="86"
        rx="10"
        className="fill-[var(--card)] stroke-[var(--border-strong)]"
        strokeWidth="2"
      />
      <rect x="186" y="112" width="32" height="26" rx="4" className="fill-[var(--primary)]" opacity="0.16" />
      <rect x="186" y="146" width="32" height="6" rx="3" className="fill-[var(--border-strong)]" />
      <rect x="186" y="158" width="20" height="6" rx="3" className="fill-[var(--border)]" />

      {/* Shopping bag */}
      <path
        d="M34 126h30l-4 42H38z"
        className="fill-[var(--primary)] stroke-[var(--primary)]"
        strokeWidth="2"
        strokeLinejoin="round"
        opacity="0.9"
      />
      <path
        d="M44 132v-6a5 5 0 0 1 10 0v6"
        className="stroke-[var(--card)]"
        strokeWidth="2.5"
        fill="none"
        strokeLinecap="round"
      />

      {/* Plant */}
      <path d="M236 164h18l-3 18h-12z" className="fill-[var(--primary)]" opacity="0.35" />
      <path
        d="M245 164c0-12 4-19 12-22-1 12-5 19-12 22Zm0 0c0-10-4-16-11-18 1 10 4 15 11 18Z"
        className="fill-[var(--primary)]"
        opacity="0.55"
      />
    </svg>
  );
}

/** After it exists: the shop, open for business. */
export function StorefrontIllustration({ className }: { className?: string }) {
  const scallops = [119, 135, 151, 167, 183, 199, 215, 231, 247];

  return (
    <svg viewBox="0 0 360 200" role="presentation" aria-hidden className={cn('w-full', className)}>
      <defs>
        <clipPath id="store-awning">
          <path d="M98 60H268l-14 30H112z" />
        </clipPath>
      </defs>

      <ellipse cx="180" cy="176" rx="140" ry="8" className="fill-[var(--success)]" opacity="0.14" />

      {/* Shop */}
      <rect
        x="108"
        y="60"
        width="150"
        height="110"
        rx="10"
        className="fill-[var(--card)] stroke-[var(--success)]"
        strokeOpacity="0.35"
        strokeWidth="2"
      />

      {/* Striped awning, with a scalloped edge */}
      <g clipPath="url(#store-awning)">
        <rect x="96" y="58" width="176" height="34" className="fill-[var(--success)]" />
        {[104, 136, 168, 200, 232].map((x) => (
          <rect key={x} x={x} y="58" width="16" height="34" className="fill-[var(--card)]" opacity="0.9" />
        ))}
      </g>
      {scallops.map((x) => (
        <circle key={x} cx={x} cy="90" r="8" className="fill-[var(--success)]" />
      ))}
      {/* Every other scallop sits under a pale stripe, so it is pale too. */}
      {scallops
        .filter((_, index) => index % 2 === 0)
        .map((x) => (
          <circle key={x} cx={x} cy="90" r="8" className="fill-[var(--card)]" opacity="0.9" />
        ))}

      {/* Open sign */}
      <rect
        x="155"
        y="98"
        width="56"
        height="24"
        rx="7"
        className="fill-[var(--card)] stroke-[var(--success)]"
        strokeOpacity="0.4"
        strokeWidth="1.5"
      />
      <text
        x="183"
        y="115"
        textAnchor="middle"
        fontSize="11"
        fontWeight="700"
        letterSpacing="0.6"
        className="fill-[var(--success)]"
      >
        OPEN
      </text>

      {/* Window and door */}
      <rect x="120" y="130" width="52" height="40" rx="5" className="fill-[var(--success)]" opacity="0.18" />
      <path d="M146 130v40" className="stroke-[var(--success)]" strokeOpacity="0.35" strokeWidth="2" />
      <rect x="196" y="118" width="52" height="52" rx="5" className="fill-[var(--success)]" opacity="0.18" />
      <circle cx="240" cy="146" r="3" className="fill-[var(--success)]" />

      {/* Trolley */}
      <path
        d="M40 112h9l8 30h30l7-21H58"
        className="stroke-[var(--success)]"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="66" cy="154" r="5" className="fill-[var(--success)]" />
      <circle cx="84" cy="154" r="5" className="fill-[var(--success)]" />

      {/* Shopping bag */}
      <path d="M20 128h26l-4 34H24z" className="fill-[var(--success)]" opacity="0.85" />
      <path
        d="M28 128v-5a5 5 0 0 1 10 0v5"
        className="stroke-[var(--card)]"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />

      {/* Plant */}
      <path d="M292 150h30l-5 24h-20z" className="fill-[var(--success)]" opacity="0.4" />
      <path
        d="M307 150c0-14 5-22 14-25-1 14-6 22-14 25Zm0 0c0-11-5-18-13-20 1 11 5 17 13 20Z"
        className="fill-[var(--success)]"
        opacity="0.7"
      />
    </svg>
  );
}

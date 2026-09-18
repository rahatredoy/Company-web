import Image from 'next/image';
import Link from 'next/link';
import type { HeroSlide } from '@/types';
import type { TemplatePreset } from '@/templates/meta';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * One hero panel.
 *
 * Six visual treatments over one set of data. A template picks `heroVariant`
 * and gets its own shape — a bordered marketplace panel, an editorial spread, a
 * gradient wash, a full-bleed photograph — without any of them owning a second
 * copy of the heading, the badge or the call-to-action logic.
 */

const OVERLAY: Record<HeroSlide['overlay'], string> = {
  none: '',
  soft: 'bg-gradient-to-r from-black/30 via-black/10 to-transparent',
  scrim: 'bg-gradient-to-r from-black/65 via-black/35 to-black/10',
};

/**
 * Sets one word of the heading in the display face.
 *
 * The accent word arrives as a plain string and is matched against the
 * heading — deliberately not as an HTML fragment. A store owner typing into a
 * "highlight this word" box must not be able to put markup into the page's
 * `<h1>`, whatever they type.
 */
function AccentHeading({
  heading,
  accentWord,
  className,
  accentClassName,
}: {
  heading: string;
  accentWord: string | null;
  className?: string;
  accentClassName?: string;
}) {
  if (!accentWord) return <span className={className}>{heading}</span>;

  const at = heading.toLowerCase().indexOf(accentWord.toLowerCase());
  if (at === -1) return <span className={className}>{heading}</span>;

  return (
    <span className={className}>
      {heading.slice(0, at)}
      <em className={cn('font-display italic text-primary', accentClassName)}>
        {heading.slice(at, at + accentWord.length)}
      </em>
      {heading.slice(at + accentWord.length)}
    </span>
  );
}

/**
 * Splits badge text at the number.
 *
 * "Up to 50% Off" wants to read as a small "Up to" over a large "50% Off", not
 * a small "Up" over "to 50% Off" — splitting on the first space put three words
 * on the big line and overflowed the circle. Text with no number falls back to
 * a single line.
 */
function splitBadge(text: string): { lead: string | null; main: string } {
  const words = text.trim().split(/\s+/);
  const at = words.findIndex((word) => /\d/.test(word));
  if (at <= 0) return { lead: null, main: text };
  return { lead: words.slice(0, at).join(' '), main: words.slice(at).join(' ') };
}

/** The circular "Up to 50% Off" medallion the three references all carry. */
function HeroBadge({ badge }: { badge: NonNullable<HeroSlide['badge']> }) {
  const { lead, main } = splitBadge(badge.text);

  return (
    <span
      className={cn(
        'pointer-events-none absolute grid size-20 place-items-center rounded-full text-center leading-tight shadow-[var(--shadow-raised)] sm:size-24',
        'bottom-4 right-4 lg:bottom-8 lg:right-8',
        badge.tone === 'sale' && 'bg-sale text-white',
        badge.tone === 'accent' && 'bg-accent text-foreground',
        badge.tone === 'primary' && 'bg-surface text-primary',
      )}
    >
      <span className="px-2">
        {lead ? (
          <span className="block text-[10px] font-medium uppercase tracking-wide opacity-80">
            {lead}
          </span>
        ) : null}
        <span className="block text-sm font-bold leading-tight sm:text-base">{main}</span>
      </span>
    </span>
  );
}

function SocialProof({ proof }: { proof: NonNullable<HeroSlide['socialProof']> }) {
  return (
    <div className="mt-7 flex items-center gap-3">
      {proof.avatarUrls.length > 0 ? (
        <div className="flex -space-x-2" aria-hidden>
          {proof.avatarUrls.slice(0, 4).map((url, index) => (
            <span
              key={index}
              className="relative size-8 overflow-hidden rounded-full ring-2 ring-surface"
            >
              <Image src={url} alt="" fill sizes="32px" className="object-cover" />
            </span>
          ))}
        </div>
      ) : null}
      <p className="text-xs leading-snug text-muted sm:text-sm">{proof.text}</p>
    </div>
  );
}

function HeroCopy({
  slide,
  variant,
  onImage,
  headingLevel,
}: {
  slide: HeroSlide;
  variant: TemplatePreset['heroVariant'];
  onImage: boolean;
  headingLevel: 1 | 2;
}) {
  const editorial = variant === 'editorial' || variant === 'fullbleed';
  const centred = slide.align === 'center';
  /*
   * Only the first slide is the page's `h1`. Every slide of a carousel is in
   * the served HTML, so giving each one an `h1` would hand a screen reader
   * three top-level headings for one page and leave the outline meaningless.
   */
  const Heading = headingLevel === 1 ? 'h1' : 'h2';

  return (
    <div
      className={cn(
        'relative z-10 max-w-xl',
        centred && 'mx-auto text-center',
        onImage && 'text-white',
      )}
    >
      {slide.eyebrow ? (
        <p
          className={cn(
            'mb-3 text-xs font-semibold uppercase tracking-[0.18em]',
            onImage ? 'text-white/85' : editorial ? 'text-accent' : 'text-primary',
          )}
        >
          {slide.eyebrow}
        </p>
      ) : null}

      <Heading
        className={cn(
          'font-bold leading-[1.08]',
          editorial
            ? 'text-4xl sm:text-5xl lg:text-[3.25rem]'
            : 'text-3xl sm:text-4xl lg:text-5xl',
        )}
      >
        <AccentHeading
          heading={slide.heading}
          accentWord={slide.accentWord}
          accentClassName={cn(onImage && 'text-white')}
        />
      </Heading>

      {slide.subheading ? (
        <p
          className={cn(
            'mt-4 max-w-md text-base sm:text-lg',
            centred && 'mx-auto',
            onImage ? 'text-white/85' : 'text-muted',
          )}
        >
          {slide.subheading}
        </p>
      ) : null}

      {slide.primaryCta || slide.secondaryCta ? (
        <div className={cn('mt-7 flex flex-wrap gap-3', centred && 'justify-center')}>
          {slide.primaryCta ? (
            <Button asChild size="lg" variant={onImage ? 'secondary' : 'primary'}>
              <Link href={slide.primaryCta.href}>{slide.primaryCta.label}</Link>
            </Button>
          ) : null}
          {slide.secondaryCta ? (
            <Button
              asChild
              size="lg"
              variant="outline"
              className={cn(onImage && 'border-white/70 bg-white/10 text-white hover:bg-white/20')}
            >
              <Link href={slide.secondaryCta.href}>{slide.secondaryCta.label}</Link>
            </Button>
          ) : null}
        </div>
      ) : null}

      {slide.socialProof ? <SocialProof proof={slide.socialProof} /> : null}
    </div>
  );
}

export function HeroSlideView({
  slide,
  variant,
  priority,
  headingLevel = 1,
}: {
  slide: HeroSlide;
  variant: TemplatePreset['heroVariant'];
  /** Only the first slide of the first section; everything else lazy-loads. */
  priority: boolean;
  headingLevel?: 1 | 2;
}) {
  /* Full-bleed and tech lay the copy over the photograph; the rest sit beside it. */
  const overlaid = variant === 'fullbleed' || variant === 'tech';

  const surface = cn(
    'relative isolate overflow-hidden',
    variant === 'panel' && 'rounded-(--radius-card) bg-primary-soft',
    variant === 'gradient' &&
      'rounded-(--radius-card) bg-linear-to-br from-primary-soft via-accent-soft to-surface',
    variant === 'editorial' && 'rounded-(--radius-card) bg-surface-alt',
    variant === 'split' && 'rounded-(--radius-card) bg-surface-alt',
    variant === 'fullbleed' && 'bg-foreground',
    variant === 'tech' && 'rounded-(--radius-card) bg-secondary',
  );

  if (overlaid) {
    return (
      <div className={cn(surface, 'min-h-[22rem] sm:min-h-[26rem] lg:min-h-[32rem]')}>
        <Image
          src={slide.imageUrl}
          alt=""
          aria-hidden
          fill
          priority={priority}
          sizes="100vw"
          className="object-cover"
        />
        <div
          aria-hidden
          className={cn('absolute inset-0', OVERLAY[slide.overlay === 'none' ? 'scrim' : slide.overlay])}
        />
        <div className="container-store relative flex min-h-[22rem] items-center py-12 sm:min-h-[26rem] lg:min-h-[32rem]">
          <HeroCopy slide={slide} variant={variant} onImage headingLevel={headingLevel} />
        </div>
        {slide.badge ? <HeroBadge badge={slide.badge} /> : null}
      </div>
    );
  }

  return (
    <div className={surface}>
      <div
        className={cn(
          'grid items-center gap-6 p-6 sm:p-10 lg:gap-10 lg:p-14',
          variant === 'editorial' ? 'lg:grid-cols-[1.05fr_1fr]' : 'lg:grid-cols-2',
        )}
      >
        <HeroCopy slide={slide} variant={variant} onImage={false} headingLevel={headingLevel} />

        <div
          className={cn(
            'relative w-full overflow-hidden rounded-(--radius-card)',
            variant === 'editorial' ? 'aspect-4/5 lg:aspect-3/4' : 'aspect-4/3 lg:aspect-5/4',
          )}
        >
          <Image
            src={slide.imageUrl}
            alt=""
            aria-hidden
            fill
            // The hero is almost always the LCP element, so it is the one image
            // on the page that must not wait for lazy loading.
            priority={priority}
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      </div>

      {slide.badge ? <HeroBadge badge={slide.badge} /> : null}
    </div>
  );
}

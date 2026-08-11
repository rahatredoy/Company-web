import type {
  HeroSlide,
  HomepageSection,
  LookbookTile,
  PromoBanner,
  Testimonial,
} from '@/types';

/**
 * Readers for homepage section config.
 *
 * `HomepageSection.config` is free-form JSON written by the admin panel, so
 * every field is read defensively and nothing is trusted to be the shape it
 * claims. A malformed value produces a missing item, never a crashed homepage —
 * a store owner mis-saving one banner must not take the shopfront down.
 *
 * Nothing here ever produces markup. Strings come out as strings and are
 * rendered as text; the only place any of this becomes HTML is the CMS page
 * renderer, which sanitises separately.
 */

type Raw = Record<string, unknown>;

const asRecord = (value: unknown): Raw => (value ?? {}) as Raw;

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

export function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function readBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** Free-form `variant` discriminator, kept for sections saved before the type existed. */
export function readVariant(section: HomepageSection): string | null {
  return readString(section.config.variant);
}

/**
 * Internal destinations only.
 *
 * A section config field is admin-authored, and a compromised or careless admin
 * account should not be able to turn the store's own homepage into a redirect
 * to somewhere else. Anything not starting with a single `/` is dropped.
 */
export function readInternalHref(value: unknown): string | null {
  const href = readString(value);
  if (!href || !href.startsWith('/') || href.startsWith('//')) return null;
  return href;
}

function readCta(value: unknown): { label: string; href: string } | null {
  const record = asRecord(value);
  const label = readString(record.label);
  const href = readInternalHref(record.href);
  return label && href ? { label, href } : null;
}

const TONES = new Set(['none', 'primary', 'peach', 'mint', 'sky', 'sand', 'dark']);
const OVERLAYS = new Set(['none', 'scrim', 'soft']);

/**
 * Hero slides.
 *
 * A slide with no heading or no image cannot render usefully, so it is dropped
 * rather than producing an empty panel with a broken-image icon in it.
 */
export function readSlides(section: HomepageSection): HeroSlide[] {
  const raw = section.config.slides;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry, index): HeroSlide => {
      const slide = asRecord(entry);
      const badge = asRecord(slide.badge);
      const badgeText = readString(badge.text);
      const proof = asRecord(slide.socialProof);
      const proofText = readString(proof.text);
      const badgeTone = readString(badge.tone);
      const overlay = readString(slide.overlay);

      return {
        id: readString(slide.id) ?? `slide-${index}`,
        eyebrow: readString(slide.eyebrow),
        heading: readString(slide.heading) ?? '',
        accentWord: readString(slide.accentWord),
        subheading: readString(slide.subheading),
        imageUrl: readString(slide.imageUrl) ?? '',
        mobileImageUrl: readString(slide.mobileImageUrl),
        primaryCta: readCta(slide.primaryCta),
        secondaryCta: readCta(slide.secondaryCta),
        badge: badgeText
          ? {
              text: badgeText,
              tone:
                badgeTone === 'sale' || badgeTone === 'accent' || badgeTone === 'primary'
                  ? badgeTone
                  : 'primary',
            }
          : null,
        socialProof: proofText
          ? { avatarUrls: readStringArray(proof.avatarUrls).slice(0, 5), text: proofText }
          : null,
        align: readString(slide.align) === 'center' ? 'center' : 'left',
        overlay: overlay && OVERLAYS.has(overlay) ? (overlay as HeroSlide['overlay']) : 'none',
      };
    })
    .filter((slide) => slide.heading.length > 0 && slide.imageUrl.length > 0);
}

/**
 * Promotional banners.
 *
 * Unlike a hero, a banner may legitimately have no photograph — the tinted
 * trio in two of the templates is type on a colour wash — so only a title or an
 * image is required, not both.
 */
export function readBanners(value: unknown): PromoBanner[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index): PromoBanner => {
      const banner = asRecord(entry);
      const tone = readString(banner.tone);

      return {
        id: readString(banner.id) ?? `banner-${index}`,
        title: readString(banner.title),
        subtitle: readString(banner.subtitle),
        eyebrow: readString(banner.eyebrow),
        imageUrl: readString(banner.imageUrl),
        mobileImageUrl: readString(banner.mobileImageUrl),
        linkUrl: readInternalHref(banner.linkUrl),
        buttonLabel: readString(banner.buttonLabel),
        couponCode: readString(banner.couponCode),
        tone: tone && TONES.has(tone) ? (tone as PromoBanner['tone']) : 'none',
      };
    })
    .filter((banner) => Boolean(banner.imageUrl || banner.title));
}

export interface BenefitItem {
  icon: string;
  title: string;
  description: string | null;
}

/**
 * Trust claims. Only what the store actually configured — promising free
 * shipping a store does not offer is worse than showing nothing.
 */
export function readBenefits(value: unknown): BenefitItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry) => {
      const item = asRecord(entry);
      const title = readString(item.title);
      return title
        ? {
            icon: readString(item.icon) ?? 'shield-check',
            title,
            description: readString(item.description),
          }
        : null;
    })
    .filter((item): item is BenefitItem => item !== null);
}

export interface SectionTab {
  key: string;
  label: string;
  productIds: string[];
}

/**
 * Product tabs. A section with a flat `productIds` list is read as a single
 * unnamed tab, which is how sections saved before tabs existed keep working.
 */
export function readTabs(section: HomepageSection): SectionTab[] {
  const raw = section.config.tabs;

  if (!Array.isArray(raw)) {
    const ids = readStringArray(section.config.productIds);
    return ids.length > 0 ? [{ key: 'all', label: section.title ?? 'Products', productIds: ids }] : [];
  }

  return raw
    .map((entry, position): SectionTab => {
      const tab = asRecord(entry);
      return {
        key: readString(tab.key) ?? `tab-${position}`,
        label: readString(tab.label) ?? 'Products',
        productIds: readStringArray(tab.productIds),
      };
    })
    .filter((tab) => tab.productIds.length > 0);
}

export function readLookbookTiles(value: unknown): LookbookTile[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index): LookbookTile => {
      const tile = asRecord(entry);
      return {
        id: readString(tile.id) ?? `tile-${index}`,
        imageUrl: readString(tile.imageUrl) ?? '',
        linkUrl: readInternalHref(tile.linkUrl),
        caption: readString(tile.caption),
      };
    })
    .filter((tile) => tile.imageUrl.length > 0);
}

export function readTestimonials(value: unknown): Testimonial[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((entry, index): Testimonial => {
      const item = asRecord(entry);
      const rating = typeof item.rating === 'number' ? item.rating : null;
      return {
        id: readString(item.id) ?? `testimonial-${index}`,
        quote: readString(item.quote) ?? '',
        authorName: readString(item.authorName) ?? 'Verified customer',
        authorTitle: readString(item.authorTitle),
        avatarUrl: readString(item.avatarUrl),
        rating: rating !== null && rating >= 0 && rating <= 5 ? rating : null,
      };
    })
    .filter((item) => item.quote.length > 0);
}

/**
 * A countdown deadline.
 *
 * Accepts an absolute ISO timestamp, or `endsInHours` as an offset from now.
 * The offset form is what fixtures and demo content use; a real campaign should
 * always carry an absolute time, because a deadline that resets on every page
 * load is a lie told to create urgency.
 */
export function readDeadline(config: Raw, now: number = Date.now()): number | null {
  const absolute = readString(config.endsAt);
  if (absolute) {
    const parsed = Date.parse(absolute);
    if (Number.isFinite(parsed)) return parsed;
  }

  const hours = typeof config.endsInHours === 'number' ? config.endsInHours : null;
  if (hours !== null && hours > 0 && hours < 24 * 365) return now + hours * 3_600_000;

  return null;
}

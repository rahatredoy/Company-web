import { and, asc, eq } from 'drizzle-orm';
import type { StoreContext } from '../plugins/tenant';
import {
  categories,
  navigationItems,
  navigationMenus,
  pages,
  paymentMethods,
  storeSettings,
  storefrontSettings,
} from '../db/schema/index';
import {
  DEFAULT_TEMPLATE,
  DEFAULT_THEME,
  normaliseTemplateKey,
  normaliseThemeKey,
  type ColorTheme,
  type StorefrontTemplate,
} from '../lib/constants';
import { CACHE_TTL, cached, invalidateTenantCache, tenantKey } from '../lib/cache';
import { storeBaseUrl } from '../lib/urls';

/**
 * One line in the announcement strip.
 *
 * A list rather than a single string because a store runs more than one notice
 * at a time — a shipping threshold, a live campaign, a holiday cutoff — and
 * rotating them is the only way to fit all three in a strip that tall.
 */
export interface AnnouncementMessage {
  id: string;
  text: string;
  linkUrl: string | null;
  linkLabel: string | null;
}

export interface AnnouncementConfig {
  enabled: boolean;
  messages: AnnouncementMessage[];
}

export interface ContactConfig {
  businessName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  whatsappNumber: string | null;
  whatsappEnabled: boolean;
}

/**
 * One social profile in the footer.
 *
 * `platform` picks the glyph from a closed set the storefront owns, rather than
 * the store supplying an icon URL — an icon field taking arbitrary URLs would
 * let admin content pull a remote image into the footer of every page.
 */
export interface SocialLink {
  platform: string;
  url: string;
}

export interface FooterColumn {
  id: string;
  title: string;
  links: { label: string; href: string }[];
}

export interface UtilityLink {
  label: string;
  href: string;
}

/** One destination in the mobile bottom bar; `icon` is a closed-set key. */
export interface MobileNavItem {
  label: string;
  href: string;
  icon: string;
}

export interface NavigationNode {
  id: string;
  label: string;
  targetType: 'page' | 'category' | 'url';
  href: string;
  opensInNewTab: boolean;
  children: NavigationNode[];
}

export interface StorefrontConfig {
  store: {
    slug: string;
    name: string;
    tagline: string | null;
    currency: string;
    language: string;
    timezone: string;
    logoUrl: string | null;
    faviconUrl: string | null;
    /** Absolute origin canonical URLs and the sitemap must use. */
    canonicalOrigin: string;
    /**
     * Every language and display currency the store has switched on, always
     * including the one it trades in. The storefront draws a selector only when
     * there is more than one — a control with a single option cannot do
     * anything, so offering it is worse than leaving it out.
     */
    languages: string[];
    currencies: string[];
  };
  design: {
    templateKey: StorefrontTemplate;
    colorThemeKey: ColorTheme;
  };
  announcement: AnnouncementConfig;
  /** Desktop strip above the header. Empty means the store has not set one up. */
  utility: UtilityLink[];
  contact: ContactConfig;
  navigation: {
    header: NavigationNode[];
    footer: NavigationNode[];
  };
  /**
   * Footer link columns, exactly as the store arranged them. Empty means the
   * footer draws its brand block and nothing else — an invented column of links
   * is worse than no column, because half of them would 404.
   */
  footerColumns: FooterColumn[];
  social: SocialLink[];
  /** Mobile bottom bar. Empty hides the bar rather than guessing destinations. */
  mobileNav: MobileNavItem[];
  /** Top-level categories for the mega-menu and mobile drawer. */
  categoryMenu: {
    id: string;
    name: string;
    slug: string;
    iconUrl: string | null;
    /** Closed-set glyph key, chosen by the store; never a URL. */
    iconKey: string | null;
    children: { id: string; name: string; slug: string }[];
  }[];
  policyPages: { slug: string; title: string; systemKey: string | null }[];
  payment: { providers: { provider: string; label: string; description: string | null }[] };
  seo: { title: string | null; description: string | null; socialImageUrl: string | null };
  /** Surfaced so the storefront can render its own "temporarily unavailable" state. */
  status: StoreContext['status'];
}

function trimmedOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** One `{ text, linkUrl, linkLabel }` object from the header JSON, or null. */
function readAnnouncementMessage(raw: unknown, index: number): AnnouncementMessage | null {
  const value = (raw ?? {}) as Record<string, unknown>;
  const text = trimmedOrNull(value.text);
  if (!text) return null;

  return {
    // The stored JSON carries no ids, so position is the only stable handle —
    // enough for a React key, and it is never used to address a row.
    id: trimmedOrNull(value.id) ?? `announcement-${index}`,
    text,
    linkUrl: trimmedOrNull(value.linkUrl),
    linkLabel: trimmedOrNull(value.linkLabel),
  };
}

/**
 * Header/footer JSON is free-form in the database; read it defensively.
 *
 * Two shapes are accepted because the strip used to hold a single message and
 * stores configured under that version still have `{ text, linkUrl }` sitting
 * where the list now goes. Reading both here means no data migration and no
 * store losing its notice on deploy.
 */
function readAnnouncement(raw: unknown): AnnouncementConfig {
  const value = (raw ?? {}) as Record<string, unknown>;
  const bar = (value.announcement ?? {}) as Record<string, unknown>;

  const messages = Array.isArray(bar.messages)
    ? bar.messages.map(readAnnouncementMessage).filter((m): m is AnnouncementMessage => m !== null)
    : [readAnnouncementMessage(bar, 0)].filter((m): m is AnnouncementMessage => m !== null);

  // An enabled strip with nothing to say is not enabled, whatever the flag says.
  return { enabled: bar.enabled === true && messages.length > 0, messages };
}

/**
 * The switched-on locales, always containing the store's own.
 *
 * Deduplicated and order-preserving with the store's value first, so a stored
 * list that happens to repeat it does not produce two identical menu entries.
 */
function localeList(stored: unknown, fallback: string): string[] {
  const values = Array.isArray(stored)
    ? stored.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim())
    : [];

  return [...new Set([fallback, ...values])];
}

function readTagline(raw: unknown): string | null {
  const value = (raw ?? {}) as Record<string, unknown>;
  return typeof value.tagline === 'string' && value.tagline.trim() ? value.tagline.trim() : null;
}

/**
 * A link target the storefront may render.
 *
 * The same rule `hrefFor` applies to stored nav targets: a path or an http(s)
 * URL, nothing else. Without it a `javascript:` value saved by a compromised
 * admin session becomes an href in the footer of every page.
 */
function readHref(value: unknown): string | null {
  const href = trimmedOrNull(value);
  if (!href) return null;
  if (href.startsWith('/')) return href;
  return /^https?:\/\//i.test(href) ? href : null;
}

function readLinkList(raw: unknown): { label: string; href: string }[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const label = trimmedOrNull(item.label);
    const href = readHref(item.href);
    return label && href ? [{ label, href }] : [];
  });
}

/**
 * Footer columns from `footer_configuration.columns`.
 *
 * A column with no surviving links is dropped rather than rendered as a bare
 * heading — the same rule the rest of the storefront follows, where absent data
 * means absent section.
 */
function readFooterColumns(raw: unknown): FooterColumn[] {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(value.columns)) return [];

  return value.columns.flatMap((entry, index) => {
    const column = (entry ?? {}) as Record<string, unknown>;
    const title = trimmedOrNull(column.title);
    const links = readLinkList(column.links);
    if (!title || links.length === 0) return [];

    return [{ id: trimmedOrNull(column.id) ?? `column-${index}`, title, links }];
  });
}

/** Social profiles from `footer_configuration.social`. */
function readSocial(raw: unknown): SocialLink[] {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(value.social)) return [];

  return value.social.flatMap((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const platform = trimmedOrNull(item.platform)?.toLowerCase();
    const url = readHref(item.url);
    return platform && url ? [{ platform, url }] : [];
  });
}

function readUtility(raw: unknown): UtilityLink[] {
  const value = (raw ?? {}) as Record<string, unknown>;
  return readLinkList(value.utility);
}

function readMobileNav(raw: unknown): MobileNavItem[] {
  const value = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(value.mobileNav)) return [];

  return value.mobileNav.flatMap((entry) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const label = trimmedOrNull(item.label);
    const href = readHref(item.href);
    const icon = trimmedOrNull(item.icon);
    return label && href && icon ? [{ label, href, icon }] : [];
  });
}

/**
 * Per-category glyph keys from `header_configuration.categoryIcons`.
 *
 * Keyed by category slug so the mapping survives a category being renamed, and
 * carried as a key rather than a URL for the reason given on `SocialLink`.
 */
function readCategoryIcons(raw: unknown): Map<string, string> {
  const value = (raw ?? {}) as Record<string, unknown>;
  const icons = (value.categoryIcons ?? {}) as Record<string, unknown>;
  if (typeof icons !== 'object' || icons === null || Array.isArray(icons)) return new Map();

  return new Map(
    Object.entries(icons).flatMap(([slug, key]) => {
      const iconKey = trimmedOrNull(key);
      return iconKey ? [[slug, iconKey] as [string, string]] : [];
    }),
  );
}

/** Turns a stored nav target into a path the storefront can link to directly. */
function hrefFor(item: { targetType: string; targetValue: string }, pageSlugs: Map<string, string>, categorySlugs: Map<string, string>): string {
  if (item.targetType === 'page') return `/page/${pageSlugs.get(item.targetValue) ?? item.targetValue}`;
  if (item.targetType === 'category') return `/category/${categorySlugs.get(item.targetValue) ?? item.targetValue}`;

  // A stored URL is only ever used as a link target; anything that is not a
  // path or an http(s) URL is dropped rather than rendered, so a `javascript:`
  // value saved by a compromised admin cannot become an href.
  const value = item.targetValue.trim();
  if (value.startsWith('/')) return value;
  return /^https?:\/\//i.test(value) ? value : '/';
}

export function storefrontConfigKey(tenantRef: string): string {
  return tenantKey(tenantRef, 'storefront', 'config');
}

export async function invalidateStorefrontConfig(tenantRef: string): Promise<void> {
  await invalidateTenantCache(tenantRef, 'storefront');
}

/**
 * Everything the storefront shell needs, in one cached read.
 *
 * The storefront calls this on every page render, so it must be one round trip
 * and it must be cacheable — hence no per-visitor data of any kind in here.
 */
export async function loadStorefrontConfig(store: StoreContext): Promise<StorefrontConfig> {
  return cached(storefrontConfigKey(store.tenantRef), CACHE_TTL.storefrontConfig, async () => {
    const db = store.db;

    const [settingsRow] = await db.select().from(storeSettings).limit(1);
    const [designRow] = await db.select().from(storefrontSettings).limit(1);

    const menus = await db
      .select({ id: navigationMenus.id, location: navigationMenus.location })
      .from(navigationMenus)
      .where(eq(navigationMenus.isActive, true));

    const items = await db
      .select()
      .from(navigationItems)
      .where(eq(navigationItems.isActive, true))
      .orderBy(asc(navigationItems.sortOrder));

    const categoryRows = await db
      .select({
        id: categories.id,
        name: categories.name,
        slug: categories.slug,
        parentId: categories.parentId,
        iconUrl: categories.iconUrl,
        sortOrder: categories.sortOrder,
      })
      .from(categories)
      .where(and(eq(categories.isActive, true), eq(categories.showInMenu, true)))
      .orderBy(asc(categories.sortOrder), asc(categories.name));

    const pageRows = await db
      .select({ slug: pages.slug, title: pages.title, systemKey: pages.systemKey, id: pages.id, showInFooter: pages.showInFooter })
      .from(pages)
      .where(eq(pages.status, 'published'))
      .orderBy(asc(pages.sortOrder), asc(pages.title));

    const methodRows = await db
      .select({
        provider: paymentMethods.provider,
        label: paymentMethods.label,
        description: paymentMethods.description,
      })
      .from(paymentMethods)
      .where(eq(paymentMethods.isEnabled, true))
      .orderBy(asc(paymentMethods.sortOrder));

    const pageSlugs = new Map(pageRows.map((p) => [p.id, p.slug]));
    const categorySlugs = new Map(categoryRows.map((c) => [c.id, c.slug]));

    const buildTree = (location: 'header' | 'footer'): NavigationNode[] => {
      const menuIds = new Set(menus.filter((m) => m.location === location).map((m) => m.id));
      const scoped = items.filter((item) => menuIds.has(item.menuId));

      const toNode = (item: (typeof scoped)[number]): NavigationNode => ({
        id: item.id,
        label: item.label,
        targetType: item.targetType,
        href: hrefFor(item, pageSlugs, categorySlugs),
        opensInNewTab: item.opensInNewTab,
        children: scoped.filter((child) => child.parentId === item.id).map(toNode),
      });

      return scoped.filter((item) => !item.parentId).map(toNode);
    };

    const preferences = settingsRow?.preferences ?? {};
    const currency = settingsRow?.currency ?? store.currency;
    const language = settingsRow?.language ?? store.language;
    const categoryIcons = readCategoryIcons(designRow?.headerConfiguration);

    return {
      store: {
        slug: store.slug,
        name: settingsRow?.storeName ?? store.storeName,
        tagline: readTagline(designRow?.footerConfiguration),
        currency,
        language,
        timezone: settingsRow?.timezone ?? store.timezone,
        logoUrl: designRow?.logoUrl ?? settingsRow?.logoUrl ?? null,
        faviconUrl: designRow?.faviconUrl ?? settingsRow?.faviconUrl ?? null,
        // A connected primary domain wins, so the same page is never indexed
        // under both the custom domain and the platform subdomain.
        canonicalOrigin: store.primaryDomain ? `https://${store.primaryDomain}` : storeBaseUrl(store.slug),
        languages: localeList(preferences.languages, language),
        currencies: localeList(preferences.currencies, currency),
      },
      design: {
        templateKey: designRow ? normaliseTemplateKey(designRow.templateKey) : DEFAULT_TEMPLATE,
        colorThemeKey: designRow ? normaliseThemeKey(designRow.colorThemeKey) : DEFAULT_THEME,
      },
      announcement: readAnnouncement(designRow?.headerConfiguration),
      utility: readUtility(designRow?.headerConfiguration),
      contact: {
        businessName: settingsRow?.businessName ?? null,
        email: settingsRow?.businessEmail ?? null,
        phone: settingsRow?.businessPhone ?? null,
        address: settingsRow?.businessAddress ?? null,
        whatsappNumber: preferences.whatsappNumber ?? null,
        whatsappEnabled: preferences.whatsappEnabled === true,
      },
      navigation: { header: buildTree('header'), footer: buildTree('footer') },
      footerColumns: readFooterColumns(designRow?.footerConfiguration),
      social: readSocial(designRow?.footerConfiguration),
      mobileNav: readMobileNav(designRow?.headerConfiguration),
      categoryMenu: categoryRows
        .filter((c) => !c.parentId)
        .map((parent) => ({
          id: parent.id,
          name: parent.name,
          slug: parent.slug,
          iconUrl: parent.iconUrl,
          iconKey: categoryIcons.get(parent.slug) ?? null,
          children: categoryRows
            .filter((child) => child.parentId === parent.id)
            .map((child) => ({ id: child.id, name: child.name, slug: child.slug })),
        })),
      policyPages: pageRows
        .filter((p) => p.showInFooter || p.systemKey)
        .map((p) => ({ slug: p.slug, title: p.title, systemKey: p.systemKey })),
      payment: { providers: methodRows },
      seo: {
        title: settingsRow?.seoTitle ?? null,
        description: settingsRow?.seoDescription ?? null,
        socialImageUrl: settingsRow?.socialImageUrl ?? null,
      },
      status: store.status,
    } satisfies StorefrontConfig;
  });
}

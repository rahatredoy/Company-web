/**
 * The eight colour themes.
 *
 * A theme defines **colour and nothing else**. No spacing, no radius, no
 * typography, no layout — which is what makes "changing the colour cannot change
 * the layout" true by construction rather than by discipline. Templates own
 * structure; themes own paint.
 *
 * Every token here is emitted as a CSS custom property on `:root` by
 * `ThemeStyle`, so components reference `var(--primary)` and never a hex value.
 */

export const COLOR_THEMES = [
  'royal_blue',
  'emerald_green',
  'luxury_black',
  'rose_pink',
  'modern_purple',
  'sunset_orange',
  'midnight_navy',
  'olive_premium',
] as const;

export type ColorThemeKey = (typeof COLOR_THEMES)[number];

export const DEFAULT_THEME: ColorThemeKey = 'royal_blue';

export interface ThemeTokens {
  /** Brand colour: primary buttons, active states, links. */
  primary: string;
  primaryHover: string;
  /** Text/icon colour that sits on `primary`. */
  primaryForeground: string;
  /** Tinted wash of the brand, for soft badges and section backgrounds. */
  primarySoft: string;

  secondary: string;
  secondaryForeground: string;

  /** Highlight used sparingly — sale flashes, decorative accents. */
  accent: string;
  accentSoft: string;

  /** Page background. */
  background: string;
  /** Cards, headers, anything raised above the page. */
  surface: string;
  /** Subtle alternating band, e.g. a benefits strip. */
  surfaceAlt: string;

  textPrimary: string;
  textSecondary: string;
  /** Quieter still — captions, disabled labels. */
  textMuted: string;

  border: string;
  borderStrong: string;
  /** Focus ring. Must stay visible against both background and surface. */
  ring: string;

  success: string;
  warning: string;
  error: string;
  /** Discounts and sale pricing. Deliberately distinct from `error`. */
  sale: string;
  /** Filled review stars. */
  star: string;
}

export interface Theme {
  key: ColorThemeKey;
  name: string;
  tokens: ThemeTokens;
}

/** Status colours are shared: a customer must read "in stock" the same way everywhere. */
const STATUS = {
  success: '#16A34A',
  warning: '#F59E0B',
  error: '#DC2626',
  star: '#F59E0B',
} as const;

export const THEMES: Record<ColorThemeKey, Theme> = {
  royal_blue: {
    key: 'royal_blue',
    name: 'Royal Blue',
    tokens: {
      primary: '#2563EB',
      primaryHover: '#1D4ED8',
      primaryForeground: '#FFFFFF',
      primarySoft: '#EFF6FF',
      secondary: '#1E40AF',
      secondaryForeground: '#FFFFFF',
      accent: '#60A5FA',
      accentSoft: '#DBEAFE',
      background: '#F8FAFC',
      surface: '#FFFFFF',
      surfaceAlt: '#F1F5F9',
      textPrimary: '#0F172A',
      textSecondary: '#475569',
      textMuted: '#64748B',
      border: '#E2E8F0',
      borderStrong: '#CBD5E1',
      ring: '#2563EB',
      ...STATUS,
      sale: '#DC2626',
    },
  },

  emerald_green: {
    key: 'emerald_green',
    name: 'Emerald Green',
    tokens: {
      primary: '#059669',
      primaryHover: '#047857',
      primaryForeground: '#FFFFFF',
      primarySoft: '#ECFDF5',
      secondary: '#065F46',
      secondaryForeground: '#FFFFFF',
      accent: '#34D399',
      accentSoft: '#D1FAE5',
      background: '#F7FCFA',
      surface: '#FFFFFF',
      surfaceAlt: '#EFF8F4',
      textPrimary: '#111827',
      textSecondary: '#4B5563',
      textMuted: '#64748B',
      border: '#DDEEE7',
      borderStrong: '#C2DED2',
      ring: '#059669',
      ...STATUS,
      sale: '#DC2626',
    },
  },

  luxury_black: {
    key: 'luxury_black',
    name: 'Luxury Black',
    tokens: {
      primary: '#18181B',
      primaryHover: '#27272A',
      primaryForeground: '#FFFFFF',
      primarySoft: '#F4F4F5',
      secondary: '#3F3F46',
      secondaryForeground: '#FFFFFF',
      // The gold is what stops this theme reading as merely grey.
      accent: '#C6A15B',
      accentSoft: '#F7F1E4',
      background: '#FAFAFA',
      surface: '#FFFFFF',
      surfaceAlt: '#F4F4F5',
      textPrimary: '#18181B',
      textSecondary: '#52525B',
      textMuted: '#71717A',
      border: '#E4E4E7',
      borderStrong: '#D4D4D8',
      ring: '#18181B',
      ...STATUS,
      sale: '#B45309',
    },
  },

  rose_pink: {
    key: 'rose_pink',
    name: 'Rose Pink',
    tokens: {
      primary: '#DB2777',
      primaryHover: '#BE185D',
      primaryForeground: '#FFFFFF',
      primarySoft: '#FDF2F8',
      secondary: '#9D174D',
      secondaryForeground: '#FFFFFF',
      accent: '#F9A8D4',
      accentSoft: '#FCE7F3',
      background: '#FFF7FA',
      surface: '#FFFFFF',
      surfaceAlt: '#FDF2F6',
      textPrimary: '#3F1727',
      textSecondary: '#6B4152',
      textMuted: '#7C5968',
      border: '#FCE7F3',
      borderStrong: '#F5D0E3',
      ring: '#DB2777',
      ...STATUS,
      // Red-on-pink is unreadable, so sale moves to a deep plum here.
      sale: '#9F1239',
    },
  },

  modern_purple: {
    key: 'modern_purple',
    name: 'Modern Purple',
    tokens: {
      primary: '#7C3AED',
      primaryHover: '#6D28D9',
      primaryForeground: '#FFFFFF',
      primarySoft: '#F5F3FF',
      secondary: '#5B21B6',
      secondaryForeground: '#FFFFFF',
      accent: '#C4B5FD',
      accentSoft: '#EDE9FE',
      background: '#FAF8FF',
      surface: '#FFFFFF',
      surfaceAlt: '#F5F3FF',
      textPrimary: '#1E1B4B',
      textSecondary: '#4C4A6B',
      textMuted: '#6B7280',
      border: '#E9E1FF',
      borderStrong: '#D6C9FA',
      ring: '#7C3AED',
      ...STATUS,
      sale: '#DC2626',
    },
  },

  sunset_orange: {
    key: 'sunset_orange',
    name: 'Sunset Orange',
    tokens: {
      primary: '#EA580C',
      primaryHover: '#C2410C',
      primaryForeground: '#FFFFFF',
      primarySoft: '#FFF7ED',
      secondary: '#C2410C',
      secondaryForeground: '#FFFFFF',
      accent: '#FDBA74',
      accentSoft: '#FFEDD5',
      background: '#FFF9F5',
      surface: '#FFFFFF',
      surfaceAlt: '#FFF4EC',
      textPrimary: '#292524',
      textSecondary: '#57534E',
      textMuted: '#78716C',
      border: '#FED7AA',
      borderStrong: '#FDBA74',
      ring: '#EA580C',
      ...STATUS,
      // Orange-on-orange would vanish; sale goes crimson.
      sale: '#BE123C',
    },
  },

  midnight_navy: {
    key: 'midnight_navy',
    name: 'Midnight Navy',
    tokens: {
      primary: '#172554',
      primaryHover: '#1E3A8A',
      primaryForeground: '#FFFFFF',
      primarySoft: '#EEF2FF',
      secondary: '#0F172A',
      secondaryForeground: '#FFFFFF',
      accent: '#3B82F6',
      accentSoft: '#DBEAFE',
      background: '#F8FAFC',
      surface: '#FFFFFF',
      surfaceAlt: '#F1F5F9',
      textPrimary: '#0F172A',
      textSecondary: '#475569',
      textMuted: '#64748B',
      border: '#E2E8F0',
      borderStrong: '#CBD5E1',
      ring: '#172554',
      ...STATUS,
      sale: '#DC2626',
    },
  },

  olive_premium: {
    key: 'olive_premium',
    name: 'Olive Premium',
    tokens: {
      primary: '#46563C',
      primaryHover: '#374429',
      primaryForeground: '#FFFFFF',
      primarySoft: '#F1F3EA',
      secondary: '#293522',
      secondaryForeground: '#FFFFFF',
      // Warm brass against olive — the palette the fashion reference uses.
      accent: '#B08D57',
      accentSoft: '#F5EEE2',
      background: '#F8F5ED',
      surface: '#FFFFFF',
      surfaceAlt: '#F2EFE4',
      textPrimary: '#293522',
      textSecondary: '#55604A',
      textMuted: '#6B705C',
      border: '#E3DFD0',
      borderStrong: '#CFC9B4',
      ring: '#46563C',
      ...STATUS,
      sale: '#9A3412',
    },
  },
};

/** Unknown or legacy keys fall back rather than rendering an unstyled page. */
export function resolveTheme(key: string | null | undefined): Theme {
  const normalised = (key ?? '').replace(/-/g, '_');
  return THEMES[normalised as ColorThemeKey] ?? THEMES[DEFAULT_THEME];
}

const TOKEN_TO_CSS_VAR: Record<keyof ThemeTokens, string> = {
  primary: '--primary',
  primaryHover: '--primary-hover',
  primaryForeground: '--primary-foreground',
  primarySoft: '--primary-soft',
  secondary: '--secondary',
  secondaryForeground: '--secondary-foreground',
  accent: '--accent',
  accentSoft: '--accent-soft',
  background: '--background',
  surface: '--surface',
  surfaceAlt: '--surface-alt',
  textPrimary: '--text-primary',
  textSecondary: '--text-secondary',
  textMuted: '--text-muted',
  border: '--border',
  borderStrong: '--border-strong',
  ring: '--ring',
  success: '--success',
  warning: '--warning',
  error: '--error',
  sale: '--sale',
  star: '--star',
};

/**
 * Renders a theme as a `:root` declaration block.
 *
 * Emitted server-side into the document head, so the first paint is already the
 * store's colours — no flash of the wrong brand, and no client JavaScript
 * involved in theming at all.
 */
export function themeToCss(theme: Theme): string {
  const declarations = (Object.keys(theme.tokens) as (keyof ThemeTokens)[])
    .map((token) => `${TOKEN_TO_CSS_VAR[token]}:${theme.tokens[token]}`)
    .join(';');

  return `:root{${declarations}}`;
}

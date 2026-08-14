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
 *
 * **The neutrals are part of the theme, not a shared grey.** Every surface,
 * border, shadow and body-text colour below is mixed from that theme's own hue,
 * so switching the colour repaints the whole page rather than only the handful
 * of elements that happen to use the brand colour directly. Eight themes that
 * shared one slate ramp looked identical everywhere except the buttons — which
 * is not a choice of colour, it is a choice of button.
 *
 * Contrast is not left to taste: every `textMuted` below is the lightest value
 * that still clears WCAG AA (4.5:1) against its own theme's `surfaceAlt`, which
 * is the busiest background muted text ever lands on.
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

  /** Page background. Tinted with the brand hue, never a neutral grey. */
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

  /**
   * Shadow colour as an `R G B` triple, so `globals.css` can vary the alpha per
   * elevation. A card on a warm olive page casting a cold slate shadow is the
   * one thing that gives a tinted palette away.
   */
  shadowRgb: string;

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
      primarySoft: '#EAF0FD',
      secondary: '#1E40AF',
      secondaryForeground: '#FFFFFF',
      accent: '#60A5FA',
      accentSoft: '#CDDBF9',
      background: '#EFF3FB',
      surface: '#F9FBFE',
      surfaceAlt: '#E4EAF6',
      textPrimary: '#121C30',
      textSecondary: '#404D68',
      textMuted: '#5C6984',
      border: '#D5DDEE',
      borderStrong: '#BAC5DE',
      ring: '#2563EB',
      shadowRgb: '18 28 48',
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
      primarySoft: '#EAFDF7',
      secondary: '#065F46',
      secondaryForeground: '#FFFFFF',
      accent: '#34D399',
      accentSoft: '#CEF8EB',
      background: '#EFFAF7',
      surface: '#F9FEFC',
      surfaceAlt: '#E4F6F1',
      textPrimary: '#132F27',
      textSecondary: '#41675C',
      textMuted: '#52746A',
      border: '#D6EDE6',
      borderStrong: '#BBDDD3',
      ring: '#059669',
      shadowRgb: '19 47 39',
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
      primarySoft: '#F6F5F1',
      secondary: '#3F3F46',
      secondaryForeground: '#FFFFFF',
      // The gold is what stops this theme reading as merely grey — which is
      // also why the neutrals below are warm, not cold.
      accent: '#C6A15B',
      accentSoft: '#F2E9D6',
      background: '#F7F5F3',
      surface: '#FCFCFB',
      surfaceAlt: '#F0EEEA',
      textPrimary: '#26231D',
      textSecondary: '#5A564E',
      textMuted: '#706C64',
      border: '#E5E3DE',
      borderStrong: '#D2CEC6',
      ring: '#18181B',
      shadowRgb: '38 35 29',
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
      primarySoft: '#FDEAF1',
      secondary: '#9D174D',
      secondaryForeground: '#FFFFFF',
      accent: '#F9A8D4',
      accentSoft: '#F8CEDE',
      background: '#FAEFF3',
      surface: '#FEF9FB',
      surfaceAlt: '#F6E4EB',
      textPrimary: '#2F131E',
      textSecondary: '#674150',
      textMuted: '#855E6D',
      border: '#EDD6DF',
      borderStrong: '#DDBBC8',
      ring: '#DB2777',
      shadowRgb: '47 19 30',
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
      primarySoft: '#F1EAFD',
      secondary: '#5B21B6',
      secondaryForeground: '#FFFFFF',
      accent: '#C4B5FD',
      accentSoft: '#DDCDF9',
      background: '#F3EFFB',
      surface: '#FBF9FE',
      surfaceAlt: '#EBE4F6',
      textPrimary: '#1D1230',
      textSecondary: '#4F4068',
      textMuted: '#70608A',
      border: '#DED5EE',
      borderStrong: '#C7BADE',
      ring: '#7C3AED',
      shadowRgb: '29 18 48',
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
      primarySoft: '#FDF2EA',
      secondary: '#C2410C',
      secondaryForeground: '#FFFFFF',
      accent: '#FDBA74',
      accentSoft: '#F8E0CE',
      background: '#FAF4EF',
      surface: '#FEFBF9',
      surfaceAlt: '#F6ECE4',
      textPrimary: '#2F1F13',
      textSecondary: '#675241',
      textMuted: '#7C6758',
      border: '#EDE0D6',
      borderStrong: '#DDCABB',
      ring: '#EA580C',
      shadowRgb: '47 31 19',
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
      primarySoft: '#E7EAFA',
      secondary: '#0F172A',
      secondaryForeground: '#FFFFFF',
      accent: '#3B82F6',
      accentSoft: '#CCD4F3',
      // Deeper and greyer than Royal Blue's ramp on purpose: two blue themes
      // that tint their pages identically are one theme with two names.
      background: '#ECEEF8',
      surface: '#F5F6FC',
      surfaceAlt: '#E1E5F3',
      textPrimary: '#151A2D',
      textSecondary: '#444A64',
      textMuted: '#606680',
      border: '#D4D8E9',
      borderStrong: '#B9BFD9',
      ring: '#172554',
      shadowRgb: '21 26 45',
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
      primarySoft: '#F8F9EB',
      secondary: '#293522',
      secondaryForeground: '#FFFFFF',
      // Warm brass against olive — the palette the fashion reference uses.
      accent: '#B08D57',
      accentSoft: '#F2E9D8',
      background: '#F7F7EF',
      surface: '#FCFCF8',
      surfaceAlt: '#F1F2E5',
      textPrimary: '#292A18',
      textSecondary: '#5F6148',
      textMuted: '#6E7059',
      border: '#E7E8D8',
      borderStrong: '#D5D6BF',
      ring: '#46563C',
      shadowRgb: '41 42 24',
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
  shadowRgb: '--shadow-rgb',
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

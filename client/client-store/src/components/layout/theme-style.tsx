import { resolveTheme, themeToCss } from '@/themes';

/**
 * Paints the store's brand before the first byte of content renders.
 *
 * One deployment serves every store, so the palette cannot be baked into the
 * stylesheet — it has to arrive per request. Emitting it as a server-rendered
 * `<style>` block means the very first paint is already correct: no flash of
 * another brand's colours, no layout shift, and no client-side theming
 * JavaScript at all.
 *
 * The value is not interpolated user input — `resolveTheme` maps an arbitrary
 * string onto one of eight known palettes and falls back when it does not
 * match, so nothing a database row contains can reach the CSS as-is.
 */
export function ThemeStyle({ themeKey }: { themeKey: string | null | undefined }) {
  const theme = resolveTheme(themeKey);

  return (
    <style
      id="storefront-theme"
      data-theme={theme.key}
      // eslint-disable-next-line react/no-danger -- generated from a closed set of hex tokens, never from input
      dangerouslySetInnerHTML={{ __html: themeToCss(theme) }}
    />
  );
}

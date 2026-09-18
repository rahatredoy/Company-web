/**
 * A copy of `client-api/src/lib/utils.ts#slugify`, so a form can preview the
 * address that will actually be saved. **Change them together** — this is the
 * deliberate cross-app copy the repo keeps everywhere else; what it is not is a
 * per-component one, which is what it had become. The brand panel, the category
 * panel and the attribute panel each held their own identical copy, and three
 * copies of one rule is three chances for the preview to disagree with the API.
 *
 * `maxLength` differs per column — brands allow 160, categories 220, attributes
 * 90 — so it stays a parameter rather than a constant. The default matches the
 * API's.
 */
export function slugify(input: string, maxLength = 150): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    // Apostrophes are dropped rather than separated on — see the note on the
    // API's copy. "Men's Clothing" would otherwise preview as `men-s-clothing`.
    .replace(/['‘’ʼ´`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

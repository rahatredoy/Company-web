/**
 * A conservative HTML allow-list for CMS content.
 *
 * This is the **write-side** copy, and the authoritative one: nothing reaches
 * `pages.body_html` without passing through it, so the storefront can render
 * that column as HTML at all. `client-store/src/lib/sanitise-html.ts` is its
 * twin and runs again at render — deliberately duplicated, like every other
 * shared helper in this repo, so one app's upgrade cannot weaken the other.
 * Change one and decide explicitly whether the other needs the same change.
 *
 * The approach is **allow-list, not block-list**. Stripping `<script>` and
 * `onerror=` catches the examples people think of and misses `<svg><animate
 * onbegin>`, `javascript:` in an `href`, `<iframe srcdoc>`, and everything
 * invented next year. Only the tags and attributes named here survive; anything
 * else has its markup removed and its text kept.
 *
 * A real deployment should still run a maintained sanitiser server-side. This
 * is small enough to audit, which is the point of it being here at all.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li',
  'h2', 'h3', 'h4',
  'blockquote', 'code', 'pre',
  'a', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);

/** Only `<a>` keeps an attribute, and only `href`. */
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(['href']),
};

/** Schemes an `href` may use. Notably not `javascript:` or `data:`. */
const SAFE_HREF = /^(?:https?:\/\/|mailto:|tel:|\/(?!\/))/i;

export function sanitiseHtml(html: string | null | undefined): string {
  if (!html) return '';

  return (
    html
      // Whole elements whose *content* is dangerous, not just their tags.
      // Removing `<script>` alone would leave its body as visible text.
      .replace(/<(script|style|iframe|object|embed|noscript|template|svg|math)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<(script|style|iframe|object|embed|noscript|template|svg|math)\b[^>]*\/?>/gi, '')
      // Comments can hide conditional-comment payloads.
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi, (match, rawTag: string, rawAttributes: string) => {
        const tag = rawTag.toLowerCase();
        if (!ALLOWED_TAGS.has(tag)) return '';

        // Closing tags carry no attributes to filter.
        if (match.startsWith('</')) return `</${tag}>`;

        const allowed = ALLOWED_ATTRIBUTES[tag];
        if (!allowed) return `<${tag}>`;

        const kept: string[] = [];
        const attributePattern = /([a-z][a-z0-9-]*)\s*=\s*("([^"]*)"|'([^']*)')/gi;

        let attribute: RegExpExecArray | null;
        while ((attribute = attributePattern.exec(rawAttributes)) !== null) {
          const name = attribute[1]!.toLowerCase();
          if (!allowed.has(name)) continue;

          const value = (attribute[3] ?? attribute[4] ?? '').trim();
          if (name === 'href' && !SAFE_HREF.test(value)) continue;

          kept.push(`${name}="${escapeAttribute(value)}"`);
        }

        // External links get `noreferrer noopener`; without it the opened page
        // can reach back through `window.opener`.
        if (tag === 'a') {
          const href = kept.find((entry) => entry.startsWith('href='));
          if (href && /^href="https?:/i.test(href)) {
            kept.push('target="_blank"', 'rel="noreferrer noopener"');
          }
        }

        return kept.length > 0 ? `<${tag} ${kept.join(' ')}>` : `<${tag}>`;
      })
  );
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

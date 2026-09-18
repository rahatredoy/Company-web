import common from './common';
import layout from './layout';
import productPage from './productPage';
import account from './account';
import home from './home';

/**
 * The Bangla dictionary, one file per area of the storefront.
 *
 * Split so that an area's copy sits in one place and two people translating two
 * areas do not edit the same file. The areas are merged flat: a key is the
 * English text, and the same English means the same thing wherever it appears,
 * so a word shared by several areas — "Add to cart", "View all" — lives once, in
 * `common.ts`. `scripts/i18n-audit.mjs` reports a key defined twice.
 *
 * Every entry is on one line, `'English': 'বাংলা',`, which is what lets the
 * audit read these files without a TypeScript parser.
 *
 * The register is the one Bangladeshi shops already use: polite (আপনি), with
 * commerce words kept as they are said — কার্ট, অর্ডার, ডেলিভারি, স্টক — rather
 * than coined equivalents nobody at the till would recognise.
 */
const bn = {
  ...common,
  ...layout,
  ...productPage,
  ...account,
  ...home,
};

export default bn;

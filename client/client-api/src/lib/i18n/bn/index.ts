import admin from './admin';
import common from './common';
import storefront from './storefront';

/**
 * The Bangla dictionary for what this API says, keyed by the English sentence.
 *
 * One entry per line, `'English': 'বাংলা',` — the same format as the two
 * frontends' dictionaries. The same English means the same thing wherever it is
 * thrown, so it lives once; a message used by both halves of the API belongs in
 * `common.ts`.
 *
 * Messages with values in them cannot be keys; they are `patterns.ts`.
 */
const bn: Readonly<Record<string, string>> = {
  ...common,
  ...admin,
  ...storefront,
};

export default bn;

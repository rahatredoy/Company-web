import common from './common';
import settings from './settings';
import productForm from './productForm';
import products from './products';
import categoriesBrands from './categoriesBrands';
import attributesBanners from './attributesBanners';
import orders from './orders';
import customersContent from './customersContent';
import dashboardAuth from './dashboardAuth';
import shared from './shared';

/**
 * The Bangla dictionary, one file per area of the panel.
 *
 * Split so that a screen's copy sits in one place and two people translating
 * two screens do not edit the same file. The areas are merged flat: a key is
 * the English text, and the same English means the same thing wherever it
 * appears, so a word shared by several screens — "Save", "Status" — lives once,
 * in `common.ts`, and is not repeated here. `scripts/i18n-audit.mjs` reports a
 * key defined twice.
 *
 * Every entry is on one line, `'English': 'বাংলা',`, which is what lets the
 * audit read these files without a TypeScript parser.
 *
 * The register is the one Bangladeshi shops and apps already use: polite
 * (আপনি), with commerce words kept as they are said — অর্ডার, স্টক, কুপন,
 * ক্যাটাগরি, ব্র্যান্ড — rather than coined Sanskrit equivalents nobody at the till
 * would recognise. Product is পণ্য, customer is গ্রাহক, price is দাম.
 */
const bn = {
  ...common,
  ...settings,
  ...productForm,
  ...products,
  ...categoriesBrands,
  ...attributesBanners,
  ...orders,
  ...customersContent,
  ...dashboardAuth,
  ...shared,
};

export default bn;

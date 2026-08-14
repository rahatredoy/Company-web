import { getStoreConfig } from '@/lib/api/store';
import { getHomepageSections, primeProductSummaries } from '@/lib/api/catalog';
import { productIdsIn } from '@/sections/parse';
import { getTemplate } from '@/templates/registry';
import { readLocalePreference } from '@/lib/locale/preference';

/**
 * The homepage is entirely store-configured: which sections appear, in what
 * order, with which products — all of it comes from the store's published
 * configuration. Changing the design or the section order requires no deploy.
 */
export default async function HomePage() {
  const [config, sections] = await Promise.all([getStoreConfig(), getHomepageSections()]);

  /*
   * Every product the page will show, fetched once.
   *
   * Sections are rendered independently and each used to resolve its own rail,
   * so a homepage with half a dozen product blocks was half a dozen round trips
   * for a page that is a single screen to the visitor. Priming here fills the
   * request-scoped map every section reads from, and runs alongside the template
   * load rather than in front of it.
   */
  const [template, locale] = await Promise.all([
    getTemplate(config.design.templateKey),
    readLocalePreference(config),
    primeProductSummaries(productIdsIn(sections)),
  ]);

  return <template.Homepage config={config} sections={sections} locale={locale} />;
}

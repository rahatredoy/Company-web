import { getStoreConfig } from '@/lib/api/store';
import { getHomepageSections } from '@/lib/api/catalog';
import { getTemplate } from '@/templates/registry';
import { readLocalePreference } from '@/lib/locale/preference';

/**
 * The homepage is entirely store-configured: which sections appear, in what
 * order, with which products — all of it comes from the store's published
 * configuration. Changing the design or the section order requires no deploy.
 */
export default async function HomePage() {
  const [config, sections] = await Promise.all([getStoreConfig(), getHomepageSections()]);
  const [template, locale] = await Promise.all([
    getTemplate(config.design.templateKey),
    readLocalePreference(config),
  ]);

  return <template.Homepage config={config} sections={sections} locale={locale} />;
}

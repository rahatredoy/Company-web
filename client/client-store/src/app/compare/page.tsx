import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { readLocalePreference } from '@/lib/locale/preference';
import { CompareTable } from '@/components/commerce/compare-table';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Compare products'),
    robots: { index: false, follow: true },
  };
}

export default async function ComparePage() {
  const config = await getStoreConfig();
  const [locale, t] = await Promise.all([readLocalePreference(config), getT()]);

  return (
    <div className="container-store py-6">
      <h1 className="text-2xl font-semibold sm:text-3xl">{t('Compare products')}</h1>
      <CompareTable locale={locale.language} />
    </div>
  );
}

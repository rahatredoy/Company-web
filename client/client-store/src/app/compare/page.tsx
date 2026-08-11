import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { readLocalePreference } from '@/lib/locale/preference';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { CompareTable } from '@/components/commerce/compare-table';

export const metadata: Metadata = {
  title: 'Compare products',
  robots: { index: false, follow: true },
};

export default async function ComparePage() {
  const config = await getStoreConfig();
  const locale = await readLocalePreference(config);

  return (
    <div className="container-store py-6">
      <Breadcrumbs items={[{ label: 'Compare' }]} className="mb-6" />
      <h1 className="text-2xl font-semibold sm:text-3xl">Compare products</h1>
      <CompareTable locale={locale.language} />
    </div>
  );
}

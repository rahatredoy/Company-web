import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { CollectionPage } from '@/components/catalog/collection-page';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const [config, t] = await Promise.all([getStoreConfig(), getT()]);
  return {
    title: t('Best Sellers'),
    description: t('The most popular products at {store}.', { store: config.store.name }),
    alternates: { canonical: '/best-sellers' },
  };
}

export default async function BestSellersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getT();

  return (
    <CollectionPage
      title={t('Best Sellers')}
      defaults={{ sort: 'best_selling' }}
      searchParams={await searchParams}
    />
  );
}

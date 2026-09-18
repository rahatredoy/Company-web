import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { CollectionPage } from '@/components/catalog/collection-page';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const [config, t] = await Promise.all([getStoreConfig(), getT()]);
  return {
    title: t('New Arrivals'),
    description: t('The latest additions to {store}, newest first.', { store: config.store.name }),
    alternates: { canonical: '/new-arrivals' },
  };
}

export default async function NewArrivalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getT();

  return (
    <CollectionPage
      title={t('New Arrivals')}
      defaults={{ sort: 'newest' }}
      searchParams={await searchParams}
    />
  );
}

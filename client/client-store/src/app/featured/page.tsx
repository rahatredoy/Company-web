import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { CollectionPage } from '@/components/catalog/collection-page';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const [config, t] = await Promise.all([getStoreConfig(), getT()]);
  return {
    title: t('Featured'),
    description: t('A hand-picked selection from {store}.', { store: config.store.name }),
    alternates: { canonical: '/featured' },
  };
}

export default async function FeaturedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getT();

  return (
    <CollectionPage
      title={t('Featured')}
      defaults={{ sort: 'rating' }}
      searchParams={await searchParams}
    />
  );
}

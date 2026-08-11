import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { CollectionPage } from '@/components/catalog/collection-page';

export async function generateMetadata(): Promise<Metadata> {
  const config = await getStoreConfig();
  return {
    title: 'Featured',
    description: `A hand-picked selection from ${config.store.name}.`,
    alternates: { canonical: '/featured' },
  };
}

export default async function FeaturedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <CollectionPage
      title="Featured"
      intro="A selection chosen by hand, updated regularly."
      defaults={{ sort: 'rating' }}
      searchParams={await searchParams}
    />
  );
}

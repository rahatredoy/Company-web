import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { CollectionPage } from '@/components/catalog/collection-page';

export async function generateMetadata(): Promise<Metadata> {
  const config = await getStoreConfig();
  return {
    title: 'New Arrivals',
    description: `The latest additions to ${config.store.name}, newest first.`,
    alternates: { canonical: '/new-arrivals' },
  };
}

export default async function NewArrivalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <CollectionPage
      title="New Arrivals"
      intro="Everything we have added recently, newest first."
      defaults={{ sort: 'newest' }}
      searchParams={await searchParams}
    />
  );
}

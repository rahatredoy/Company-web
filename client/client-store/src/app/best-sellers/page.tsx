import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { CollectionPage } from '@/components/catalog/collection-page';

export async function generateMetadata(): Promise<Metadata> {
  const config = await getStoreConfig();
  return {
    title: 'Best Sellers',
    description: `The most popular products at ${config.store.name}.`,
    alternates: { canonical: '/best-sellers' },
  };
}

export default async function BestSellersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <CollectionPage
      title="Best Sellers"
      intro="What other customers are buying most. Ranked by real sales, not by us."
      defaults={{ sort: 'best_selling' }}
      searchParams={await searchParams}
    />
  );
}

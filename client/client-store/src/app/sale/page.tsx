import type { Metadata } from 'next';
import { getStoreConfig } from '@/lib/api/store';
import { CollectionPage } from '@/components/catalog/collection-page';

export async function generateMetadata(): Promise<Metadata> {
  const config = await getStoreConfig();
  return {
    title: 'Sale',
    description: `Everything currently reduced at ${config.store.name}.`,
    alternates: { canonical: '/sale' },
  };
}

export default async function SalePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <CollectionPage
      title="Sale"
      // The banner below already says what this page is, in far larger type.
      headingHidden
      defaults={{ sale: true }}
      searchParams={await searchParams}
      hero={
        <div className="mb-8 overflow-hidden rounded-(--radius-card) bg-primary p-6 text-primary-foreground sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] opacity-80">
            Limited time
          </p>
          <p className="mt-2 text-2xl font-bold sm:text-3xl">Up to 50% off selected items</p>
          {/*
            Deliberately no countdown here. The design brief rules out invented
            urgency, and a clock on a permanent sale page would be exactly that.
            A real campaign carries its own end date and gets one.
          */}
          <p className="mt-2 max-w-prose text-sm opacity-85">
            Reductions are applied at checkout automatically — there is no code to enter.
          </p>
        </div>
      }
    />
  );
}

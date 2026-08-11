import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getStoreConfig } from '@/lib/api/store';
import { getBrands } from '@/lib/api/catalog';
import { Breadcrumb } from '@/components/catalog/product-listing';
import { pluralise } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const config = await getStoreConfig();
  return {
    title: 'Brands',
    description: `Shop by brand at ${config.store.name}.`,
    alternates: { canonical: '/brands' },
  };
}

export default async function BrandsPage() {
  const brands = await getBrands();

  return (
    <div className="container-store py-6">
      <Breadcrumb trail={[{ name: 'Brands' }]} />
      <h1 className="mb-6 text-2xl font-semibold sm:text-3xl">Brands</h1>

      {brands.length === 0 ? (
        <p className="rounded-(--radius-card) border border-border bg-surface px-6 py-16 text-center text-sm text-muted">
          This store has not added any brands yet.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {brands.map((brand) => (
            <li key={brand.id}>
              <Link
                href={`/brand/${brand.slug}`}
                className="flex h-32 flex-col items-center justify-center gap-2 rounded-(--radius-card) border border-border bg-surface p-4 text-center transition-shadow hover:shadow-[var(--shadow-card)]"
              >
                {brand.logoUrl ? (
                  <Image src={brand.logoUrl} alt={brand.name} width={96} height={32} className="object-contain" />
                ) : (
                  <span className="text-base font-semibold">{brand.name}</span>
                )}
                <span className="text-xs text-subtle">
                  {brand.productCount} {pluralise(brand.productCount, 'product')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

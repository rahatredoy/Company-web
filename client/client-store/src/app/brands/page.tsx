import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getStoreConfig } from '@/lib/api/store';
import { getBrands } from '@/lib/api/catalog';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const [config, t] = await Promise.all([getStoreConfig(), getT()]);
  return {
    title: t('Brands'),
    description: t('Shop by brand at {store}.', { store: config.store.name }),
    alternates: { canonical: '/brands' },
  };
}

export default async function BrandsPage() {
  const [brands, t] = await Promise.all([getBrands(), getT()]);

  return (
    <div className="container-store py-6">
      <h1 className="sr-only">{t('Brands')}</h1>

      {brands.length === 0 ? (
        <p className="rounded-(--radius-card) border border-border bg-surface px-6 py-16 text-center text-sm text-muted">
          {t('This store has not added any brands yet.')}
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
                  {t.plural(brand.productCount, '{count} product', '{count} products')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

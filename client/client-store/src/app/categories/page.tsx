import type { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { getStoreConfig } from '@/lib/api/store';
import { getCategories } from '@/lib/api/catalog';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { EmptyState } from '@/components/ui/empty-state';
import { pluralise } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const config = await getStoreConfig();
  return {
    title: 'Categories',
    description: `Browse every department at ${config.store.name}.`,
    alternates: { canonical: '/categories' },
  };
}

/**
 * The category index.
 *
 * Shows every department with its children listed underneath, rather than
 * making someone open each one to discover what is inside it. On a broad
 * catalogue that second click is where people give up.
 */
export default async function CategoriesPage() {
  const categories = await getCategories();

  if (categories.length === 0) {
    return (
      <div className="container-store py-6">
        <Breadcrumbs items={[{ label: 'Categories' }]} className="mb-6" />
        <EmptyState title="No categories yet" description="This store has not published any categories." />
      </div>
    );
  }

  return (
    <div className="container-store py-6">
      <Breadcrumbs items={[{ label: 'Categories' }]} className="mb-6" />
      <h1 className="text-2xl font-semibold sm:text-3xl">Categories</h1>
      <p className="mt-2 text-muted">Everything we sell, grouped by department.</p>

      <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => (
          <li
            key={category.id}
            className="overflow-hidden rounded-(--radius-card) border border-border bg-surface"
          >
            <Link href={`/category/${category.slug}`} className="group block">
              <span className="product-media block rounded-b-none">
                {category.imageUrl ? (
                  <Image
                    src={category.imageUrl}
                    alt=""
                    aria-hidden
                    fill
                    sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                    className="object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                ) : null}
              </span>

              <span className="block p-4">
                <span className="block font-semibold group-hover:text-primary">{category.name}</span>
                <span className="mt-0.5 block text-xs text-subtle">
                  {category.productCount} {pluralise(category.productCount, 'product')}
                </span>
              </span>
            </Link>

            {category.children.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5 border-t border-border p-4 pt-3">
                {category.children.map((child) => (
                  <li key={child.id}>
                    <Link
                      href={`/category/${child.slug}`}
                      className="inline-block rounded-(--radius-pill) bg-surface-alt px-2.5 py-1 text-xs text-muted transition-colors hover:bg-primary-soft hover:text-primary"
                    >
                      {child.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

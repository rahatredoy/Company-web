import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { ProductForm } from '@/components/admin/product-form';
import { serverGet, serverGetPaginated } from '@/lib/server-api';
import type { BrandRow, CategoryRow, SessionResponse } from '@/lib/types';

export const metadata: Metadata = { title: 'New product' };
export const dynamic = 'force-dynamic';

export default async function NewProductPage() {
  // The pickers need the whole list, not a page of it — a store with more
  // categories than this has outgrown a dropdown and needs a search field,
  // which is a change to make when that store exists rather than in advance.
  const [session, categories, brands] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    serverGetPaginated<CategoryRow>('/api/v1/admin/categories', { pageSize: 100, status: 'active' }),
    serverGetPaginated<BrandRow>('/api/v1/admin/brands', { pageSize: 100, status: 'active' }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="New product" description="It stays a draft until you set it active." />
      <ProductForm
        categories={categories.data}
        brands={brands.data}
        currency={session.authenticated ? session.store.currency : 'USD'}
      />
    </div>
  );
}

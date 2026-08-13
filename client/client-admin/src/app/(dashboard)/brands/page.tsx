import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
import { TableFilters } from '@/components/admin/table-filters';
import { TaxonomyManager, type TaxonomyRow } from '@/components/admin/taxonomy-manager';
import { serverGet, serverGetPaginated } from '@/lib/server-api';
import { can, type BrandRow, type SessionResponse } from '@/lib/types';

export const metadata: Metadata = { title: 'Brands' };
export const dynamic = 'force-dynamic';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Hidden' },
];

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const [session, page] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    serverGetPaginated<BrandRow>('/api/v1/admin/brands', {
      page: single('page') ?? 1,
      search: single('search'),
      status: single('status'),
    }),
  ]);

  const rows: TaxonomyRow[] = page.data.map((brand) => ({
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    isActive: brand.isActive,
    productCount: brand.productCount,
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Brands" description="Who makes what you sell. Optional — a product needs no brand." />

      <TableFilters searchPlaceholder="Search brands…" statusOptions={STATUS_FILTERS} />

      <TaxonomyManager
        kind="brand"
        rows={rows}
        canManage={session.authenticated && can(session.admin, 'brands.manage')}
      />

      <Pagination {...page.meta} />
    </div>
  );
}

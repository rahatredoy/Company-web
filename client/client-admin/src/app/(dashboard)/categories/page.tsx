import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
import { TableFilters } from '@/components/admin/table-filters';
import { TaxonomyManager, type TaxonomyRow } from '@/components/admin/taxonomy-manager';
import { serverGet, serverGetPaginated } from '@/lib/server-api';
import { can, type CategoryRow, type SessionResponse } from '@/lib/types';

export const metadata: Metadata = { title: 'Categories' };
export const dynamic = 'force-dynamic';

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Hidden' },
];

export default async function CategoriesPage({
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
    serverGetPaginated<CategoryRow>('/api/v1/admin/categories', {
      page: single('page') ?? 1,
      search: single('search'),
      status: single('status'),
    }),
  ]);

  // The list is filtered and paginated, so a parent shown in the table may not
  // be in it. The names are resolved from a separate unfiltered read, or a child
  // would appear to have no parent whenever the filter excluded one.
  const all = await serverGetPaginated<CategoryRow>('/api/v1/admin/categories', { pageSize: 100 });
  const nameById = new Map(all.data.map((category) => [category.id, category.name]));

  const rows: TaxonomyRow[] = page.data.map((category) => ({
    id: category.id,
    name: category.name,
    slug: category.slug,
    isActive: category.isActive,
    productCount: category.productCount,
    parentId: category.parentId,
    parentName: category.parentId ? (nameById.get(category.parentId) ?? null) : null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Categories"
        description="How your products are grouped on the storefront. A category can sit inside another."
      />

      <TableFilters searchPlaceholder="Search categories…" statusOptions={STATUS_FILTERS} />

      <TaxonomyManager
        kind="category"
        rows={rows}
        parents={all.data.map((category) => ({ id: category.id, name: category.name }))}
        canManage={session.authenticated && can(session.admin, 'categories.manage')}
      />

      <Pagination {...page.meta} />
    </div>
  );
}

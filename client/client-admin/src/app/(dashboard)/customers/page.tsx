import type { Metadata } from 'next';
import { Users } from 'lucide-react';
import type { CustomerRow, SessionResponse } from '@/lib/types';
import { serverGet, serverGetListed } from '@/lib/server-api';
import { BATCH_SIZE } from '@/lib/list';
import { CustomerList } from '@/components/admin/customer-list';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { TableFilters } from '@/components/admin/table-filters';

export const metadata: Metadata = { title: 'Customers' };
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All customers' },
  { value: 'active', label: 'Active' },
  { value: 'blocked', label: 'Blocked' },
];

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const session = await serverGet<SessionResponse>('/api/v1/admin/auth/session');
  const currency = session.authenticated ? session.store.currency : 'USD';

  /*
   * The filters, in one object, so the first batch here and every batch the
   * browser asks for afterwards are read with exactly the same query — a cursor
   * into one filtered list means nothing in another.
   */
  const query = {
    search: single('search'),
    status: single('status'),
    sort: single('sort'),
    order: single('order'),
  };

  // No cursor, which is what makes the API count the filtered list and report
  // `total`. The batches after this one are asked for by cursor and skip it.
  const first = await serverGetListed<CustomerRow>('/api/v1/admin/customers', {
    ...query,
    pageSize: BATCH_SIZE,
  });

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader title="Customers" description="Everyone who has an account with your store." />

      <TableFilters searchPlaceholder="Name, email or phone" statusOptions={STATUS_OPTIONS} />

      {first.data.length === 0 && !filtered ? (
        <EmptyState
          icon={Users}
          title="No customers yet"
          description="Accounts appear here when shoppers register on your storefront."
        />
      ) : (
        <CustomerList
          initial={{ rows: first.data, meta: first.meta }}
          currency={currency}
          query={query}
          filtered={filtered}
        />
      )}
    </div>
  );
}

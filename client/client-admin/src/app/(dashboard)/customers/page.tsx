import type { Metadata } from 'next';
import { Users } from 'lucide-react';
import type { CustomerRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetListed, serverGetOptional } from '@/lib/server-api';
import { BATCH_SIZE } from '@/lib/list';
import { CustomerList } from '@/components/admin/customer-list';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { TableFilters } from '@/components/admin/table-filters';
import type { MessageKey } from '@/lib/i18n';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Customers') };
}

export const dynamic = 'force-dynamic';

const STATUS_OPTIONS: { value: string; label: MessageKey }[] = [
  { value: 'all', label: 'All customers' },
  { value: 'active', label: 'Active' },
  { value: 'blocked', label: 'Blocked' },
];

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getT();
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const session = await serverGet<SessionResponse>('/api/v1/admin/auth/session');
  const currency = session.authenticated ? session.store.currency : 'USD';
  const canUpdate = session.authenticated && can(session.admin, 'customers.update');

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
  // `?view=<id>` is how every other screen links to one customer: the list opens
  // with its panel showing. An id that names nothing just opens the list.
  const viewId = single('view');
  const [first, initialView] = await Promise.all([
    serverGetListed<CustomerRow>('/api/v1/admin/customers', {
      ...query,
      pageSize: BATCH_SIZE,
    }),
    viewId && /^[0-9a-f-]{36}$/i.test(viewId)
      ? serverGetOptional<CustomerRow>(`/api/v1/admin/customers/${viewId}`)
      : Promise.resolve(null),
  ]);

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader title={t('Customers')} description={t('Everyone who has an account with your store.')} />

      <TableFilters
        searchPlaceholder={t('Name, email or phone')}
        statusOptions={STATUS_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
      />

      {first.data.length === 0 && !filtered ? (
        <EmptyState
          icon={Users}
          title={t('No customers yet')}
          description={t('Accounts appear here when shoppers register on your storefront.')}
        />
      ) : (
        <CustomerList
          initial={{ rows: first.data, meta: first.meta }}
          currency={currency}
          query={query}
          filtered={filtered}
          canUpdate={canUpdate}
          initialView={initialView}
        />
      )}
    </div>
  );
}

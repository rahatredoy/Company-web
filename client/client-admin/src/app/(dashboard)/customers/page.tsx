import type { Metadata } from 'next';
import Link from 'next/link';
import { Users } from 'lucide-react';
import type { CustomerRow, SessionResponse } from '@/lib/types';
import { serverGet, serverGetPaginated } from '@/lib/server-api';
import { formatDate, formatMoney } from '@/lib/format';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
import { TableFilters } from '@/components/admin/table-filters';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';

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

  const { data, meta } = await serverGetPaginated<CustomerRow>('/api/v1/admin/customers', {
    page: single('page') ?? 1,
    search: single('search'),
    status: single('status'),
    sort: single('sort'),
    order: single('order'),
  });

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader title="Customers" description="Everyone who has an account with your store." />

      <TableFilters searchPlaceholder="Name, email or phone" statusOptions={STATUS_OPTIONS} />

      {data.length === 0 && !filtered ? (
        <EmptyState
          icon={Users}
          title="No customers yet"
          description="Accounts appear here when shoppers register on your storefront."
        />
      ) : (
        <>
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableEmpty colSpan={5}>No customer matches those filters.</TableEmpty>
                ) : (
                  data.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <Link href={`/customers/${customer.id}`} className="font-medium hover:underline">
                          {customer.fullName}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{customer.email}</span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(customer.createdAt)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={customer.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{customer.orderCount}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(customer.totalSpent, currency)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableWrapper>
          <Pagination {...meta} />
        </>
      )}
    </div>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { Wallet } from 'lucide-react';
import type { RefundRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetPaginated } from '@/lib/server-api';
import { formatDate, formatMoney } from '@/lib/format';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { Pagination } from '@/components/admin/pagination';
import { RefundActions } from '@/components/admin/refund-actions';
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

export const metadata: Metadata = { title: 'Refunds' };
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All refunds' },
  { value: 'requested', label: 'Waiting on you' },
  { value: 'approved', label: 'Approved' },
  { value: 'completed', label: 'Paid' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'failed', label: 'Failed' },
];

export default async function RefundsPage({
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
  const canApprove = session.authenticated && can(session.admin, 'refunds.approve');

  const { data, meta } = await serverGetPaginated<RefundRow>('/api/v1/admin/refunds', {
    page: single('page') ?? 1,
    search: single('search'),
    status: single('status'),
  });

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Refunds"
        description="Money going back out. A refund is raised by a completed return and paid here."
      />

      <TableFilters searchPlaceholder="Refund or order number" statusOptions={STATUS_OPTIONS} />

      {data.length === 0 && !filtered ? (
        <EmptyState
          icon={Wallet}
          title="No refunds"
          description="Completing a return raises one here for approval."
        />
      ) : (
        <>
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Refund</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Raised</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="w-64" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableEmpty colSpan={6}>No refund matches those filters.</TableEmpty>
                ) : (
                  data.map((refund) => (
                    <TableRow key={refund.id}>
                      <TableCell>
                        <span className="block font-mono text-sm font-medium">{refund.refundNumber}</span>
                        <span className="block text-xs text-muted-foreground">{refund.customerName}</span>
                      </TableCell>
                      <TableCell>
                        <Link href={`/orders/${refund.orderId}`} className="font-mono text-sm hover:underline">
                          {refund.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(refund.createdAt)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={refund.status} />
                        {refund.method ? (
                          <span className="block text-xs text-muted-foreground">via {refund.method}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(refund.amount, refund.currency)}
                      </TableCell>
                      <TableCell>
                        <RefundActions refund={refund} canApprove={canApprove} />
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

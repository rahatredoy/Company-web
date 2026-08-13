import type { Metadata } from 'next';
import Link from 'next/link';
import { RotateCcw } from 'lucide-react';
import type { ReturnRow } from '@/lib/types';
import { serverGetPaginated } from '@/lib/server-api';
import { formatDate, formatMoney, titleCase } from '@/lib/format';
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

export const metadata: Metadata = { title: 'Returns' };
export const dynamic = 'force-dynamic';

const STATUS_OPTIONS = [
  { value: 'all', label: 'All returns' },
  { value: 'requested', label: 'Waiting on you' },
  { value: 'approved', label: 'Approved' },
  { value: 'received', label: 'Received' },
  { value: 'inspected', label: 'Inspected' },
  { value: 'completed', label: 'Completed' },
  { value: 'rejected', label: 'Rejected' },
];

export default async function ReturnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const { data, meta } = await serverGetPaginated<ReturnRow>('/api/v1/admin/returns', {
    page: single('page') ?? 1,
    search: single('search'),
    status: single('status'),
  });

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader title="Returns" description="What customers have asked to send back." />
      <TableFilters searchPlaceholder="Return or order number" statusOptions={STATUS_OPTIONS} />

      {data.length === 0 && !filtered ? (
        <EmptyState
          icon={RotateCcw}
          title="No returns"
          description="A customer can request one from their own order page after it is delivered."
        />
      ) : (
        <>
          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Return</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Refundable</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.length === 0 ? (
                  <TableEmpty colSpan={6}>No return matches those filters.</TableEmpty>
                ) : (
                  data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Link
                          href={`/returns/${row.id}`}
                          className="font-mono text-sm font-medium hover:underline"
                        >
                          {row.returnNumber}
                        </Link>
                        <span className="block text-xs text-muted-foreground">{row.customerName}</span>
                      </TableCell>
                      <TableCell>
                        <Link href={`/orders/${row.orderId}`} className="font-mono text-sm hover:underline">
                          {row.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(row.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm">{titleCase(row.reason)}</TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.refundableAmount, row.currency)}
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

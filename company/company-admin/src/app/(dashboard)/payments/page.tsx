import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { CreditCard } from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { TableFilters } from '@/components/admin/table-filters';
import { Pagination } from '@/components/admin/pagination';
import { EmptyState } from '@/components/admin/empty-state';
import { ApiUnavailable } from '@/components/admin/api-unavailable';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { listOrEmpty } from '@/lib/admin-api';
import { formatDateTime, formatMoney, titleCase } from '@/lib/format';
import type { PaymentRow } from '@/lib/types';

export const metadata: Metadata = { title: 'Payments' };

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'failed', label: 'Failed' },
  { value: 'refunded', label: 'Refunded' },
];

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const { data: payments, meta, unavailable } = await listOrEmpty<PaymentRow>('/api/v1/admin/payments', params);

  return (
    <>
      <PageHeader
        title="Payments"
        description="Subscription payments recorded from verified gateway webhooks."
      />

      {unavailable ? <ApiUnavailable resource="The payment list" /> : null}

      <Suspense fallback={<Skeleton className="h-10 w-full" />}>
        <TableFilters
          searchPlaceholder="Search transaction ID or business name…"
          statusOptions={STATUS_FILTERS}
        />
      </Suspense>

      {payments.length === 0 ? (
        <EmptyState icon={CreditCard} title="No payments found" />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <TableWrapper className="rounded-xl border-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction ID</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead>Gateway</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => (
                    <TableRow key={payment.id}>
                      <TableCell>
                        <code className="font-mono text-xs text-muted-foreground">
                          {payment.transactionId ?? '—'}
                        </code>
                      </TableCell>
                      <TableCell>
                        <Link href={`/clients/${payment.clientId}`} className="font-medium hover:text-primary">
                          {payment.businessName}
                        </Link>
                      </TableCell>
                      <TableCell>{payment.planName ?? '—'}</TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        {formatMoney(payment.amount, payment.currency)}
                      </TableCell>
                      <TableCell>{payment.currency}</TableCell>
                      <TableCell>{titleCase(payment.provider)}</TableCell>
                      <TableCell>
                        <StatusBadge status={payment.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDateTime(payment.paidAt ?? payment.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          </CardContent>
        </Card>
      )}

      <Suspense fallback={null}>
        <Pagination {...meta} />
      </Suspense>
    </>
  );
}

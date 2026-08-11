import type { Metadata } from 'next';
import Link from 'next/link';
import { Wallet } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { Pagination } from '@/components/dashboard/pagination';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { serverGetPaginated } from '@/lib/server-api';
import { formatDateTime, formatMoney, titleCase } from '@/lib/format';
import type { PaymentView } from '@/lib/types';

export const metadata: Metadata = { title: 'Billing', robots: { index: false, follow: false } };

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;
  const { data: payments, meta } = await serverGetPaginated<PaymentView>('/api/v1/client/payments', {
    page: page ?? 1,
    pageSize: 20,
  }).catch(() => ({ data: [] as PaymentView[], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }));

  return (
    <>
      <PageHeader
        title="Billing"
        description="Every payment made for your subscription."
        actions={
          <Button asChild variant="outline">
            <Link href="/dashboard/invoices">View invoices</Link>
          </Button>
        }
      />


      {payments.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No payments yet"
          description="Payments appear here once your first subscription charge is processed."
        />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <TableWrapper className="rounded-xl border-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Transaction</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Gateway</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
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
                      <TableCell>{payment.planName ?? '—'}</TableCell>
                      <TableCell>{titleCase(payment.provider)}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoney(payment.amount, payment.currency)}
                      </TableCell>
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

      <Pagination {...meta} basePath="/dashboard/billing" />
    </>
  );
}

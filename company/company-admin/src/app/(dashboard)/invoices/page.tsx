import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { FileText } from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { TableFilters } from '@/components/admin/table-filters';
import { Pagination } from '@/components/admin/pagination';
import { EmptyState } from '@/components/admin/empty-state';
import { ApiUnavailable } from '@/components/admin/api-unavailable';
import { InvoiceActions } from '@/components/admin/invoice-actions';
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
import { formatDate, formatMoney } from '@/lib/format';
import type { InvoiceRow } from '@/lib/types';

export const metadata: Metadata = { title: 'Invoices' };

const STATUS_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'issued', label: 'Issued' },
  { value: 'paid', label: 'Paid' },
  { value: 'void', label: 'Void' },
  { value: 'refunded', label: 'Refunded' },
];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; search?: string; status?: string }>;
}) {
  const params = await searchParams;
  const { data: invoices, meta, unavailable } = await listOrEmpty<InvoiceRow>('/api/v1/admin/invoices', params);

  return (
    <>
      <PageHeader title="Invoices" description="Subscription invoices issued to clients." />

      {unavailable ? <ApiUnavailable resource="The invoice list" /> : null}

      <Suspense fallback={<Skeleton className="h-10 w-full" />}>
        <TableFilters
          searchPlaceholder="Search invoice number or business name…"
          statusOptions={STATUS_FILTERS}
        />
      </Suspense>

      {invoices.length === 0 ? (
        <EmptyState icon={FileText} title="No invoices found" />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <TableWrapper className="rounded-xl border-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium whitespace-nowrap">{invoice.invoiceNumber}</TableCell>
                      <TableCell>
                        <Link href={`/clients/${invoice.clientId}`} className="font-medium hover:text-primary">
                          {invoice.businessName}
                        </Link>
                      </TableCell>
                      <TableCell>{invoice.planName ?? '—'}</TableCell>
                      <TableCell className="text-right font-medium whitespace-nowrap">
                        {formatMoney(invoice.amount, invoice.currency)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={invoice.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(invoice.issuedAt)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(invoice.paidAt)}
                      </TableCell>
                      <TableCell>
                        <InvoiceActions invoiceId={invoice.id} />
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

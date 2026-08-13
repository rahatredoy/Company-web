import type { Metadata } from 'next';
import { Download, FileText } from 'lucide-react';
import { PageHeader } from '@/components/dashboard/page-header';
import { EmptyState } from '@/components/dashboard/empty-state';
import { BillingRequired } from '@/components/dashboard/billing-required';
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
import { serverGetOptional, serverGetPaginated } from '@/lib/server-api';
import { billingGate } from '@/lib/billing-gate';
import { formatDate, formatMoney } from '@/lib/format';
import { publicEnv } from '@/lib/env';
import type { InvoiceView, OnboardingState } from '@/lib/types';

export const metadata: Metadata = { title: 'Invoices', robots: { index: false, follow: false } };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page } = await searchParams;

  // The first invoice *is* the first bill — a trial's is issued at 0.00 like any
  // other. There is nothing to list before it, so the outstanding bill is what
  // this page shows instead of an empty table.
  const gate = billingGate(await serverGetOptional<OnboardingState>('/api/v1/client/onboarding'));
  if (!gate.complete) {
    return (
      <>
        <PageHeader title="Invoices" description="Your first invoice is issued when your bill is paid." />
        <BillingRequired gate={gate} feature="Invoices" />
      </>
    );
  }

  const { data: invoices, meta } = await serverGetPaginated<InvoiceView>('/api/v1/client/invoices', {
    page: page ?? 1,
    pageSize: 20,
  }).catch(() => ({ data: [] as InvoiceView[], meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 } }));

  return (
    <>
      <PageHeader title="Invoices" description="Download invoices for your subscription payments." />

      {invoices.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No invoices yet"
          description="An invoice is issued each time a subscription payment succeeds."
        />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <TableWrapper className="rounded-xl border-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Cycle</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-medium whitespace-nowrap">{invoice.invoiceNumber}</TableCell>
                      <TableCell>{invoice.planName ?? '—'}</TableCell>
                      <TableCell className="capitalize">{invoice.billingCycle ?? '—'}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoney(invoice.amount, invoice.currency)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={invoice.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(invoice.issuedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <a
                            href={`${publicEnv.apiUrl}/api/v1/client/invoices/${invoice.id}/download`}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            <Download /> Download
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          </CardContent>
        </Card>
      )}

      <Pagination {...meta} basePath="/dashboard/invoices" />
    </>
  );
}

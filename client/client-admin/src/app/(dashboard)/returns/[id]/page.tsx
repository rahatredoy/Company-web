import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReturnDetail, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { serverGet, serverGetOptional } from '@/lib/server-api';
import { formatDateTime, formatMoney, titleCase } from '@/lib/format';
import { PageHeader } from '@/components/admin/page-header';
import { ReturnWorkflow } from '@/components/admin/return-workflow';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

export const metadata: Metadata = { title: 'Return' };
export const dynamic = 'force-dynamic';

export default async function ReturnDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const detail = await serverGetOptional<ReturnDetail>(`/api/v1/admin/returns/${id}`);
  if (!detail) notFound();

  const session = await serverGet<SessionResponse>('/api/v1/admin/auth/session');
  const canApprove = session.authenticated && can(session.admin, 'returns.approve');

  return (
    <div className="space-y-6">
      <PageHeader
        title={detail.returnNumber}
        description={
          <span>
            {formatDateTime(detail.createdAt)} · {detail.customerName} · order{' '}
            <Link href={`/orders/${detail.orderId}`} className="hover:underline">
              {detail.orderNumber}
            </Link>
          </span>
        }
        actions={
          <div className="flex gap-2">
            <StatusBadge status={detail.status} />
            <StatusBadge status={detail.resolution} label={titleCase(detail.resolution)} />
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Items</CardTitle>
            </CardHeader>
            <CardContent>
              <TableWrapper>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Restocked</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <span className="block font-medium">{item.productName}</span>
                          <span className="block text-xs text-muted-foreground">
                            {item.sku ?? '—'}
                            {item.inspectionResult ? ` · ${titleCase(item.inspectionResult)}` : ''}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">{item.restockedQuantity}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(item.lineTotal, detail.currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Why</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-medium">{titleCase(detail.reason)}</p>
              {detail.description ? <p className="text-muted-foreground">{detail.description}</p> : null}
              {detail.rejectionReason ? (
                <p className="text-muted-foreground">Rejected: {detail.rejectionReason}</p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3 text-sm">
                {detail.history.map((entry) => (
                  <li key={entry.id} className="flex gap-3">
                    <span className="w-40 shrink-0 text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </span>
                    <span>
                      <span className="font-medium">{titleCase(entry.toStatus)}</span>
                      {entry.note ? <span className="text-muted-foreground"> · {entry.note}</span> : null}
                      {entry.adminLabel ? (
                        <span className="block text-xs text-muted-foreground">by {entry.adminLabel}</span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <ReturnWorkflow detail={detail} canApprove={canApprove} />

          <Card>
            <CardHeader>
              <CardTitle>Refundable</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">
                {formatMoney(detail.refundableAmount, detail.currency)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Capped at what is left unrefunded on the order.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

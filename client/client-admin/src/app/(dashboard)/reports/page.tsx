import type { Metadata } from 'next';
import { ChartNoAxesCombined, PackageCheck, Receipt, Users } from 'lucide-react';
import type { ReportsPayload, SessionResponse } from '@/lib/types';
import { serverGet } from '@/lib/server-api';
import { formatMoney, formatNumber } from '@/lib/format';
import { EmptyState } from '@/components/admin/empty-state';
import { KpiCard } from '@/components/admin/kpi-card';
import { PageHeader } from '@/components/admin/page-header';
import { Sparkline } from '@/components/admin/sparkline';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';

export const metadata: Metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

const RANGES = [7, 30, 90];

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = Array.isArray(params.days) ? params.days[0] : params.days;
  const days = RANGES.includes(Number(raw)) ? Number(raw) : 30;

  const [session, report] = await Promise.all([
    serverGet<SessionResponse>('/api/v1/admin/auth/session'),
    serverGet<ReportsPayload>('/api/v1/admin/reports', { days }),
  ]);

  const currency = report.currency || (session.authenticated ? session.store.currency : 'USD');
  const money = (value: string) => formatMoney(value, currency);
  const revenueSeries = report.daily.map((day) => Number(day.revenue));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={`The last ${days} days. Cancelled and failed orders are left out of every figure.`}
        actions={
          <div className="flex gap-1 rounded-md border p-1">
            {RANGES.map((range) => (
              <a
                key={range}
                href={`/reports?days=${range}`}
                className={`rounded px-3 py-1 text-sm ${
                  range === days ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'
                }`}
              >
                {range}d
              </a>
            ))}
          </div>
        }
      />

      {report.totals.orders === 0 ? (
        <EmptyState
          icon={ChartNoAxesCombined}
          title="Nothing to report yet"
          description="Once your store takes an order, its numbers appear here."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard label="Revenue" value={money(report.totals.revenue)} icon={Receipt} tint="success" />
            <KpiCard label="Orders" value={formatNumber(report.totals.orders)} icon={PackageCheck} tint="primary" />
            <KpiCard label="Average order" value={money(report.totals.averageOrderValue)} icon={ChartNoAxesCombined} tint="info" />
            <KpiCard label="New customers" value={formatNumber(report.totals.newCustomers)} icon={Users} tint="primary" />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardTitle>Revenue by day</CardTitle>
              </CardHeader>
              <CardContent>
                <Sparkline data={revenueSeries} width={720} height={120} className="w-full" />
                <TableWrapper className="mt-4">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Day</TableHead>
                        <TableHead className="text-right">Orders</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.daily.map((day) => (
                        <TableRow key={day.day}>
                          <TableCell className="text-sm">{day.day}</TableCell>
                          <TableCell className="text-right tabular-nums">{day.orders}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(day.revenue)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableWrapper>
              </CardContent>
            </Card>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Money back out</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Discounts given</span>
                    <span className="tabular-nums">{money(report.totals.discounts)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Refunded</span>
                    <span className="tabular-nums">{money(report.totals.refunded)}</span>
                  </div>
                  <div className="flex justify-between border-t pt-2">
                    <span className="text-muted-foreground">Products on sale</span>
                    <span className="tabular-nums">{formatNumber(report.totals.activeProducts)}</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Best sellers</CardTitle>
                </CardHeader>
                <CardContent>
                  {report.topProducts.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Nothing sold in this period.</p>
                  ) : (
                    <ol className="space-y-2.5">
                      {report.topProducts.map((product) => (
                        <li key={product.name} className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate">{product.name}</span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {product.units} · {money(product.revenue)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

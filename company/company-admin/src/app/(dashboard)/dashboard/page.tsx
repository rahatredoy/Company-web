import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CalendarDays,
  CircleDollarSign,
  CreditCard,
  Timer,
  TrendingUp,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
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
import { KpiCard } from '@/components/admin/kpi-card';
import { RangeSelect } from '@/components/admin/range-select';
import { ActivityFeed } from '@/components/admin/activity-feed';
import { ConversionBars, GrowthChart, RevenueChart, SubscriptionDonut } from '@/components/admin/charts';
import { serverGetOptional } from '@/lib/server-api';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import type { ChartSeries, DashboardSummary } from '@/lib/types';

export const metadata: Metadata = { title: 'Dashboard' };

const COMPARE_LABELS: Record<string, string> = {
  '7d': 'vs previous 7 days',
  '30d': 'vs previous 30 days',
  '3m': 'vs previous 3 months',
  '6m': 'vs previous 6 months',
  '1y': 'vs previous year',
  custom: 'vs preceding period',
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; from?: string; to?: string }>;
}) {
  const { range = '30d', from, to } = await searchParams;

  const query = new URLSearchParams({ range });
  if (range === 'custom' && from) query.set('from', from);
  if (range === 'custom' && to) query.set('to', to);

  const [summary, charts] = await Promise.all([
    serverGetOptional<DashboardSummary>(`/api/v1/admin/dashboard?${query.toString()}`),
    serverGetOptional<ChartSeries>(`/api/v1/admin/dashboard/charts?${query.toString()}`),
  ]);

  if (!summary) {
    return (
      <Alert variant="warning" title="Dashboard data is unavailable">
        The company API did not respond. Check that it is running and reachable, then refresh.
      </Alert>
    );
  }

  const currency = summary.currency || 'USD';
  const compare = COMPARE_LABELS[range] ?? 'vs previous period';

  return (
    <>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground">
          <CalendarDays className="size-4" aria-hidden />
          {formatDate(summary.range.from)} – {formatDate(summary.range.to)}
        </span>
        <Suspense fallback={null}>
          <RangeSelect value={range} />
        </Suspense>
      </div>

      {/* Primary KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Total Clients"
          value={formatNumber(summary.totalClients.value)}
          metric={summary.totalClients}
          icon={Users}
          tint="primary"
          compareLabel={compare}
        />
        <KpiCard
          label="Active Clients"
          value={formatNumber(summary.activeClients.value)}
          metric={summary.activeClients}
          icon={UserCheck}
          tint="success"
          compareLabel={compare}
        />
        <KpiCard
          label="Trial Clients"
          value={formatNumber(summary.trialClients.value)}
          metric={summary.trialClients}
          icon={Timer}
          tint="warning"
          compareLabel={compare}
        />
        <KpiCard
          label="Paid Clients"
          value={formatNumber(summary.paidClients.value)}
          metric={summary.paidClients}
          icon={CreditCard}
          tint="info"
          compareLabel={compare}
        />
        <KpiCard
          label="MRR"
          value={formatMoney(summary.mrr.value, currency)}
          metric={summary.mrr}
          icon={CircleDollarSign}
          tint="success"
          compareLabel={compare}
        />
        <KpiCard
          label="ARR"
          value={formatMoney(summary.arr.value, currency)}
          metric={summary.arr}
          icon={TrendingUp}
          tint="primary"
          compareLabel={compare}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Expired Clients"
          value={formatNumber(summary.expiredClients.value)}
          metric={summary.expiredClients}
          icon={AlertTriangle}
          tint="danger"
          invertTrend
          showSpark={false}
          compareLabel={compare}
        />
        <KpiCard
          label="Suspended Clients"
          value={formatNumber(summary.suspendedClients.value)}
          metric={summary.suspendedClients}
          icon={Ban}
          tint="info"
          invertTrend
          showSpark={false}
          compareLabel={compare}
        />
        <KpiCard
          label="Payments This Month"
          value={formatMoney(summary.paymentsThisMonth.value, currency)}
          metric={summary.paymentsThisMonth}
          icon={Wallet}
          tint="success"
          showSpark={false}
          compareLabel={compare}
        />
        <KpiCard
          label="Failed Payments"
          value={formatNumber(summary.failedPayments.value)}
          metric={summary.failedPayments}
          icon={AlertTriangle}
          tint="danger"
          invertTrend
          showSpark={false}
          compareLabel={compare}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Revenue Overview</CardTitle>
              <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-chart-1" aria-hidden /> Revenue
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-chart-2" aria-hidden /> MRR
                </span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <RevenueChart data={charts?.revenue ?? []} currency={currency} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Client Growth</CardTitle>
          </CardHeader>
          <CardContent>
            <GrowthChart data={charts?.clients ?? []} label="Clients" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subscription Growth</CardTitle>
          </CardHeader>
          <CardContent>
            <GrowthChart
              data={charts?.subscriptions ?? []}
              label="Subscriptions"
              color="var(--chart-3)"
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader>
            <CardTitle>Subscription Status</CardTitle>
          </CardHeader>
          <CardContent>
            <SubscriptionDonut data={summary.subscriptionStatus} />
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Trial Conversion Over Time</CardTitle>
          </CardHeader>
          <CardContent>
            <ConversionBars data={charts?.trialConversion ?? summary.trialConversion.series} />
          </CardContent>
        </Card>
      </div>

      {/* Activity + recent clients + trial conversion */}
      <div className="grid gap-4 xl:grid-cols-[1fr_1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ActivityFeed items={summary.recentActivity} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent Clients</CardTitle>
            <Button asChild variant="link" size="sm">
              <Link href="/clients">
                View all clients <ArrowRight className="size-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            <TableWrapper className="rounded-none border-x-0 border-b-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Plan</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Registered</TableHead>
                    <TableHead>Renewal</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.recentClients.length === 0 ? (
                    <TableEmpty colSpan={6}>No clients registered yet.</TableEmpty>
                  ) : (
                    summary.recentClients.map((client) => (
                      <TableRow key={client.id}>
                        <TableCell>
                          <Link href={`/clients/${client.id}`} className="block min-w-0">
                            <span className="block truncate font-medium text-foreground hover:text-primary">
                              {client.businessName}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {client.domain ?? client.email}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{client.planName ?? '—'}</TableCell>
                        <TableCell>
                          <StatusBadge status={client.subscriptionStatus ?? client.accountStatus} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(client.registeredAt)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {formatDate(client.renewalAt)}
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap">
                          {client.amount ? formatMoney(client.amount, client.currency) : '—'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableWrapper>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trial Conversion</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start gap-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-accent-foreground">
                <Users className="size-5" aria-hidden />
              </span>
              <dl className="flex-1 space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Total Trials</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatNumber(summary.trialConversion.totalTrials)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Converted</dt>
                  <dd className="font-semibold tabular-nums">
                    {formatNumber(summary.trialConversion.converted)}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">Conversion Rate</dt>
                  <dd className="font-semibold text-success tabular-nums">
                    {summary.trialConversion.conversionRate.toFixed(1)}%
                  </dd>
                </div>
              </dl>
            </div>
            <ConversionBars data={summary.trialConversion.series} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

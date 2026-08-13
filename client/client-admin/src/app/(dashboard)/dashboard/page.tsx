import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  Package,
  PackageCheck,
  Palette,
  Receipt,
  ShieldCheck,
  Star,
  Users,
  Warehouse,
} from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { KpiCard } from '@/components/admin/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import type { OrderRow, ReportsPayload, ReviewRow, SessionResponse } from '@/lib/types';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

/**
 * Shown until the store has taken an order.
 *
 * A dashboard of zeroes tells a new owner nothing and looks broken; this tells
 * them what to do next. It is replaced by the real figures the moment there is
 * anything to report, rather than sitting alongside them for ever.
 */
const SETUP_STEPS = [
  {
    icon: Package,
    title: 'Add your first products',
    description: 'Build your catalogue with categories, brands and variants.',
    href: '/products',
    action: 'Go to products',
  },
  {
    icon: Warehouse,
    title: 'Set up stock',
    description: 'Create a warehouse and record what you have on hand.',
    href: '/inventory',
    action: 'Go to inventory',
  },
  {
    icon: Palette,
    title: 'Choose how your store looks',
    description: 'Pick one of six layouts and eight colour themes.',
    href: '/website/design',
    action: 'Open design',
  },
  {
    icon: ShieldCheck,
    title: 'Turn on two-factor authentication',
    description: 'Strongly recommended for the account that owns the store.',
    href: '/account/security',
    action: 'Open security',
  },
];

export default async function DashboardPage() {
  const session = await serverGetOptional<SessionResponse>('/api/v1/admin/auth/session');
  const admin = session?.authenticated ? session.admin : null;
  const store = session?.authenticated ? session.store : null;
  const firstName = admin?.fullName.split(' ')[0] ?? 'there';
  const currency = store?.currency ?? 'USD';

  /*
   * Each of these is optional: a signed-in admin without `reports.view` or
   * `orders.view` gets a 401 from that endpoint, and the dashboard should be
   * missing a card rather than failing to render.
   */
  const [report, recentOrders, pendingReviews] = await Promise.all([
    serverGetOptional<ReportsPayload>('/api/v1/admin/reports'),
    serverGetPaginated<OrderRow>('/api/v1/admin/orders', { pageSize: 5 }).catch(() => null),
    serverGetPaginated<ReviewRow>('/api/v1/admin/reviews', { status: 'pending', pageSize: 1 }).catch(
      () => null,
    ),
  ]);

  const trading = (report?.totals.orders ?? 0) > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description={`${store?.name ?? 'Your store'} · ${currency} · ${store?.timezone ?? 'UTC'}`}
      />

      {store?.trial && store.trial.status === 'active' ? (
        <Card className="border-warning/40 bg-warning-soft/60">
          <CardHeader className="flex-row items-center justify-between gap-4 space-y-0">
            <div>
              <CardTitle className="text-base">
                Your trial ends in {store.trial.daysRemaining} day
                {store.trial.daysRemaining === 1 ? '' : 's'}
              </CardTitle>
              <CardDescription>
                Add a payment method from your platform account to keep the store trading.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      {trading && report ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              label="Revenue (30 days)"
              value={formatMoney(report.totals.revenue, currency)}
              icon={Receipt}
              tint="success"
            />
            <KpiCard
              label="Orders"
              value={formatNumber(report.totals.orders)}
              icon={PackageCheck}
              tint="primary"
            />
            <KpiCard
              label="Average order"
              value={formatMoney(report.totals.averageOrderValue, currency)}
              icon={Receipt}
              tint="info"
            />
            <KpiCard
              label="New customers"
              value={formatNumber(report.totals.newCustomers)}
              icon={Users}
              tint="primary"
            />
          </div>

          {(pendingReviews?.meta.total ?? 0) > 0 ? (
            <Card className="border-warning/40">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
                <p className="flex items-center gap-2 text-sm">
                  <Star className="size-4 text-warning" aria-hidden />
                  {pendingReviews!.meta.total} review
                  {pendingReviews!.meta.total === 1 ? '' : 's'} waiting for you. Nothing appears on
                  your storefront until you approve it.
                </p>
                <Button asChild size="sm" variant="secondary">
                  <Link href="/reviews?status=pending">Moderate</Link>
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <section aria-labelledby="recent-heading" className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h2 id="recent-heading" className="text-lg font-semibold">
                Latest orders
              </h2>
              <Button asChild variant="ghost" size="sm">
                <Link href="/orders">
                  All orders <ArrowRight aria-hidden />
                </Link>
              </Button>
            </div>

            <TableWrapper>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Order</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Placed</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(recentOrders?.data ?? []).map((order) => (
                    <TableRow key={order.id}>
                      <TableCell>
                        <Link href={`/orders/${order.id}`} className="font-mono text-sm hover:underline">
                          {order.orderNumber}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{order.customerName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDateTime(order.placedAt)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={order.status} />
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(order.grandTotal, order.currency || currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          </section>
        </>
      ) : (
        <section aria-labelledby="setup-heading" className="space-y-4">
          <div className="flex items-center gap-3">
            <h2 id="setup-heading" className="text-lg font-semibold">
              Finish setting up
            </h2>
            <Badge variant="neutral">{SETUP_STEPS.length} steps</Badge>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {SETUP_STEPS.map((step) => (
              <Card key={step.href} className="flex flex-col">
                <CardHeader>
                  <span className="mb-2 grid size-10 place-items-center rounded-xl bg-primary-soft text-primary">
                    <step.icon className="size-5" aria-hidden />
                  </span>
                  <CardTitle className="text-base">{step.title}</CardTitle>
                  <CardDescription>{step.description}</CardDescription>
                </CardHeader>
                <CardContent className="mt-auto">
                  <Button asChild variant="secondary" size="sm">
                    <Link href={step.href}>
                      {step.action} <ArrowRight />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

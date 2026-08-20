import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BadgePercent,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Globe,
  ImageOff,
  Inbox,
  Lock,
  Package,
  PackageCheck,
  Palette,
  Plus,
  Receipt,
  ShoppingCart,
  Star,
  TrendingUp,
  Warehouse,
} from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { KpiCard } from '@/components/admin/kpi-card';
import { LazyImage } from '@/components/admin/lazy-image';
import { PanelBoundary } from '@/components/admin/panel-boundary';
import { SalesOverview } from '@/components/admin/dashboard-chart';
import { GranularityPicker, RangePicker } from '@/components/admin/dashboard-filters';
import { TrialBanner } from '@/components/admin/dashboard-trial-banner';
import { Button } from '@/components/ui/button';
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
import { serverGetOptional } from '@/lib/server-api';
import { storefrontUrl } from '@/lib/env';
import { resolveDays, resolveGranularity } from '@/lib/dashboard';
import { formatDate, formatMoney, formatNumber } from '@/lib/format';
import {
  can,
  type DashboardPayload,
  type DashboardSection,
  type SessionResponse,
} from '@/lib/types';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

/** First value of a param that Next may hand over as an array. */
function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Shown in place of the growth card until the store has taken an order.
 *
 * A brand new shop has nothing to grow yet, and telling it to run a promotion
 * before it has products is advice it cannot act on. Replaced by the growth card
 * the moment there is a first sale rather than sitting alongside it for ever.
 */
const SETUP_STEPS = [
  { icon: Package, label: 'Add your products', href: '/products?new=1' },
  { icon: Warehouse, label: 'Record what you have in stock', href: '/inventory' },
  { icon: Palette, label: 'Choose how your store looks', href: '/website/design' },
  { icon: Globe, label: 'Open your storefront', href: '/website/pages' },
];

/**
 * What every section reads as when the call itself did not come back.
 *
 * The page still renders — header, range picker, quick actions, the layout — with
 * each card carrying the same short explanation. The alternative was one
 * full-screen error, which loses the parts that never depended on that call and
 * leaves the reader with nothing to click.
 */
const UNAVAILABLE = {
  ok: false,
  reason: 'unavailable',
  message: 'Your store’s API did not answer. Reload in a moment.',
} as const;

/**
 * The panel's home screen.
 *
 * Every figure comes from `GET /admin/dashboard`, which reads the tenant
 * database directly — there is no fixture and no client-side arithmetic. The
 * window lives in the URL (`?days=&granularity=`), so the server fetches the
 * numbers for the range being looked at rather than a wider set the browser
 * would then have to narrow.
 *
 * The screen is built out of **independent sections**, and that is the load
 * bearing part: the API reports each panel as `ok` or not, this page renders
 * each one from its own result, and `PanelBoundary` catches anything that throws
 * in the browser. A broken query, a permission the admin does not hold, or a
 * chart that chokes costs one card — never the page.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const days = resolveDays(one(params.days));
  const granularity = resolveGranularity(one(params.granularity));

  const [session, dashboard] = await Promise.all([
    serverGetOptional<SessionResponse>('/api/v1/admin/auth/session'),
    /*
     * Never throws. A 401/404 is already absorbed; everything else is caught here
     * so the page renders its shell with every section marked unavailable rather
     * than handing the route's `error.tsx` a blank screen — which is the one
     * outcome that leaves an owner with no way to tell "my shop is empty" from
     * "the panel is broken".
     */
    serverGetOptional<DashboardPayload>('/api/v1/admin/dashboard', { days, granularity }).catch(
      () => null,
    ),
  ]);

  const admin = session?.authenticated ? session.admin : null;
  const store = session?.authenticated ? session.store : null;
  const currency = dashboard?.currency ?? store?.currency ?? 'USD';
  const money = (value: string | number) => formatMoney(value, currency);

  const range = dashboard?.range;
  const sections = dashboard?.sections;
  const metrics = sections?.metrics ?? UNAVAILABLE;
  const series = sections?.series ?? UNAVAILABLE;
  const recentOrders = sections?.recentOrders ?? UNAVAILABLE;
  const topProducts = sections?.topProducts ?? UNAVAILABLE;
  const lowStock = sections?.lowStock ?? UNAVAILABLE;
  const reviews = sections?.reviews ?? UNAVAILABLE;

  const compareLabel = `vs previous ${days} day${days === 1 ? '' : 's'}`;
  const totals = metrics.ok ? metrics.data.totals : null;
  const trading =
    (metrics.ok && metrics.data.orders.value > 0) || (recentOrders.ok && recentOrders.data.length > 0);

  const quickActions = [
    can(admin, 'products.create') && {
      icon: Plus,
      title: 'Add product',
      description: 'Create a new product',
      href: '/products?new=1',
      external: false,
    },
    can(admin, 'marketing.manage') && {
      icon: BadgePercent,
      title: 'Create discount',
      description: 'Launch a new promotion',
      href: '/discounts',
      external: false,
    },
    can(admin, 'orders.view') && {
      icon: ShoppingCart,
      title: 'View orders',
      description: 'Manage customer orders',
      href: '/orders',
      external: false,
    },
    store?.slug && {
      icon: Globe,
      title: 'View store',
      description: 'Open your storefront',
      href: storefrontUrl(store.slug),
      external: true,
    },
  ].filter(Boolean) as {
    icon: typeof Plus;
    title: string;
    description: string;
    href: string;
    external: boolean;
  }[];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        description="Here's what's happening with your store today."
        actions={
          <RangePicker days={days} from={range?.from} to={range?.to} timezone={range?.timezone} />
        }
      />

      {!dashboard ? (
        <Card className="flex flex-wrap items-center gap-3 border-destructive/40 bg-destructive-soft/40 p-4">
          <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">Your figures could not be loaded.</span>{' '}
            <span className="text-muted-foreground">
              Either the session has expired or the store API did not answer. Everything below is
              waiting on it.
            </span>
          </p>
          <Button asChild size="sm" variant="secondary">
            <Link href="/dashboard">Try again</Link>
          </Button>
        </Card>
      ) : null}

      {store?.trial && store.trial.status === 'active' ? (
        <TrialBanner daysRemaining={store.trial.daysRemaining} />
      ) : null}

      {reviews.ok && reviews.data.pending > 0 ? (
        <Card className="flex flex-wrap items-center gap-3 border-warning/40 p-4">
          <Star className="size-4 shrink-0 text-warning" aria-hidden />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">
              {formatNumber(reviews.data.pending)} review{reviews.data.pending === 1 ? '' : 's'} waiting
              for you.
            </span>{' '}
            <span className="text-muted-foreground">
              Nothing appears on your storefront until you approve it.
            </span>
          </p>
          <Button asChild size="sm" variant="secondary">
            <Link href="/reviews?status=pending">Moderate</Link>
          </Button>
        </Card>
      ) : null}

      {/* ------------------------------------------------------------- KPIs --- */}
      {metrics.ok ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Revenue"
            value={money(metrics.data.revenue.value)}
            metric={metrics.data.revenue}
            icon={Receipt}
            tint="success"
            align="inline"
            compareLabel={compareLabel}
          />
          <KpiCard
            label="Orders"
            value={formatNumber(metrics.data.orders.value)}
            metric={metrics.data.orders}
            icon={PackageCheck}
            tint="primary"
            align="inline"
            compareLabel={compareLabel}
          />
          <KpiCard
            label="Pending orders"
            value={formatNumber(metrics.data.pendingOrders.value)}
            metric={metrics.data.pendingOrders}
            icon={ShoppingCart}
            tint="warning"
            align="inline"
            // A backlog that is growing is bad news, so the arrow's colour flips.
            invertTrend
            compareLabel={compareLabel}
            // Only reached with no previous window to compare against, so it has
            // to read correctly for a queue that is empty and one that is not.
            hint={
              metrics.data.pendingOrders.value === 0
                ? 'Nothing waiting on you'
                : 'Placed in this period, not yet shipped'
            }
          />
          <KpiCard
            label="Low stock products"
            value={lowStock.ok ? formatNumber(lowStock.data.low) : '—'}
            icon={Warehouse}
            tint="danger"
            align="inline"
            // Stock keeps no history, so there is nothing to compare against and
            // no trend to draw. The count of what has already run out says more.
            showSpark={false}
            hint={
              !lowStock.ok ? (
                lowStock.message
              ) : lowStock.data.out > 0 ? (
                <span className="text-destructive">
                  {formatNumber(lowStock.data.out)} out of stock right now
                </span>
              ) : (
                `Across ${formatNumber(lowStock.data.tracked)} tracked variants`
              )
            }
          />
        </div>
      ) : (
        <Card>
          <CardContent className="p-5">
            <SectionNote section={metrics} />
          </CardContent>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)_minmax(0,0.8fr)]">
        {/* ---------------------------------------------------- sales overview --- */}
        <Card className="flex flex-col">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">Sales overview</CardTitle>
              <p className="text-xs text-muted-foreground">
                {totals
                  ? `${money(totals.revenue)} taken · ${money(totals.averageOrderValue)} average order`
                  : 'Revenue over the chosen window'}
              </p>
            </div>
            <GranularityPicker granularity={granularity} />
          </CardHeader>
          <CardContent className="flex-1">
            {series.ok ? (
              /* The one panel that runs a library in the browser, so the one that
                 needs a boundary of its own as well as a section result. */
              <PanelBoundary
                fallback={
                  <PanelNote icon={CircleAlert} tone="danger">
                    The chart could not be drawn. Your figures above are unaffected.
                  </PanelNote>
                }
              >
                <SalesOverview
                  data={series.data.points}
                  currency={currency}
                  granularity={series.data.granularity}
                />
              </PanelBoundary>
            ) : (
              <SectionNote section={series} />
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------ recent orders --- */}
        <Card className="flex flex-col">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">Recent orders</CardTitle>
            {can(admin, 'orders.view') ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/orders">
                  View all <ArrowRight aria-hidden />
                </Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="flex-1">
            {!recentOrders.ok ? (
              <SectionNote section={recentOrders} />
            ) : recentOrders.data.length === 0 ? (
              <PanelNote icon={Inbox}>No orders yet. They appear the moment one is placed.</PanelNote>
            ) : (
              <TableWrapper className="border-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentOrders.data.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell>
                          <Link href={`/orders/${order.id}`} className="font-mono text-xs hover:underline">
                            {order.orderNumber}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-36 truncate text-sm">{order.customerName}</TableCell>
                        <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatDate(order.placedAt)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={order.status} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">
                          {formatMoney(order.grandTotal, order.currency || currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableWrapper>
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------- quick actions, then the nudge --- */}
        <div className="space-y-5 xl:row-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {quickActions.length === 0 ? (
                <PanelNote icon={Lock}>Your account has no sections it can write to.</PanelNote>
              ) : (
                quickActions.map((action) => {
                  const body = (
                    <>
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-accent-foreground">
                        <action.icon className="size-4.5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{action.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {action.description}
                        </span>
                      </span>
                      {action.external ? (
                        <ExternalLink className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      ) : (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                    </>
                  );

                  const className =
                    'flex items-center gap-3 rounded-xl border border-transparent bg-muted/40 p-3 transition-colors hover:border-border hover:bg-muted';

                  return action.external ? (
                    <a
                      key={action.title}
                      href={action.href}
                      target="_blank"
                      rel="noreferrer"
                      className={className}
                    >
                      {body}
                    </a>
                  ) : (
                    <Link key={action.title} href={action.href} className={className}>
                      {body}
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>

          {trading ? (
            <Card className="border-primary/30 bg-primary-soft/40">
              <CardContent className="space-y-3 p-5">
                <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-accent-foreground">
                  <TrendingUp className="size-5" aria-hidden />
                </span>
                <div className="space-y-1">
                  <p className="text-sm font-semibold">Grow your store</p>
                  <p className="text-sm text-muted-foreground">
                    {totals
                      ? `${formatNumber(totals.activeProducts)} of ${formatNumber(totals.totalProducts)} products are live. Add more and run a promotion to lift sales.`
                      : 'Add more products and run a promotion to lift sales.'}
                  </p>
                </div>
                <Button asChild size="sm" variant="secondary">
                  <Link href={can(admin, 'marketing.manage') ? '/discounts' : '/products'}>
                    {can(admin, 'marketing.manage') ? 'Create discount' : 'Review products'}
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Finish setting up</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {SETUP_STEPS.map((step) => (
                  <Link
                    key={step.href}
                    href={step.href}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-muted"
                  >
                    <step.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{step.label}</span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* --------------------------------------------------- low stock alerts --- */}
        <Card className="flex flex-col">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <CardTitle className="text-base">Low stock alerts</CardTitle>
            {can(admin, 'inventory.view') ? (
              <Button asChild variant="ghost" size="sm">
                <Link href="/inventory?status=low">
                  View all <ArrowRight aria-hidden />
                </Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="flex-1 space-y-3">
            {!lowStock.ok ? (
              <SectionNote section={lowStock} />
            ) : lowStock.data.items.length === 0 ? (
              <PanelNote icon={PackageCheck} tone="success">
                Every tracked variant is above its reorder point.
              </PanelNote>
            ) : (
              lowStock.data.items.map((item) => {
                /*
                 * The bar reads as "how far above empty", not "how full the shelf
                 * is": a variant at twice its reorder point fills it, and one at
                 * zero leaves it bare. Measuring against the stock on hand instead
                 * would draw a full bar for the item that has three left and
                 * nothing reserved — which is the one being warned about.
                 */
                const ceiling = Math.max(item.threshold * 2, 1);
                const fill = Math.min(100, Math.round((Math.max(0, item.available) / ceiling) * 100));
                const out = item.available <= 0;

                return (
                  <Link
                    key={item.variantId}
                    href={`/products/${item.productId}`}
                    className="flex items-center gap-3 rounded-xl p-1.5 transition-colors hover:bg-muted"
                  >
                    <LazyImage
                      src={item.imageUrl}
                      alt=""
                      className="size-11 rounded-lg bg-muted text-muted-foreground"
                      fallback={<ImageOff className="size-4" aria-hidden />}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.productName}
                        {item.variantTitle ? (
                          <span className="text-muted-foreground"> · {item.variantTitle}</span>
                        ) : null}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">SKU: {item.sku}</p>
                    </div>
                    <div className="w-24 shrink-0 space-y-1.5 text-right">
                      <p
                        className={cn(
                          'text-sm font-semibold tabular-nums',
                          out ? 'text-destructive' : 'text-warning',
                        )}
                      >
                        {out ? 'Out of stock' : `${formatNumber(item.available)} left`}
                      </p>
                      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <span
                          className={cn('block h-full rounded-full', out ? 'bg-destructive' : 'bg-warning')}
                          style={{ width: `${Math.max(fill, out ? 0 : 4)}%` }}
                        />
                      </span>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        Reorder at {formatNumber(item.threshold)}
                      </p>
                    </div>
                  </Link>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* ------------------------------------------------------ top products --- */}
        <Card className="flex flex-col">
          <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="text-base">Top products</CardTitle>
              <p className="text-xs text-muted-foreground">
                {topProducts.ok && topProducts.data.scope === 'all_time'
                  ? 'Nothing sold in this period — showing best sellers of all time'
                  : 'By units sold in this period'}
              </p>
            </div>
            {can(admin, 'reports.view') ? (
              <Button asChild variant="ghost" size="sm">
                <Link href={`/reports?days=${days}`}>
                  View all <ArrowRight aria-hidden />
                </Link>
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className="flex-1 space-y-1">
            {!topProducts.ok ? (
              <SectionNote section={topProducts} />
            ) : topProducts.data.products.length === 0 ? (
              <PanelNote icon={Inbox}>Nothing has sold yet.</PanelNote>
            ) : (
              topProducts.data.products.map((product) => {
                const row = (
                  <>
                    <LazyImage
                      src={product.imageUrl}
                      alt=""
                      className="size-11 rounded-lg bg-muted text-muted-foreground"
                      fallback={<ImageOff className="size-4" aria-hidden />}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{product.name}</span>
                    <span className="w-20 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                      {formatNumber(product.units)} sold
                    </span>
                    {/* Null on an all-time row: `sold_count` counts units, and what
                        they were charged at is not recoverable from it. */}
                    <span className="w-24 shrink-0 text-right text-sm font-medium tabular-nums">
                      {product.revenue === null ? '—' : money(product.revenue)}
                    </span>
                  </>
                );

                const className = 'flex items-center gap-3 rounded-xl p-1.5 transition-colors hover:bg-muted';

                // A line whose product has since been deleted keeps its sales but
                // has nowhere to link to — `product_id` is set null on delete.
                return product.productId ? (
                  <Link key={product.productId} href={`/products/${product.productId}`} className={className}>
                    {row}
                  </Link>
                ) : (
                  <div key={product.name} className={className}>
                    {row}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Why a panel has no rows: refused, broken, or waiting on a call that failed. */
function SectionNote({ section }: { section: DashboardSection<unknown> }) {
  if (section.ok) return null;
  return (
    <PanelNote
      icon={section.reason === 'forbidden' ? Lock : CircleAlert}
      tone={section.reason === 'forbidden' ? 'muted' : 'danger'}
    >
      {section.message}
    </PanelNote>
  );
}

function PanelNote({
  children,
  icon: Icon,
  tone = 'muted',
}: {
  children: React.ReactNode;
  icon: typeof Inbox;
  tone?: 'muted' | 'danger' | 'success';
}) {
  const tones = {
    muted: 'border-dashed text-muted-foreground',
    danger: 'border-destructive/40 bg-destructive-soft/30 text-destructive',
    success: 'border-dashed text-muted-foreground',
  } as const;

  return (
    <div className={cn('flex items-center gap-2 rounded-lg border px-4 py-8 text-sm', tones[tone])}>
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

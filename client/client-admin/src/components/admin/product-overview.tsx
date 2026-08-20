import Link from 'next/link';
import { ImageIcon, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { formatDateTime, formatMoney, formatNumber, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ProductInsights } from '@/lib/types';
import { LazyImage } from './lazy-image';
import { PanelBoundary } from './panel-boundary';
import { ProductSalesChart } from './product-sales-chart';

/**
 * What a shopkeeper needs to know about one product, above what they can edit.
 *
 * The screen answers six questions in the order they get asked: how much stock
 * came in, how much is left, how much sold, how much came back, how much is
 * broken, and how much money the whole thing made. Everything else — the
 * variants, the ledger, the returns, the chart — is the working behind one of
 * those six, placed under the figure it explains.
 *
 * Rendered on the server from a single `/products/:id/insights` call, so the
 * whole screen arrives filled rather than as eight loading rectangles. Only the
 * chart is a client component, and it is wrapped: a throw inside a chart library
 * would otherwise reach the route's `error.tsx` and take the counts down with a
 * graph nobody was looking at.
 */

/** A movement's own word for itself, in the language of a shop rather than a schema. */
const MOVEMENT_LABELS: Record<string, string> = {
  initial: 'Opening stock',
  received: 'Stock received',
  adjustment: 'Manual adjustment',
  order_reserved: 'Reserved for order',
  order_released: 'Reservation released',
  order_fulfilled: 'Sold and dispatched',
  return_received: 'Customer return',
  return_restocked: 'Return put back',
  damaged: 'Damaged',
  repaired: 'Repaired',
  disposed: 'Written off',
  transfer: 'Transfer',
};

/** Which movements are good news, so the ledger reads at a glance. */
const MOVEMENT_TONE: Record<string, 'success' | 'danger' | 'warning' | 'info' | 'neutral'> = {
  initial: 'info',
  received: 'success',
  adjustment: 'neutral',
  order_reserved: 'info',
  order_released: 'neutral',
  order_fulfilled: 'success',
  return_received: 'warning',
  return_restocked: 'success',
  damaged: 'danger',
  repaired: 'success',
  disposed: 'danger',
  transfer: 'neutral',
};

export function ProductOverview({
  insights,
  storefrontUrl,
}: {
  insights: ProductInsights;
  /** Null on a custom domain, which carries no slug to build a link from. */
  storefrontUrl: string | null;
}) {
  const { product, stock, money, variants, movements, sales, returns, activity, currency } = insights;

  return (
    <div className="space-y-4">
      <StockStrip stock={stock} />
      <MoneyStrip money={money} returns={returns} currency={currency} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-baseline justify-between gap-3">
              <div>
                <CardTitle>Sales</CardTitle>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Last {insights.range.days} days, counted in {insights.range.timezone}
                </p>
              </div>
              {sales.bestVariant ? (
                <p className="text-right text-xs text-muted-foreground">
                  Best variant
                  <span className="ml-1.5 font-medium text-foreground">
                    {sales.bestVariant.title ?? sales.bestVariant.sku}
                  </span>
                  <span className="ml-1 tabular-nums">({formatNumber(sales.bestVariant.sold)} sold)</span>
                </p>
              ) : null}
            </CardHeader>
            <CardContent>
              <PanelBoundary
                fallback={
                  <div className="grid h-56 place-items-center rounded-lg border border-dashed text-center text-sm text-muted-foreground">
                    The sales chart could not be drawn. The figures above it are unaffected.
                  </div>
                }
              >
                <ProductSalesChart data={sales.series} currency={currency} />
              </PanelBoundary>
            </CardContent>
          </Card>

          <VariantStock variants={variants} currency={currency} tracked={stock.tracked} />
          <Movements movements={movements} />
        </div>

        <div className="space-y-4">
          <ProductFacts product={product} stock={stock} money={money} currency={currency} storefrontUrl={storefrontUrl} />
          <Returns returns={returns} stock={stock} currency={currency} />
          <Activity activity={activity} />
        </div>
      </div>
    </div>
  );
}

/**
 * The six numbers, in the order the stock actually moves through the shop.
 *
 * Read left to right it is one sentence: this much came in, this much is left to
 * sell, this much went out, this much is spoken for, this much came back, this
 * much is broken. Any other order makes the reader do the arithmetic themselves.
 */
function StockStrip({ stock }: { stock: ProductInsights['stock'] }) {
  const cells = [
    { label: 'Total stock', value: stock.received, note: 'Received into the warehouse' },
    { label: 'Available', value: stock.available, note: 'Sellable right now', strong: true },
    { label: 'Sold', value: stock.sold, note: 'Dispatched to customers' },
    { label: 'Reserved', value: stock.reserved, note: 'Committed to unshipped orders' },
    { label: 'Returned', value: stock.returned, note: 'Units accepted back' },
    { label: 'Damaged', value: stock.damaged, note: 'Held back, never sold' },
  ];

  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border p-0 sm:grid-cols-3 lg:grid-cols-6">
        {cells.map((cell) => (
          <div key={cell.label} className="bg-card p-4">
            <p className="truncate text-[11px] leading-4 font-medium tracking-wide text-muted-foreground uppercase">
              {cell.label}
            </p>
            <p
              className={cn(
                'mt-1 text-[26px] leading-none font-bold tracking-tight tabular-nums',
                cell.strong && stock.isOut && 'text-destructive',
                cell.strong && stock.isLow && 'text-warning',
              )}
            >
              {formatNumber(cell.value)}
            </p>
            <p title={cell.note} className="mt-1.5 truncate text-[11px] leading-4 text-muted-foreground">
              {cell.note}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/**
 * The money, and the one ratio that belongs beside it.
 *
 * Profit is estimated and says so: an order line snapshots what the customer
 * paid and never what the unit cost, so the only cost available is today's, and
 * an owner who files this as an accounting figure has been misled by a label
 * rather than by a number.
 */
function MoneyStrip({
  money,
  returns,
  currency,
}: {
  money: ProductInsights['money'];
  returns: ProductInsights['returns'];
  currency: string;
}) {
  const profit = Number(money.estimatedProfit);

  const cells = [
    { label: 'Revenue', value: formatMoney(money.revenue, currency), note: `${formatNumber(money.orders)} orders` },
    {
      label: 'Discounts',
      value: formatMoney(money.discount, currency),
      note: 'Sale prices and coupon share',
    },
    { label: 'Refunds', value: formatMoney(money.refunded, currency), note: 'Share of refunded orders' },
    {
      label: 'Est. profit',
      value: formatMoney(money.estimatedProfit, currency),
      note: "At today's cost price",
      tone: profit < 0 ? 'text-destructive' : profit > 0 ? 'text-success' : undefined,
    },
    {
      label: 'Avg. sale price',
      value: money.averageSellingPrice ? formatMoney(money.averageSellingPrice, currency) : '—',
      note: `${formatNumber(money.units)} units ordered`,
    },
    {
      label: 'Return rate',
      value: returns.rate === null ? '—' : `${returns.rate}%`,
      note: `${formatNumber(returns.units)} of ${formatNumber(money.units)} units`,
      tone: returns.rate !== null && returns.rate >= 10 ? 'text-destructive' : undefined,
    },
  ];

  return (
    <Card>
      <CardContent className="grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border p-0 sm:grid-cols-3 lg:grid-cols-6">
        {cells.map((cell) => (
          <div key={cell.label} className="bg-card p-4">
            <p className="truncate text-[11px] leading-4 font-medium tracking-wide text-muted-foreground uppercase">
              {cell.label}
            </p>
            <p className={cn('mt-1 text-[20px] leading-tight font-bold tracking-tight tabular-nums', cell.tone)}>
              {cell.value}
            </p>
            <p title={cell.note} className="mt-1.5 truncate text-[11px] leading-4 text-muted-foreground">
              {cell.note}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/** Stock per sellable thing, which is what stock is actually counted against. */
function VariantStock({
  variants,
  currency,
  tracked,
}: {
  variants: ProductInsights['variants'];
  currency: string;
  tracked: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-baseline justify-between gap-3">
        <CardTitle>Variant stock</CardTitle>
        {tracked ? null : (
          <Badge variant="warning">Stock tracking is off — sales are never refused on stock</Badge>
        )}
      </CardHeader>
      <CardContent className="p-0">
        <TableWrapper>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Variant</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Reserved</TableHead>
                <TableHead className="text-right">Sold</TableHead>
                <TableHead className="text-right">Returned</TableHead>
                <TableHead className="text-right">Damaged</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {variants.length === 0 ? (
                <TableEmpty colSpan={7}>This product has no sellable variant.</TableEmpty>
              ) : (
                variants.map((variant) => (
                  <TableRow key={variant.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <LazyImage
                          src={variant.imageUrl}
                          alt=""
                          className="size-9 rounded-md border border-border"
                          fallback={<ImageIcon className="size-4 text-muted-foreground" />}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {variant.title ?? (variant.isDefault ? 'Default' : variant.sku)}
                          </p>
                          <p className="truncate font-mono text-[11px] text-muted-foreground">{variant.sku}</p>
                        </div>
                        {variant.isActive ? null : <Badge variant="neutral">Hidden</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {variant.salePrice ? (
                        <span>
                          <span className="mr-1.5 text-muted-foreground line-through">
                            {formatMoney(variant.price, currency)}
                          </span>
                          {formatMoney(variant.salePrice, currency)}
                        </span>
                      ) : (
                        formatMoney(variant.price, currency)
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {/*
                        No level rows at all is not zero stock — it is a variant
                        nobody has ever counted, which is a different problem and
                        the only way to tell the two apart.
                      */}
                      {variant.stockRecords === 0 ? (
                        <span className="text-muted-foreground">Not counted</span>
                      ) : (
                        <span
                          className={cn(
                            'font-semibold',
                            variant.available <= 0 && 'text-destructive',
                            variant.available > 0 &&
                              variant.available <= variant.lowStockThreshold &&
                              'text-warning',
                          )}
                        >
                          {formatNumber(variant.available)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(variant.reserved)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(variant.sold)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(variant.returned)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(variant.damaged)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableWrapper>
      </CardContent>
    </Card>
  );
}

/**
 * The ledger — every movement, with what caused it.
 *
 * Append-only and written in the same transaction as the level it changed, so
 * this is not a summary of the stock but the thing the stock is derived from. A
 * count that looks wrong is explained here or it is not explained anywhere.
 */
function Movements({ movements }: { movements: ProductInsights['movements'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Stock movements</CardTitle>
        <p className="mt-0.5 text-xs text-muted-foreground">
          The 50 most recent. Every change to a count writes one of these, so a level can always be replayed.
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <TableWrapper>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>What happened</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right">Available after</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>When</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.length === 0 ? (
                <TableEmpty colSpan={6}>
                  Nothing has moved yet. Adding stock or taking an order writes the first entry.
                </TableEmpty>
              ) : (
                movements.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={MOVEMENT_TONE[row.type] ?? 'neutral'} className="w-fit">
                          {MOVEMENT_LABELS[row.type] ?? titleCase(row.type)}
                        </Badge>
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {[row.variantTitle, row.sku].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-semibold tabular-nums',
                        row.quantity > 0 ? 'text-success' : row.quantity < 0 ? 'text-destructive' : undefined,
                      )}
                    >
                      {row.quantity > 0 ? '+' : ''}
                      {formatNumber(row.quantity)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(row.availableAfter)}</TableCell>
                    <TableCell className="text-sm">
                      {row.orderNumber && row.referenceId ? (
                        <Link
                          href={`/orders/${row.referenceId}`}
                          className="font-mono text-xs underline-offset-2 hover:underline"
                        >
                          {row.orderNumber}
                        </Link>
                      ) : row.referenceType ? (
                        <span className="text-muted-foreground">{titleCase(row.referenceType)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[16rem] truncate text-sm text-muted-foreground">
                      {row.note ?? (row.damageReason ? titleCase(row.damageReason) : null) ?? row.adminLabel ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                      {formatDateTime(row.createdAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableWrapper>
      </CardContent>
    </Card>
  );
}

/** What the product *is* — the fields somebody reaches for when they are on the phone. */
function ProductFacts({
  product,
  stock,
  money,
  currency,
  storefrontUrl,
}: {
  product: ProductInsights['product'];
  stock: ProductInsights['stock'];
  money: ProductInsights['money'];
  currency: string;
  storefrontUrl: string | null;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Product</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-3">
          <LazyImage
            src={product.imageUrl}
            alt=""
            className="size-20 rounded-lg border border-border"
            fallback={<ImageIcon className="size-6 text-muted-foreground" />}
          />
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm leading-snug font-medium">{product.name}</p>
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge status={product.status} />
              <StockBadge stock={stock} />
            </div>
          </div>
        </div>

        <dl className="divide-y divide-border text-sm">
          <Fact label="SKU" value={product.sku} mono />
          <Fact label="Barcode" value={product.barcode} mono />
          <Fact label="Category" value={product.category?.name ?? null} />
          <Fact label="Subcategory" value={product.subcategory?.name ?? null} />
          <Fact label="Brand" value={product.brand?.name ?? null} />
          <Fact label="Regular price" value={product.price ? formatMoney(product.price, currency) : null} />
          <Fact label="Sale price" value={product.salePrice ? formatMoney(product.salePrice, currency) : null} />
          <Fact
            label="Cost price"
            value={money.unitCost ? formatMoney(money.unitCost, currency) : null}
          />
          <Fact label="Variants" value={formatNumber(product.variantCount)} />
          <Fact label="Stock tracking" value={product.trackInventory ? 'On' : 'Off'} />
          <Fact
            label="Video"
            value={
              product.videoUrl ? (
                <a
                  href={product.videoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  Open clip
                </a>
              ) : null
            }
          />
          <Fact
            label="Storefront"
            value={
              storefrontUrl ? (
                <a
                  href={`${storefrontUrl}/product/${product.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs underline-offset-2 hover:underline"
                >
                  /{product.slug}
                </a>
              ) : (
                <span className="font-mono text-xs">/{product.slug}</span>
              )
            }
          />
        </dl>
      </CardContent>
    </Card>
  );
}

function Returns({
  returns,
  stock,
  currency,
}: {
  returns: ProductInsights['returns'];
  stock: ProductInsights['stock'];
  currency: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Returns</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border text-sm">
          <Fact label="Requests" value={formatNumber(returns.requests)} />
          <Fact label="Units returned" value={formatNumber(returns.units)} />
          <Fact label="Still open" value={formatNumber(returns.open)} />
          <Fact label="Awaiting inspection" value={formatNumber(stock.returnPending)} />
          <Fact label="Put back on sale" value={formatNumber(returns.restocked)} />
          <Fact label="Returned damaged" value={formatNumber(returns.damaged)} />
          <Fact label="Value returned" value={formatMoney(returns.value, currency)} />
          <Fact label="Return rate" value={returns.rate === null ? null : `${returns.rate}%`} />
        </dl>
      </CardContent>
    </Card>
  );
}

function Activity({ activity }: { activity: ProductInsights['activity'] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Customer interest</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="divide-y divide-border text-sm">
          <Fact label="Wishlisted by" value={`${formatNumber(activity.wishlistCount)} customers`} />
          <Fact label="Reviews" value={formatNumber(activity.reviewCount)} />
          <Fact
            label="Awaiting moderation"
            value={activity.pendingReviews > 0 ? formatNumber(activity.pendingReviews) : null}
          />
          <Fact
            label="Average rating"
            value={
              activity.ratingCount > 0 ? (
                <span className="inline-flex items-center gap-1">
                  <Star className="size-3.5 fill-warning text-warning" aria-hidden />
                  {activity.ratingAverage.toFixed(1)}
                  <span className="text-muted-foreground">({formatNumber(activity.ratingCount)})</span>
                </span>
              ) : null
            }
          />
          <Fact label="Page views" value={formatNumber(activity.viewCount)} />
        </dl>
      </CardContent>
    </Card>
  );
}

/** A missing value is an em dash, never a blank row — a gap reads as a bug. */
function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 truncate text-right font-medium', mono && 'font-mono text-xs')}>
        {value ?? <span className="font-normal text-muted-foreground">—</span>}
      </dd>
    </div>
  );
}

/**
 * The enum, in the owner's words.
 *
 * `active` is "Published" and `inactive` is "Archived" because those are the two
 * things an owner is actually deciding — whether the shop shows it, and whether
 * it is finished with. The stored values are unchanged; only the label is.
 */
function StatusBadge({ status }: { status: ProductInsights['product']['status'] }) {
  if (status === 'active') return <Badge variant="success">Published</Badge>;
  if (status === 'draft') return <Badge variant="warning">Draft</Badge>;
  return <Badge variant="neutral">Archived</Badge>;
}

function StockBadge({ stock }: { stock: ProductInsights['stock'] }) {
  if (stock.isUntracked) return <Badge variant="neutral">Stock not tracked</Badge>;
  if (stock.isOut) return <Badge variant="danger">Out of stock</Badge>;
  if (stock.isLow) return <Badge variant="warning">Low stock</Badge>;
  return <Badge variant="success">In stock</Badge>;
}

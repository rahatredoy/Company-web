'use client';

import * as React from 'react';
import Link from 'next/link';
import { ImageOff, Loader2, Lock, NotebookPen, Star } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { toast } from '@/components/ui/toaster';
import { useDetail } from '@/hooks/use-detail';
import { api, errorMessage } from '@/lib/api';
import { titleCase } from '@/lib/format';
import { useT, type MessageKey, type Translator } from '@/lib/i18n';
import { MEASURE_UNITS, formatMeasure, type MeasureUnit } from '@/lib/measure';
import type {
  ProductInsights,
  ProductRow,
  ProductSpecificationRow,
  ProductVariant,
  ProductView,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  DetailCard,
  DetailColumns,
  DetailFactList,
  DetailSheet,
  DetailStat,
  DetailTable,
  keepFacts,
  type DetailFact,
} from './detail-sheet';
import { LazyImage } from './lazy-image';

/**
 * A product, as its owner reads it from the list.
 *
 * Not every column of the row — laid out in the order an owner asks about a
 * product they sell:
 *
 * 1. **Six figures beside the picture.** The money on top — what it sells for,
 *    what it cost to buy, what is kept per sale — and the movement below:
 *    stock on the shelf, units sold, rating.
 * 2. **The owner's private note** — or a quiet invitation to write one.
 * 3. **Sales, Stock and Details side by side**: what it has sold through the till,
 *    what the stock on hand is worth, and the rules, codes and dates.
 * 4. **Customers and recent stock changes** — wishlists, reviews waiting,
 *    returns; the last few ledger movements.
 * 5. **The long parts.** Variants (only when there is more than one, each with
 *    its own purchase price and profit), description and specifications,
 *    gallery and search listing.
 *
 * The record and the product's insights are two reads. The record draws the
 * panel; the insights fill Sales, Customers and the ledger when they land, and
 * cost only those cards if they fail.
 *
 * A value that is not set is left out rather than dashed, and a card with
 * nothing in it is not drawn — except the purchase price, which says "Not set"
 * because without it no profit can be shown, and that is worth fixing.
 *
 * The tiles and the Stock card are worked out from the product as it stands
 * today: the price a shopper would be charged now (the sale price when one is
 * set) against the purchase price typed on the variant. The Sales card is
 * what orders actually brought in — and its "Profit made" is labelled an
 * estimate, because an order line never recorded what the unit cost the shop,
 * so the only cost available is today's laid over past sales.
 *
 * The list row supplies what the detail endpoint does not join: the category and
 * brand *names*, and the stock totals, which `GET /products/:id` has no reason
 * to compute for an editor.
 */
export function ProductDetail({
  row,
  open,
  onOpenChange,
  currency,
  canEdit,
}: {
  row: ProductRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  /** `products.update` — what writing the private note needs. */
  canEdit: boolean;
}) {
  const t = useT();
  const detail = useDetail<ProductView>({
    path: '/api/v1/admin/products',
    id: row?.id ?? null,
    enabled: open,
  });

  /*
   * What the product has actually done — orders, revenue, returns, the ledger.
   * A second read beside the record rather than inside it, because it is the
   * product screen's aggregate and costs what it costs: the panel draws the
   * record the moment it lands, and these cards fill in when this one does. A
   * failure here costs those cards and nothing else.
   */
  const insights = useDetail<ProductInsights>({
    path: '/api/v1/admin/products',
    id: row?.id ?? null,
    suffix: `/insights?days=${SALES_WINDOW_DAYS}`,
    enabled: open,
  });

  const product = detail.data;
  const isFeatured = product?.isFeatured ?? row?.isFeatured;
  const isNewArrival = product?.isNewArrival ?? row?.isNewArrival;

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={product?.name ?? row?.name ?? t('Product')}
      subtitle={row ? [row.categoryName, row.brandName].filter(Boolean).join(' · ') || null : null}
      badge={
        <>
          <StatusBadge status={product?.status ?? row?.status ?? 'draft'} />
          {(product?.type ?? row?.type) === 'variable' ? <Badge variant="info">{t('Variable')}</Badge> : null}
          {isFeatured ? <Badge variant="primary">{t('Featured')}</Badge> : null}
          {isNewArrival ? <Badge variant="primary">{t('New arrival')}</Badge> : null}
        </>
      }
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
      footer={
        row ? (
          <>
            <Button asChild size="sm">
              <Link href={`/products/${row.id}`}>{t('Open product screen')}</Link>
            </Button>
          </>
        ) : null
      }
    >
      {product ? (
        <ProductBody
          product={product}
          row={row}
          currency={currency}
          canEdit={canEdit}
          onNoteSaved={detail.reload}
          insights={insights.data}
          insightsState={insights.error ? 'failed' : insights.loading ? 'loading' : 'ready'}
        />
      ) : null}
    </DetailSheet>
  );
}

/** How far back "recent sales" reaches. */
const SALES_WINDOW_DAYS = 30;

function ProductBody({
  product,
  row,
  currency,
  canEdit,
  onNoteSaved,
  insights,
  insightsState,
}: {
  product: ProductView;
  row: ProductRow | null;
  currency: string;
  canEdit: boolean;
  onNoteSaved: () => void;
  insights: ProductInsights | null;
  insightsState: 'loading' | 'failed' | 'ready';
}) {
  const t = useT();
  const unit = measureUnitOf(product);
  const money = (value: number | string | null | undefined) => t.money(value, currency);
  const pricedPer =
    unit && product.pricingMeasure
      ? product.pricingLabel || t('Per {measure}', { measure: formatMeasure(product.pricingMeasure, unit) })
      : null;

  const lines = pricingLines(product);
  const single = lines.length === 1 ? lines[0]! : null;
  const costed = lines.filter((line): line is PricingLine & { cost: number } => line.cost !== null);
  const uncosted = lines.length - costed.length;
  const onSale = lines.filter((line) => line.onSale);

  // ------------------------------------------------------------- figures --

  const sellingSub = single?.onSale ? (
    <>
      {t.rich('{before} · {percent} off', {
        before: <s>{money(single.regular)}</s>,
        percent: percentOf(discountOf(single.regular, single.sell), t),
      })}
    </>
  ) : onSale.length > 0 && onSale.length === lines.length ? (
    t.rich('{before} · {percent} off', {
      before: <s>{spread(lines.map((line) => line.regular), money)}</s>,
      percent: spread(
        lines.map((line) => discountOf(line.regular, line.sell)),
        (value) => percentOf(value, t),
      ),
    })
  ) : onSale.length > 0 ? (
    t('{count} of {total} variants on sale', { count: onSale.length, total: lines.length })
  ) : (
    pricedPer ?? (lines.length > 1 ? t('Across {count} variants', { count: lines.length }) : null)
  );

  const profits = costed.map((line) => line.sell - line.cost);
  const margins = costed.map((line) => (line.sell > 0 ? ((line.sell - line.cost) / line.sell) * 100 : 0));
  const stock = row ? stockState(row) : null;

  const figures = (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <LazyImage
        src={row?.imageUrl ?? product.defaultVariant?.imageUrl ?? product.media[0]?.url}
        alt=""
        className="col-span-2 h-40 rounded-lg border border-border bg-muted md:col-span-1 md:row-span-2 md:h-auto"
        fallback={<ImageOff className="size-6 text-muted-foreground" />}
      />

      <DetailStat
        label={pricedPer ? t('Selling price · {per}', { per: pricedPer.toLowerCase() }) : t('Selling price')}
        value={lines.length ? spread(lines.map((line) => line.sell), money) : t('Not set')}
        tone={lines.length ? 'default' : 'muted'}
        sub={sellingSub}
      />
      <DetailStat
        label={pricedPer ? t('Purchase price · {per}', { per: pricedPer.toLowerCase() }) : t('Purchase price')}
        value={costed.length ? spread(costed.map((line) => line.cost), money) : t('Not set')}
        tone={costed.length ? 'default' : 'muted'}
        sub={
          costed.length === 0
            ? t('Add it to see your profit')
            : uncosted > 0
              ? t('Not set on {count} of {total} variants', { count: uncosted, total: lines.length })
              : t('What you pay for it')
        }
      />
      <DetailStat
        label={t('Profit per sale')}
        value={profits.length ? spread(profits, money) : t('Unknown')}
        tone={profits.length === 0 ? 'muted' : Math.min(...profits) < 0 ? 'danger' : 'success'}
        sub={
          profits.length
            ? t('{percent} margin', { percent: spread(margins, (value) => percentOf(value, t)) })
            : t('Needs a purchase price')
        }
      />

      {row && stock ? (
        <DetailStat
          label={t('In stock')}
          value={stock.counted ? quantity(row.stock, unit, t) : t(stock.label)}
          tone={stock.tone}
          sub={
            !stock.counted
              ? stock.note && t(stock.note)
              : stock.tone === 'success'
                ? row.reserved > 0
                  ? t('{quantity} held for orders', { quantity: quantity(row.reserved, unit, t) })
                  : t('Ready to sell')
                : t(stock.label)
          }
        />
      ) : (
        <DetailStat label={t('In stock')} value="—" tone="muted" />
      )}
      <DetailStat label={t('Sold')} value={t.number(product.soldCount)} sub={t('Counted on dispatch')} />
      <DetailStat
        label={t('Rating')}
        value={
          product.ratingCount > 0 ? (
            <span className="inline-flex items-center gap-1">
              <Star className="size-4 fill-warning text-warning" aria-hidden />
              {t.number(Number(product.ratingAverage), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </span>
          ) : (
            t('No reviews')
          )
        }
        tone={product.ratingCount > 0 ? 'default' : 'muted'}
        sub={
          product.ratingCount > 0 ? t.plural(product.ratingCount, '{count} review', '{count} reviews') : null
        }
      />
    </div>
  );

  // --------------------------------------------------------------- cards --

  const worth = stockWorth(product);
  const shelf = row?.stock ?? 0;
  const singleCost = single?.cost ?? null;
  // Movements arrive newest first; the first one that put units on the shelf.
  const lastRestock = insights?.movements.find((move) => RESTOCK_TYPES.has(move.type) && move.quantity > 0);

  const stockFacts = keepFacts([
    worth.units > 0 &&
      worth.costed && {
        label: t('Cost of stock'),
        value: money(worth.atCost),
        hint:
          worth.uncosted > 0
            ? t('Variants with no purchase price left out')
            : single && singleCost !== null && !unit
              ? `${t.number(shelf)} × ${money(singleCost)}`
              : undefined,
      },
    worth.units > 0 && {
      label: t('Sells for'),
      value: money(worth.atSell),
      hint: single && !unit ? `${t.number(shelf)} × ${money(single.sell)}` : undefined,
    },
    worth.units > 0 &&
      worth.costed &&
      worth.uncosted === 0 && {
        label: t('Profit on stock'),
        value: (
          <span className={worth.atSell - worth.atCost < 0 ? 'text-destructive' : 'text-success'}>
            {money(worth.atSell - worth.atCost)}
          </span>
        ),
        hint: t('If all of it sells at today’s price'),
      },
    row && row.reserved > 0 && {
      label: t('Reserved'),
      value: quantity(row.reserved, unit, t),
      hint: t('For orders not yet sent'),
    },
    row && row.incoming > 0 && { label: t('Incoming'), value: quantity(row.incoming, unit, t) },
    row &&
      product.trackInventory &&
      row.stockRecords > 0 && {
        label: t('Low-stock alert'),
        value: t('At {quantity}', { quantity: quantity(row.lowStockThreshold, unit, t) }),
      },
    !product.trackInventory && { label: t('Stock tracking'), value: t('Off'), hint: t('Never refuses a sale') },
    insights &&
      insights.stock.returnPending > 0 && {
        label: t('Returns to check'),
        value: quantity(insights.stock.returnPending, unit, t),
        hint: t('Back from customers, not yet on the shelf'),
      },
    insights &&
      insights.stock.damaged > 0 && {
        label: t('Damaged'),
        value: <span className="text-destructive">{quantity(insights.stock.damaged, unit, t)}</span>,
      },
    insights &&
      insights.stock.writtenOff > 0 && {
        label: t('Written off'),
        value: quantity(insights.stock.writtenOff, unit, t),
      },
    lastRestock && {
      label: t('Last restocked'),
      value: t.relative(lastRestock.createdAt),
      hint: t.date(lastRestock.createdAt),
    },
  ]);

  const salesFacts = insights
    ? salesFactsOf(insights, money, costed.length > 0 && uncosted === 0, lines.length > 1, t)
    : [];
  const customerFacts = insights ? customerFactsOf(insights, money, t) : [];
  const recentMoves = insights?.movements.slice(0, 6) ?? [];

  /*
   * Selling rules and the product's codes and dates share one card. Apart, the
   * rules card held a single "Returns" row on most products and stood as a
   * near-empty box between two full ones.
   */
  const activeVariants = product.variants.filter((variant) => variant.isActive).length;
  const detailFacts = keepFacts([
    single && { label: t('SKU'), value: single.variant.sku, mono: true },
    single?.variant.barcode && { label: t('Barcode'), value: single.variant.barcode, mono: true },
    product.variants.length > 1 && {
      label: t('Variants'),
      value: t.number(product.variants.length),
      hint:
        activeVariants < product.variants.length
          ? t('{count} on sale in the store', { count: activeVariants })
          : undefined,
    },
    pricedPer && { label: t('Sold by'), value: pricedPer },
    unit && product.minMeasure && { label: t('Smallest order'), value: formatMeasure(product.minMeasure, unit) },
    unit && {
      label: t('Sizes'),
      value: product.measureOptions?.length
        ? product.measureOptions.map((option) => option.label).join(', ')
        : t('Store default'),
    },
    product.minOrderQuantity > 1 && { label: t('Minimum order'), value: t.number(product.minOrderQuantity) },
    product.maxOrderQuantity !== null && { label: t('Maximum order'), value: t.number(product.maxOrderQuantity) },
    {
      label: t('Returns'),
      value: !product.isReturnable
        ? t('Not accepted')
        : product.returnWindowDays === null
          ? t('Store policy')
          : t('Within {count} days', { count: product.returnWindowDays }),
    },
    product.videoUrl && {
      label: t('Video'),
      value: (
        <a href={product.videoUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          {t('Watch')}
        </a>
      ),
    },
    { label: t('Added'), value: t.date(product.createdAt) },
    { label: t('Last edited'), value: t.relative(product.updatedAt) },
  ]);

  // ----------------------------------------------------------- long parts --

  const description = product.description ? plainText(product.description) : '';
  const specifications = product.specifications.filter((spec) => spec.label.trim() && hasValue(spec.value));
  const seo = keepFacts([
    product.seoTitle && { label: t('Title'), value: product.seoTitle, stacked: true },
    product.seoDescription && { label: t('Description'), value: product.seoDescription, stacked: true },
  ]);

  return (
    <div className="space-y-4">
      {figures}

      {canEdit || product.ownerNote ? (
        <OwnerNote key={product.id} productId={product.id} note={product.ownerNote} canEdit={canEdit} onSaved={onNoteSaved} />
      ) : null}

      <DetailColumns>
        <DetailCard title={t('Sales')}>
          {insightsState === 'loading' && !insights ? (
            <FactsSkeleton rows={4} />
          ) : insightsState === 'failed' && !insights ? (
            <p className="text-sm text-muted-foreground">{t('Sales figures could not be loaded right now.')}</p>
          ) : (
            <DetailFactList facts={salesFacts} />
          )}
        </DetailCard>
        {stockFacts.length > 0 ? (
          <DetailCard title={t('Stock')}>
            <DetailFactList facts={stockFacts} />
          </DetailCard>
        ) : null}
        <DetailCard title={t('Details')}>
          <DetailFactList facts={detailFacts} />
        </DetailCard>
      </DetailColumns>

      <DetailColumns>
        {customerFacts.length > 0 ? (
          <DetailCard title={t('Customers')}>
            <DetailFactList facts={customerFacts} />
          </DetailCard>
        ) : null}
        {recentMoves.length > 0 ? (
          <DetailCard
            title={t('Recent stock changes')}
            action={
              <Link href={`/products/${product.id}`} className="text-xs text-primary hover:underline">
                {t('All changes')}
              </Link>
            }
          >
            <DetailFactList
              facts={recentMoves.map((move) => ({
                label: (
                  <span className="block text-foreground">
                    {MOVEMENT_LABELS[move.type] ? t(MOVEMENT_LABELS[move.type]!) : t.loose(titleCase(move.type))}
                    <span className="block text-xs text-muted-foreground">
                      {[lines.length > 1 ? move.variantTitle : null, move.orderNumber, t.relative(move.createdAt)]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                ),
                value: (
                  <span
                    className={cn(
                      'tabular-nums',
                      move.quantity > 0 ? 'text-success' : move.quantity < 0 ? 'text-destructive' : undefined,
                    )}
                  >
                    {move.quantity > 0 ? '+' : move.quantity < 0 ? '−' : ''}
                    {quantity(Math.abs(move.quantity), unit, t)}
                  </span>
                ),
              }))}
            />
          </DetailCard>
        ) : null}
      </DetailColumns>

      {product.variants.length > 1 ? (
        <DetailCard
          title={t('Variants')}
          action={<span className="text-xs text-muted-foreground">{t.number(product.variants.length)}</span>}
        >
          <VariantTable variants={product.variants} unit={unit} currency={currency} />
        </DetailCard>
      ) : null}

      <DetailColumns>
        {description ? (
          <DetailCard title={t('Description')}>
            <ClampedText text={description} />
          </DetailCard>
        ) : null}
        {specifications.length > 0 ? (
          <DetailCard
            title={t('Specifications')}
            action={<span className="text-xs text-muted-foreground">{t.number(specifications.length)}</span>}
          >
            <SpecificationList specs={specifications} />
          </DetailCard>
        ) : null}
      </DetailColumns>

      <DetailColumns>
        {product.media.length > 0 ? (
          <DetailCard
            title={t('Gallery')}
            action={<span className="text-xs text-muted-foreground">{t.number(product.media.length)}</span>}
          >
            <div className="flex flex-wrap gap-2">
              {product.media.map((image) => (
                <a
                  key={image.id}
                  href={image.url}
                  target="_blank"
                  rel="noreferrer"
                  title={image.altText ?? undefined}
                >
                  <LazyImage
                    src={image.url}
                    alt={image.altText ?? ''}
                    className="size-16 rounded-lg border border-border bg-muted"
                    fallback={<ImageOff className="size-4 text-muted-foreground" />}
                  />
                </a>
              ))}
            </div>
          </DetailCard>
        ) : null}
        {seo.length > 0 ? (
          <DetailCard title={t('Search listing')}>
            <DetailFactList facts={seo} />
          </DetailCard>
        ) : null}
      </DetailColumns>
    </div>
  );
}

/**
 * The owner's own note on this product — a supplier's name, a reorder
 * reminder, why the price is what it is.
 *
 * Private: `PUT /products/:id/note` writes it, only the admin detail read
 * returns it, and nothing on the storefront selects the column. Keyed on the
 * product by its caller, so moving the panel to another row starts clean rather
 * than carrying a half-typed note across.
 */
function OwnerNote({
  productId,
  note,
  canEdit,
  onSaved,
}: {
  productId: string;
  note: string | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const t = useT();
  const [saved, setSaved] = React.useState(note);
  const [draft, setDraft] = React.useState(note ?? '');
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');

  const start = () => {
    setDraft(saved ?? '');
    setError('');
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const result = await api.put<{ ownerNote: string | null }>(`/api/v1/admin/products/${productId}/note`, {
        note: draft,
      });
      setSaved(result.ownerNote);
      setEditing(false);
      toast.success(result.ownerNote ? t('Note saved.') : t('Note removed.'));
      // Refreshes the cached record in place, so reopening this row shows it.
      onSaved();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  };

  const title = (
    <span className="inline-flex items-center gap-1.5">
      <NotebookPen className="size-3.5" aria-hidden /> {t('Private note')}
    </span>
  );
  const privacy = (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Lock className="size-3" aria-hidden /> {t('Only you can see this')}
    </span>
  );

  if (editing) {
    return (
      <DetailCard title={title} action={privacy} className="border-primary/40">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !saving) void save();
          }}
          maxLength={5000}
          rows={4}
          autoFocus
          aria-label={t('Private note')}
          placeholder={t(
            'Supplier and phone, when to reorder, why it is priced this way — anything worth remembering.',
          )}
        />
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('{count} / {max} · Ctrl+Enter saves', { count: draft.length, max: 5000 })}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={saving}>
              {t('Cancel')}
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {t('Save note')}
            </Button>
          </div>
        </div>
      </DetailCard>
    );
  }

  if (!saved) {
    return (
      <button
        type="button"
        onClick={start}
        className="flex w-full items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
      >
        <NotebookPen className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{t('Add a private note')}</span>
          <span className="block text-xs text-muted-foreground">
            {t('Supplier, reorder reminder, anything about this product — only you can see it.')}
          </span>
        </span>
      </button>
    );
  }

  return (
    <DetailCard
      title={title}
      action={
        <span className="flex items-center gap-3">
          {privacy}
          {canEdit ? (
            <button type="button" onClick={start} className="text-xs font-medium text-primary hover:underline">
              {t('Edit')}
            </button>
          ) : null}
        </span>
      }
      className="bg-warning-soft/30"
    >
      <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{saved}</p>
    </DetailCard>
  );
}

/** Rows shaped like a fact list, while a card's figures are on their way. */
function FactsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center justify-between gap-4">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-14" />
        </div>
      ))}
    </div>
  );
}

/**
 * What the product has sold through the till, all time, plus the last
 * `SALES_WINDOW_DAYS`. Counted on orders that were neither cancelled nor failed,
 * in the store's current currency — so it can trail the "Sold" tile, which moves
 * on dispatch, while parcels are still waiting to be packed.
 */
function salesFactsOf(
  insights: ProductInsights,
  money: (value: number | string | null | undefined) => string,
  fullyCosted: boolean,
  hasVariants: boolean,
  t: Translator,
): DetailFact[] {
  const { money: takings, sales, range } = insights;

  if (takings.orders === 0) {
    return [{ label: t('Orders'), value: t('None yet'), hint: t('Figures appear after the first order') }];
  }

  const recentUnits = sales.series.reduce((sum, point) => sum + point.units, 0);
  const recentRevenue = sales.series.reduce((sum, point) => sum + Number(point.revenue), 0);
  const profit = Number(takings.estimatedProfit);

  return keepFacts([
    { label: t('Orders'), value: t.number(takings.orders) },
    { label: t('Units ordered'), value: t.number(takings.units) },
    { label: t('Revenue'), value: money(takings.revenue) },
    Number(takings.discount) > 0 && { label: t('Discounts given'), value: money(takings.discount) },
    Number(takings.refunded) > 0 && {
      label: t('Refunded'),
      value: <span className="text-destructive">{money(takings.refunded)}</span>,
    },
    // Only with a purchase price on every variant: the API counts a missing one
    // as zero cost, which would print revenue and call it profit.
    fullyCosted && {
      label: t('Profit made'),
      value: <span className={profit < 0 ? 'text-destructive' : 'text-success'}>{money(profit)}</span>,
      hint: t('After refunds, at today’s purchase price'),
    },
    takings.averageSellingPrice && { label: t('Average price paid'), value: money(takings.averageSellingPrice) },
    {
      label: t('Last {count} days', { count: range.days }),
      value: recentUnits > 0 ? `${t.number(recentUnits)} · ${money(recentRevenue)}` : t('No orders'),
    },
    hasVariants &&
      sales.bestVariant && {
        label: t('Best seller'),
        value: sales.bestVariant.title ?? sales.bestVariant.sku,
        hint: t('{count} sold', { count: sales.bestVariant.sold }),
      },
  ]);
}

/** What shoppers are doing about the product besides buying it. Empty when nothing is. */
function customerFactsOf(
  insights: ProductInsights,
  money: (value: number | string | null | undefined) => string,
  t: Translator,
): DetailFact[] {
  const { activity, returns, product } = insights;

  return keepFacts([
    activity.wishlistCount > 0 && {
      label: t('In wishlists'),
      value: t.number(activity.wishlistCount),
      hint: t('Shoppers saving it for later'),
    },
    activity.pendingReviews > 0 && {
      label: t('Reviews to approve'),
      value: (
        <Link href={`/products/${product.id}?tab=reviews`} className="text-warning hover:underline">
          {t.number(activity.pendingReviews)}
        </Link>
      ),
    },
    returns.requests > 0 && {
      label: t('Returns'),
      value: t.plural(returns.units, '{count} unit', '{count} units'),
      hint: [
        t.plural(returns.requests, '{count} request', '{count} requests'),
        returns.rate !== null
          ? t('{percent} of units ordered', { percent: `${t.number(returns.rate)}%` })
          : null,
      ]
        .filter(Boolean)
        .join(' · '),
    },
    returns.open > 0 && {
      label: t('Returns open'),
      value: (
        <Link href="/returns" className="text-warning hover:underline">
          {t.number(returns.open)}
        </Link>
      ),
    },
    Number(returns.value) > 0 && { label: t('Value returned'), value: money(returns.value) },
  ]);
}

/** A movement in a shopkeeper's words — the product screen's ledger uses the same. */
const MOVEMENT_LABELS: Record<string, MessageKey> = {
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

/** Movements that mean the shop put stock on the shelf itself. */
const RESTOCK_TYPES = new Set(['initial', 'received']);

/**
 * Each variant's buy, sell and keep, side by side — the table exists because
 * variants of one product are often bought at different prices. Barcode and
 * status columns appear only when some variant fills them.
 */
function VariantTable({
  variants,
  unit,
  currency,
}: {
  variants: ProductVariant[];
  unit: MeasureUnit | null;
  currency: string;
}) {
  const t = useT();
  const anyCost = variants.some((variant) => variant.costPrice !== null);
  const anyBarcode = variants.some((variant) => variant.barcode);
  const anyOff = variants.some((variant) => !variant.isActive);
  const sellOf = (variant: ProductVariant) =>
    Number(saleIsLive(variant) ? variant.salePrice : variant.price);

  return (
    <DetailTable
      rows={variants}
      rowKey={(variant) => variant.id}
      columns={[
        {
          key: 'variant',
          header: 'Variant',
          cell: (variant) => (
            <div className="flex items-center gap-2">
              <LazyImage
                src={variant.imageUrl}
                alt=""
                className="size-8 rounded border border-border bg-muted"
                fallback={<ImageOff className="size-3.5 text-muted-foreground" />}
              />
              <div className="min-w-0">
                <span className="flex items-center gap-1.5">
                  <span className="truncate">{variant.title ?? 'Default'}</span>
                  {variant.isDefault ? <Badge variant="neutral">Default</Badge> : null}
                </span>
                <span className="block truncate font-mono text-xs text-muted-foreground">{variant.sku}</span>
              </div>
            </div>
          ),
        },
        {
          key: 'sell',
          header: 'Selling price',
          align: 'right',
          cell: (variant) => (
            <>
              {t.money(sellOf(variant), currency)}
              {saleIsLive(variant) ? (
                <s className="block text-xs text-muted-foreground">{t.money(variant.price, currency)}</s>
              ) : null}
            </>
          ),
        },
        ...(anyCost
          ? [
              {
                key: 'cost',
                header: 'Purchase price',
                align: 'right' as const,
                cell: (variant: ProductVariant) =>
                  variant.costPrice === null ? (
                    <span className="text-muted-foreground">Not set</span>
                  ) : (
                    t.money(variant.costPrice, currency)
                  ),
              },
              {
                key: 'profit',
                header: 'Profit',
                align: 'right' as const,
                cell: (variant: ProductVariant) => {
                  if (variant.costPrice === null) return null;
                  const sell = sellOf(variant);
                  const profit = sell - Number(variant.costPrice);
                  return (
                    <>
                      <span className={profit < 0 ? 'text-destructive' : 'text-success'}>
                        {t.money(profit, currency)}
                      </span>
                      {sell > 0 ? (
                        <span className="block text-xs text-muted-foreground">
                          {((profit / sell) * 100).toFixed(0)}%
                        </span>
                      ) : null}
                    </>
                  );
                },
              },
            ]
          : []),
        {
          key: 'stock',
          header: 'In stock',
          align: 'right',
          cell: (variant) =>
            variant.stock === null ? (
              <span className="text-muted-foreground">Not counted</span>
            ) : (
              <>
                <span className={variant.stock <= 0 ? 'text-destructive' : undefined}>
                  {quantity(variant.stock, unit, t)}
                </span>
                {variant.reserved > 0 ? (
                  <span className="block text-xs text-muted-foreground">
                    {quantity(variant.reserved, unit, t)} reserved
                  </span>
                ) : null}
              </>
            ),
        },
        ...(anyBarcode
          ? [
              {
                key: 'barcode',
                header: 'Barcode',
                cell: (variant: ProductVariant) => <span className="font-mono text-xs">{variant.barcode}</span>,
              },
            ]
          : []),
        ...(anyOff
          ? [
              {
                key: 'state',
                header: 'Status',
                cell: (variant: ProductVariant) => (
                  <StatusBadge status={variant.isActive ? 'active' : 'disabled'} />
                ),
              },
            ]
          : []),
      ]}
    />
  );
}

/** Grouped under their own headings only when there is more than one group. */
function SpecificationList({ specs }: { specs: ProductSpecificationRow[] }) {
  const groups = new Map<string, ProductSpecificationRow[]>();
  for (const spec of specs) {
    const name = spec.groupName?.trim() ?? '';
    groups.set(name, [...(groups.get(name) ?? []), spec]);
  }
  const titled = groups.size > 1;

  return (
    <div className="space-y-4">
      {[...groups].map(([name, rows]) => (
        <div key={name || 'ungrouped'}>
          {titled && name ? <p className="mb-1.5 text-xs font-medium">{name}</p> : null}
          <DetailFactList facts={rows.map((spec) => ({ label: spec.label, value: spec.value }))} />
        </div>
      ))}
    </div>
  );
}

/** A long description, folded to five lines until asked for. */
function ClampedText({ text }: { text: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const long = text.length > 320 || text.split('\n').length > 5;

  return (
    <div>
      <p className={cn('text-sm leading-relaxed whitespace-pre-line', long && !expanded && 'line-clamp-5')}>
        {text}
      </p>
      {long ? (
        <button
          type="button"
          className="mt-2 text-xs font-medium text-primary hover:underline"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- helpers --

interface PricingLine {
  variant: ProductVariant;
  /** What a shopper is charged — the sale price when one is set. */
  sell: number;
  regular: number;
  /** The purchase price. Null when it was never typed in. */
  cost: number | null;
  onSale: boolean;
}

/**
 * One line per variant a shopper can buy. A switched-off variant is left out of
 * the headline figures — its price is not one anybody is charged — unless every
 * variant is off, when the product would otherwise show no price at all.
 */
function pricingLines(product: ProductView): PricingLine[] {
  const active = product.variants.filter((variant) => variant.isActive);
  return (active.length > 0 ? active : product.variants).map((variant) => {
    const onSale = saleIsLive(variant);
    return {
      variant,
      sell: Number(onSale ? variant.salePrice : variant.price),
      regular: Number(variant.price),
      cost: variant.costPrice === null ? null : Number(variant.costPrice),
      onSale,
    };
  });
}

/**
 * What the stock on hand is worth, at what it cost and at what it sells for.
 *
 * Over every variant, switched off or not — stock is owned either way. For a
 * product weighed out, stock is counted in grams and priced per kilo, so the
 * count is divided by the pricing measure before it meets a price.
 */
function stockWorth(product: ProductView) {
  const unit = measureUnitOf(product);
  const per = unit && product.pricingMeasure ? product.pricingMeasure : 1;
  let units = 0;
  let atCost = 0;
  let atSell = 0;
  let costed = false;
  let uncosted = 0;

  for (const variant of product.variants) {
    const onShelf = (variant.stock ?? 0) / per;
    if (onShelf <= 0) continue;
    units += onShelf;
    atSell += onShelf * Number(saleIsLive(variant) ? variant.salePrice : variant.price);
    if (variant.costPrice === null) {
      uncosted += 1;
    } else {
      costed = true;
      atCost += onShelf * Number(variant.costPrice);
    }
  }

  return { units, atCost, atSell, costed, uncosted };
}

/** `$45` when every value agrees, `$45 – $59` when they do not. */
function spread(values: number[], format: (value: number) => string): string {
  if (values.length === 0) return '';
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high ? format(low) : `${format(low)} – ${format(high)}`;
}

/** The base unit a weighed-out product is counted in, or null for one sold singly. */
function measureUnitOf(product: ProductView): MeasureUnit | null {
  if (product.sellBy !== 'measure' || !product.measureUnit) return null;
  return (MEASURE_UNITS as readonly string[]).includes(product.measureUnit)
    ? (product.measureUnit as MeasureUnit)
    : null;
}

/** Stock of a weighed-out product is grams or millilitres, and reads as such. */
function quantity(value: number, unit: MeasureUnit | null, t: Translator): string {
  return unit ? formatMeasure(value, unit) : t.number(value);
}

/** `12%`, in the panel's own digits. */
function percentOf(value: number, t: Translator): string {
  return `${t.number(value, { maximumFractionDigits: 0 })}%`;
}

/**
 * The same four states the list's stock column draws, so the panel cannot call a
 * product "in stock" that the row beside it calls "not counted".
 */
function stockState(row: ProductRow): {
  counted: boolean;
  tone: 'success' | 'warning' | 'danger' | 'muted';
  label: MessageKey;
  note?: MessageKey;
} {
  if (!row.trackInventory) return { counted: false, tone: 'muted', label: 'Not tracked', note: 'Never refuses a sale' };
  if (row.stockRecords === 0) {
    return { counted: false, tone: 'muted', label: 'Not counted', note: 'Add stock to start counting' };
  }
  if (row.stock <= 0) return { counted: true, tone: 'danger', label: 'Out of stock' };
  if (row.stock <= row.lowStockThreshold) return { counted: true, tone: 'warning', label: 'Low stock' };
  return { counted: true, tone: 'success', label: 'In stock' };
}

/** Whether a shopper is charged the sale price. */
function saleIsLive(variant: Pick<ProductVariant, 'salePrice'>): boolean {
  return variant.salePrice !== null;
}

function discountOf(regular: number, sale: number): number {
  return regular > 0 ? Math.round(((regular - sale) / regular) * 100) : 0;
}

/** Some imported specifications carry the literal text "undefined" as their value. */
function hasValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== '' && !/^(undefined|null|n\/a|-|—)$/i.test(trimmed);
}

/**
 * The description is stored as HTML for the storefront to render. Here it is
 * read, not rendered: tags become line breaks and are dropped, and the result is
 * set as text, so nothing in it can run in the panel.
 */
function plainText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '• ')
    .replace(/<\/\s*(p|div|li|h[1-6]|tr|ul|ol)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

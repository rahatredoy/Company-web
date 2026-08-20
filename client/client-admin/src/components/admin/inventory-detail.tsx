'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDetail } from '@/hooks/use-detail';
import { formatDateTime, formatMoney, formatNumber, titleCase } from '@/lib/format';
import { formatStock } from '@/lib/measure';
import type { InventoryRow, InventoryView } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  DetailBool,
  DetailField,
  DetailGrid,
  DetailId,
  DetailJson,
  DetailSection,
  DetailSheet,
  DetailTable,
} from './detail-sheet';
import { LazyImage } from './lazy-image';

/**
 * One stock record — a variant in a warehouse — and the ledger that explains it.
 *
 * The five buckets are shown as five figures rather than one number, because
 * they mean different things and only one of them is sellable: `reserved` is
 * committed to an order that has not shipped, `return_pending` is physically
 * back but not yet inspected, `damaged` is written off, and `incoming` is on a
 * purchase order and not here at all. A screen that adds them up invites the
 * shopkeeper to promise stock they cannot send.
 *
 * The product's `track_inventory` is shown beside them for the same reason: with
 * it off, every figure here is still counted and none of it refuses a sale, and
 * that is a fact about the product rather than about this level.
 *
 * The ledger is the append-only record every movement writes in the same
 * transaction as the level it changed, which is what makes a level explainable
 * at all — `availableAfter` is the snapshot taken as each move landed.
 */
export function InventoryDetail({
  row,
  open,
  onOpenChange,
  currency,
}: {
  row: InventoryRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
}) {
  const detail = useDetail<InventoryView>({
    path: '/api/v1/admin/inventory',
    id: row?.id ?? null,
    enabled: open,
  });

  const level = detail.data;

  /*
   * Every bucket on this record counts base units when the product is sold by
   * weight or volume, so they are printed as the shop reads them — "40kg", not
   * "40000". Null for an ordinary product, where the counts are whole items.
   */
  const unit = level?.product.measureUnit ?? null;
  const count = (value: number) => (unit ? formatStock(value, unit) : formatNumber(value));

  const buckets = level
    ? ([
        ['Available', level.available, 'Sellable right now.'],
        ['Reserved', level.reserved, 'Committed to an order that has not shipped.'],
        ['Return pending', level.returnPending, 'Back in the building, awaiting inspection.'],
        ['Damaged', level.damaged, 'Written off. Never sellable.'],
        ['Incoming', level.incoming, 'On a purchase order, not yet received.'],
      ] as const)
    : [];

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={level?.product.name ?? row?.productName ?? 'Stock'}
      subtitle={
        level
          ? `${level.variant.sku}${level.variant.title ? ` · ${level.variant.title}` : ''} · ${level.warehouse.name}`
          : row?.sku
      }
      badge={
        level ? (
          <>
            <StatusBadge
              status={
                level.available <= 0 ? 'failed' : level.available <= level.lowStockThreshold ? 'pending' : 'active'
              }
              label={
                level.available <= 0
                  ? 'Out of stock'
                  : level.available <= level.lowStockThreshold
                    ? 'Low stock'
                    : 'In stock'
              }
            />
            {level.product.trackInventory ? null : <StatusBadge status="info" label="Not enforced" />}
          </>
        ) : null
      }
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
      footer={
        level ? (
          <Button asChild variant="outline" size="sm">
            <Link href={`/products/${level.product.id}`}>Open the product</Link>
          </Button>
        ) : null
      }
    >
      {level ? (
        <div className="space-y-6">
          <DetailSection title="Buckets" description="Only the first of these can be sold.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {buckets.map(([label, value, hint]) => (
                <div key={label} className="rounded-lg border border-border p-3" title={hint}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p
                    className={cn(
                      'text-xl font-semibold tabular-nums',
                      label === 'Available' && value <= 0 && 'text-destructive',
                      label === 'Damaged' && value > 0 && 'text-warning',
                    )}
                  >
                    {count(value)}
                  </p>
                </div>
              ))}
              <div className="rounded-lg border border-dashed border-border p-3">
                <p className="text-xs text-muted-foreground">On hand</p>
                <p className="text-xl font-semibold tabular-nums">{count(level.onHand)}</p>
                <p className="text-[11px] text-muted-foreground">Everything in the building.</p>
              </div>
            </div>
          </DetailSection>

          <DetailSection title="This record">
            <DetailGrid>
              <DetailField label="Warehouse" value={`${level.warehouse.name} (${level.warehouse.code})`} />
              <DetailField
                label="Low-stock threshold"
                value={count(level.lowStockThreshold)}
                hint="At or below this, the list flags it."
              />
              <DetailField label="Last moved" value={formatDateTime(level.updatedAt)} />
              <DetailField label="Level ID" value={<DetailId value={level.id} />} />
              <DetailField label="Variant ID" value={<DetailId value={level.variantId} />} />
              <DetailField label="Warehouse ID" value={<DetailId value={level.warehouseId} />} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Variant">
            <div className="mb-3 flex items-start gap-3">
              <LazyImage
                src={level.variant.imageUrl}
                alt=""
                className="size-16 rounded-lg border border-border bg-muted"
                fallback={<span className="text-[10px] text-muted-foreground">—</span>}
              />
              <div className="min-w-0">
                <p className="font-medium">{level.variant.title ?? 'Default variant'}</p>
                <p className="font-mono text-xs text-muted-foreground">{level.variant.sku}</p>
              </div>
            </div>
            <DetailGrid>
              <DetailField label="Price" value={formatMoney(level.variant.price, currency)} />
              <DetailField label="Sale price" value={formatMoney(level.variant.salePrice, currency)} />
              <DetailField
                label="Cost"
                value={formatMoney(level.variant.costPrice, currency)}
                hint="What this stock is worth to the shop."
              />
              <DetailField
                label="Stock at cost"
                value={
                  level.variant.costPrice
                    ? formatMoney(Number(level.variant.costPrice) * level.available, currency)
                    : null
                }
                hint={level.variant.costPrice ? undefined : 'No cost recorded, so it counts as nothing.'}
              />
              <DetailField label="Barcode" value={level.variant.barcode} mono />
              <DetailField
                label="Weight"
                value={level.variant.weightGrams === null ? null : `${formatNumber(level.variant.weightGrams)} g`}
              />
              <DetailField label="Default variant" value={<DetailBool value={level.variant.isDefault} />} />
              <DetailField label="Active" value={<DetailBool value={level.variant.isActive} />} />
              <DetailField label="Created" value={formatDateTime(level.variant.createdAt)} />
              <DetailField label="Updated" value={formatDateTime(level.variant.updatedAt)} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Product">
            <DetailGrid>
              <DetailField
                label="Name"
                value={
                  <Link href={`/products/${level.product.id}`} className="hover:underline">
                    {level.product.name}
                  </Link>
                }
              />
              <DetailField label="Address" value={level.product.slug} mono />
              <DetailField label="Status" value={<StatusBadge status={level.product.status} />} />
              <DetailField label="Type" value={titleCase(level.product.productType)} />
              <DetailField
                label="Stock decides sales"
                value={<DetailBool value={level.product.trackInventory} />}
                hint={
                  level.product.trackInventory
                    ? 'An empty bucket refuses the sale.'
                    : 'Counted, but a sale is never refused on it.'
                }
              />
              <DetailField
                label="Sold"
                value={formatNumber(level.product.soldCount)}
                hint="Across every warehouse, counted on dispatch."
              />
              <DetailField label="Returnable" value={<DetailBool value={level.product.isReturnable} />} />
              <DetailField
                label="Order limits"
                value={`${level.product.minOrderQuantity} – ${level.product.maxOrderQuantity ?? 'no limit'}`}
              />
            </DetailGrid>
          </DetailSection>

          {level.otherWarehouses.length > 0 ? (
            <DetailSection
              title="The same variant elsewhere"
              description="So an empty shelf here is not read as out of stock everywhere."
            >
              <DetailTable
                rows={level.otherWarehouses}
                rowKey={(other) => other.id}
                columns={[
                  {
                    key: 'warehouse',
                    header: 'Warehouse',
                    cell: (other) => `${other.warehouseName} (${other.warehouseCode})`,
                  },
                  { key: 'available', header: 'Available', align: 'right', cell: (other) => other.available },
                  { key: 'reserved', header: 'Reserved', align: 'right', cell: (other) => other.reserved },
                  { key: 'damaged', header: 'Damaged', align: 'right', cell: (other) => other.damaged },
                  { key: 'incoming', header: 'Incoming', align: 'right', cell: (other) => other.incoming },
                ]}
              />
            </DetailSection>
          ) : null}

          <DetailSection
            title="Warehouse"
            action={level.warehouse.isDefault ? <StatusBadge status="active" label="Default" /> : null}
          >
            <DetailGrid>
              <DetailField label="Name" value={level.warehouse.name} />
              <DetailField label="Code" value={level.warehouse.code} mono />
              <DetailField label="Address" value={level.warehouse.address} full />
              <DetailField label="City" value={level.warehouse.city} />
              <DetailField label="Country" value={level.warehouse.country} />
              <DetailField label="Phone" value={level.warehouse.phone} />
              <DetailField label="Active" value={<DetailBool value={level.warehouse.isActive} />} />
            </DetailGrid>
          </DetailSection>

          <DetailSection
            title="Ledger"
            description="Every movement, written in the same transaction as the level it changed."
            action={
              level.transactions.length >= 50 ? (
                <span className="text-xs text-muted-foreground">Most recent 50</span>
              ) : null
            }
          >
            <DetailTable
              rows={level.transactions}
              rowKey={(entry) => entry.id}
              empty="Nothing has moved in this warehouse yet."
              columns={[
                { key: 'type', header: 'Move', cell: (entry) => titleCase(entry.type) },
                {
                  key: 'quantity',
                  header: 'Qty',
                  align: 'right',
                  cell: (entry) => (
                    <span className={entry.quantity < 0 ? 'text-destructive' : 'text-success'}>
                      {entry.quantity > 0 ? `+${entry.quantity}` : entry.quantity}
                    </span>
                  ),
                },
                {
                  key: 'buckets',
                  header: 'Between',
                  cell: (entry) =>
                    entry.fromBucket || entry.toBucket
                      ? `${entry.fromBucket ?? '—'} → ${entry.toBucket ?? '—'}`
                      : '—',
                },
                {
                  key: 'after',
                  header: 'Available after',
                  align: 'right',
                  cell: (entry) => entry.availableAfter,
                },
                { key: 'by', header: 'By', cell: (entry) => entry.adminLabel ?? 'System' },
                {
                  key: 'note',
                  header: 'Note',
                  cell: (entry) => (
                    <span className="text-xs">
                      {entry.note ?? (entry.referenceType ? titleCase(entry.referenceType) : '—')}
                    </span>
                  ),
                },
                { key: 'when', header: 'When', cell: (entry) => formatDateTime(entry.createdAt) },
              ]}
            />
          </DetailSection>

          {level.transactions.some((entry) => entry.metadata) ? (
            <DetailSection title="Latest movement metadata">
              <DetailJson value={level.transactions.find((entry) => entry.metadata)?.metadata} />
            </DetailSection>
          ) : null}
        </div>
      ) : null}
    </DetailSheet>
  );
}

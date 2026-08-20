'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDetail } from '@/hooks/use-detail';
import { formatDate, formatDateTime, formatMoney, formatNumber, titleCase } from '@/lib/format';
import type { ProductRow, ProductView } from '@/lib/types';
import {
  DetailBool,
  DetailEmpty,
  DetailField,
  DetailGrid,
  DetailId,
  DetailProse,
  DetailSection,
  DetailSheet,
  DetailStorefrontLink,
  DetailTable,
} from './detail-sheet';
import { LazyImage } from './lazy-image';

/**
 * A product, as the database has it.
 *
 * This is the list whose **View** used to open the storefront, and the reason
 * the change was worth making: the shop's own page shows a price, a picture and
 * a description, and says nothing about cost price, stock buckets, the SKU, how
 * many have sold, or the four variants that are switched off. All of that is on
 * the row, and none of it is a shopper's business.
 *
 * The storefront link is still here, in the footer — it is a useful thing to
 * open, just not the meaning of "view". Alongside it is the product screen,
 * which is where editing and the sales figures live; this panel is deliberately
 * read-only, so a reader can look at a row from the list without leaving it.
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
  storefrontBase,
}: {
  row: ProductRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currency: string;
  /** Null when the store's public address is not known to this deployment. */
  storefrontBase: string | null;
}) {
  const detail = useDetail<ProductView>({
    path: '/api/v1/admin/products',
    id: row?.id ?? null,
    enabled: open,
  });

  const product = detail.data;

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={product?.name ?? row?.name ?? 'Product'}
      subtitle={
        row ? [row.categoryName, row.brandName].filter(Boolean).join(' · ') || row.slug : product?.slug
      }
      badge={
        <>
          <StatusBadge status={product?.status ?? row?.status ?? 'draft'} />
          {(product?.type ?? row?.type) === 'variable' ? <StatusBadge status="info" label="Variable" /> : null}
        </>
      }
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
      footer={
        row ? (
          <>
            {storefrontBase ? (
              <DetailStorefrontLink href={`${storefrontBase}/product/${row.slug}`} />
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href={`/products/${row.id}`}>Open product screen</Link>
            </Button>
          </>
        ) : null
      }
    >
      {product ? (
        <div className="space-y-6">
          <DetailSection title="Basics">
            <DetailGrid>
              <DetailField label="Name" value={product.name} />
              <DetailField label="Address" value={product.slug} mono />
              <DetailField label="Status" value={<StatusBadge status={product.status} />} />
              <DetailField label="Type" value={titleCase(product.type)} />
              <DetailField label="Category" value={row?.categoryName} />
              <DetailField label="Brand" value={row?.brandName} />
              <DetailField label="Product ID" value={<DetailId value={product.id} />} />
              <DetailField label="Category ID" value={<DetailId value={product.categoryId} />} />
              <DetailField label="Brand ID" value={<DetailId value={product.brandId} />} />
              <DetailField label="Published" value={formatDateTime(product.publishedAt)} />
              <DetailField label="Created" value={formatDateTime(product.createdAt)} />
              <DetailField label="Updated" value={formatDateTime(product.updatedAt)} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Merchandising">
            <DetailGrid>
              <DetailField label="Featured" value={<DetailBool value={product.isFeatured} />} />
              <DetailField label="New arrival" value={<DetailBool value={product.isNewArrival} />} />
              <DetailField label="Returnable" value={<DetailBool value={product.isReturnable} />} />
              <DetailField
                label="Return window"
                value={product.returnWindowDays === null ? null : `${product.returnWindowDays} days`}
                hint={product.returnWindowDays === null ? "Uses the store's own window." : undefined}
              />
              <DetailField label="Minimum per order" value={formatNumber(product.minOrderQuantity)} />
              <DetailField
                label="Maximum per order"
                value={product.maxOrderQuantity === null ? 'No limit' : formatNumber(product.maxOrderQuantity)}
              />
              <DetailField
                label="Stock decides sales"
                value={<DetailBool value={product.trackInventory} />}
                hint={
                  product.trackInventory
                    ? 'Runs out and the storefront refuses the sale.'
                    : 'Stock is still counted, but never refuses a sale.'
                }
              />
              <DetailField label="Video" value={product.videoUrl} full />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Performance" description="Maintained by the shop, never typed in.">
            <DetailGrid>
              <DetailField
                label="Sold"
                value={formatNumber(product.soldCount)}
                hint="Counted on dispatch, not at checkout."
              />
              <DetailField label="Views" value={formatNumber(product.viewCount)} />
              <DetailField
                label="Rating"
                value={
                  product.ratingCount > 0
                    ? `${Number(product.ratingAverage).toFixed(2)} from ${formatNumber(product.ratingCount)}`
                    : null
                }
                hint={product.ratingCount === 0 ? 'No approved review yet.' : undefined}
              />
              {row ? (
                <>
                  <DetailField label="Sellable now" value={formatNumber(row.stock)} />
                  <DetailField
                    label="Reserved"
                    value={formatNumber(row.reserved)}
                    hint="Committed to orders not yet dispatched."
                  />
                  <DetailField label="Incoming" value={formatNumber(row.incoming)} />
                  <DetailField
                    label="Stock records"
                    value={formatNumber(row.stockRecords)}
                    hint={row.stockRecords === 0 ? 'Never counted — not the same as empty.' : undefined}
                  />
                  <DetailField label="Low-stock threshold" value={formatNumber(row.lowStockThreshold)} />
                </>
              ) : null}
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Price">
            <DetailGrid>
              <DetailField
                label="From"
                value={formatMoney(product.priceFrom, currency)}
                hint="The cheapest sellable variant."
              />
              <DetailField label="Sale from" value={formatMoney(product.salePriceFrom, currency)} />
              <DetailField label="Default SKU" value={product.defaultVariant?.sku} mono />
              <DetailField
                label="Cost"
                value={formatMoney(product.defaultVariant?.costPrice, currency)}
                hint="Never shown to a shopper. It is what margin is measured from."
              />
            </DetailGrid>
          </DetailSection>

          <DetailSection
            title="Variants"
            action={<span className="text-xs text-muted-foreground">{product.variants.length}</span>}
          >
            <DetailTable
              rows={product.variants}
              rowKey={(variant) => variant.id}
              empty="No variant — which should not happen; every product owns at least one."
              columns={[
                {
                  key: 'variant',
                  header: 'Variant',
                  cell: (variant) => (
                    <div className="flex items-start gap-2">
                      <LazyImage
                        src={variant.imageUrl}
                        alt=""
                        className="size-8 rounded border border-border bg-muted"
                        fallback={<span className="text-[10px] text-muted-foreground">—</span>}
                      />
                      <div className="min-w-0">
                        <span className="block truncate">{variant.title ?? 'Default'}</span>
                        <span className="block truncate font-mono text-xs text-muted-foreground">
                          {variant.sku}
                        </span>
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'price',
                  header: 'Price',
                  align: 'right',
                  cell: (variant) => (
                    <>
                      {formatMoney(variant.salePrice ?? variant.price, currency)}
                      {variant.salePrice && (variant.saleStartsAt || variant.saleEndsAt) ? (
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          {variant.saleStartsAt ? formatDate(variant.saleStartsAt) : 'now'} –{' '}
                          {variant.saleEndsAt ? formatDate(variant.saleEndsAt) : 'open'}
                        </span>
                      ) : null}
                    </>
                  ),
                },
                {
                  key: 'cost',
                  header: 'Cost',
                  align: 'right',
                  cell: (variant) => formatMoney(variant.costPrice, currency),
                },
                {
                  key: 'barcode',
                  header: 'Barcode',
                  cell: (variant) => <span className="font-mono text-xs">{variant.barcode ?? '—'}</span>,
                },
                {
                  key: 'state',
                  header: 'State',
                  cell: (variant) => (
                    <span className="flex flex-wrap gap-1">
                      {variant.isDefault ? <StatusBadge status="info" label="Default" /> : null}
                      <StatusBadge status={variant.isActive ? 'active' : 'disabled'} />
                    </span>
                  ),
                },
              ]}
            />
          </DetailSection>

          <DetailSection
            title="Gallery"
            action={<span className="text-xs text-muted-foreground">{product.media.length}</span>}
          >
            {product.media.length === 0 ? (
              <DetailEmpty>No gallery image.</DetailEmpty>
            ) : (
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
                      className="size-20 rounded-lg border border-border bg-muted"
                      fallback={<span className="text-[10px] text-muted-foreground">—</span>}
                    />
                  </a>
                ))}
              </div>
            )}
          </DetailSection>

          <DetailSection title="Specifications">
            <DetailTable
              rows={product.specifications}
              rowKey={(spec) => spec.id}
              empty="No specification recorded."
              columns={[
                { key: 'group', header: 'Group', cell: (spec) => spec.groupName ?? '—' },
                { key: 'label', header: 'Label', cell: (spec) => spec.label },
                { key: 'value', header: 'Value', cell: (spec) => spec.value },
                {
                  key: 'key',
                  header: 'Key spec',
                  cell: (spec) => <DetailBool value={spec.isKeySpec} />,
                },
              ]}
            />
          </DetailSection>

          <DetailSection title="Description">
            <div className="space-y-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Short</p>
                {product.shortDescription ? (
                  <DetailProse>{product.shortDescription}</DetailProse>
                ) : (
                  <DetailEmpty>None.</DetailEmpty>
                )}
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Full</p>
                {product.description ? (
                  <DetailProse>{product.description}</DetailProse>
                ) : (
                  <DetailEmpty>None.</DetailEmpty>
                )}
              </div>
            </div>
          </DetailSection>

          <DetailSection title="Search engines">
            <DetailGrid>
              <DetailField label="SEO title" value={product.seoTitle} full />
              <DetailField label="SEO description" value={product.seoDescription} full />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Linked records">
            <DetailGrid>
              <DetailField
                label="Attribute values"
                value={product.attributeValueIds.length || null}
                hint="What the storefront's filters read."
              />
              <DetailField
                label="Related products"
                value={product.bundleProductIds.length || null}
                hint="Shown together on the product page."
              />
            </DetailGrid>
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}

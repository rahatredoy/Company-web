'use client';

import { StatusBadge } from '@/components/ui/status-badge';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { BrandRow } from '@/lib/types';
import {
  DetailBool,
  DetailField,
  DetailGrid,
  DetailId,
  DetailProse,
  DetailSection,
  DetailSheet,
  DetailStorefrontLink,
} from './detail-sheet';
import { LazyImage } from './lazy-image';

/**
 * One brand, whole.
 *
 * The only panel here that reads nothing from the network: `GET /brands` already
 * returns every column of the row plus its product tally, because the edit panel
 * opens from a row already on screen and a second fetch per click would only
 * make opening it wait. A view panel built on the same row opens instantly, and
 * there is nothing left to fetch — if a column existed that the list did not
 * carry, this would be a `useDetail` like the rest.
 *
 * The storefront link stays, in the footer, as one of the things you can do with
 * a brand rather than as the whole meaning of "view".
 */
export function BrandDetail({
  row,
  open,
  onOpenChange,
  storefrontBase,
}: {
  row: BrandRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storefrontBase: string | null;
}) {
  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row?.name ?? 'Brand'}
      subtitle={row?.slug}
      badge={
        row ? (
          <>
            <StatusBadge status={row.isActive ? 'active' : 'disabled'} />
            {row.isFeatured ? <StatusBadge status="info" label="Featured" /> : null}
          </>
        ) : null
      }
      footer={
        storefrontBase && row ? (
          <DetailStorefrontLink href={`${storefrontBase}/brand/${row.slug}`} />
        ) : null
      }
    >
      {row ? (
        <div className="space-y-6">
          {row.logoUrl ? (
            <DetailSection title="Logo">
              <a href={row.logoUrl} target="_blank" rel="noreferrer">
                <LazyImage
                  src={row.logoUrl}
                  alt=""
                  className="size-28 rounded-lg border border-border bg-muted"
                  fallback={<span className="text-xs text-muted-foreground">No logo</span>}
                />
              </a>
            </DetailSection>
          ) : null}

          <DetailSection title="Brand">
            <DetailGrid>
              <DetailField label="Name" value={row.name} />
              <DetailField label="Address" value={row.slug} mono />
              <DetailField label="Active" value={<DetailBool value={row.isActive} />} />
              <DetailField label="Featured" value={<DetailBool value={row.isFeatured} />} />
              <DetailField label="Order in lists" value={formatNumber(row.sortOrder)} />
              <DetailField
                label="Products"
                value={formatNumber(row.productCount)}
                hint="Filed under this brand, whatever their status."
              />
              <DetailField
                label="Website"
                value={row.websiteUrl ? <span className="break-all">{row.websiteUrl}</span> : null}
                full
              />
              <DetailField
                label="Logo"
                value={row.logoUrl ? <span className="break-all">{row.logoUrl}</span> : null}
                full
              />
              <DetailField label="Brand ID" value={<DetailId value={row.id} />} />
              <DetailField label="Created" value={formatDateTime(row.createdAt)} />
              <DetailField label="Updated" value={formatDateTime(row.updatedAt)} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Description">
            {row.description ? (
              <DetailProse>{row.description}</DetailProse>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                None.
              </p>
            )}
          </DetailSection>

          <DetailSection title="Search engines">
            <DetailGrid>
              <DetailField label="SEO title" value={row.seoTitle} full />
              <DetailField label="SEO description" value={row.seoDescription} full />
            </DetailGrid>
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}

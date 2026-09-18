'use client';

import { StatusBadge } from '@/components/ui/status-badge';
import { useT } from '@/lib/i18n';
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
  const t = useT();
  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row?.name ?? t('Brand')}
      subtitle={row?.slug}
      badge={
        row ? (
          <>
            <StatusBadge status={row.isActive ? 'active' : 'disabled'} />
            {row.isFeatured ? <StatusBadge status="info" label={t('Featured')} /> : null}
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
            <DetailSection title={t('Logo')}>
              <a href={row.logoUrl} target="_blank" rel="noreferrer">
                <LazyImage
                  src={row.logoUrl}
                  alt=""
                  className="size-28 rounded-lg border border-border bg-muted"
                  fallback={<span className="text-xs text-muted-foreground">{t('No logo')}</span>}
                />
              </a>
            </DetailSection>
          ) : null}

          <DetailSection title={t('Brand')}>
            <DetailGrid>
              <DetailField label={t('Name')} value={row.name} />
              <DetailField label={t('Address')} value={row.slug} mono />
              <DetailField label={t('Active')} value={<DetailBool value={row.isActive} />} />
              <DetailField label={t('Featured')} value={<DetailBool value={row.isFeatured} />} />
              <DetailField
                label={t('Products')}
                value={t.number(row.productCount)}
                hint={t('Filed under this brand, whatever their status.')}
              />
              <DetailField
                label={t('Logo')}
                value={row.logoUrl ? <span className="break-all">{row.logoUrl}</span> : null}
                full
              />
              <DetailField label={t('Brand ID')} value={<DetailId value={row.id} />} />
              <DetailField label={t('Created')} value={t.dateTime(row.createdAt)} />
              <DetailField label={t('Updated')} value={t.dateTime(row.updatedAt)} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title={t('Description')}>
            {row.description ? (
              <DetailProse>{row.description}</DetailProse>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                {t('None.')}
              </p>
            )}
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}

'use client';

import { StatusBadge } from '@/components/ui/status-badge';
import { formatDateTime, formatNumber } from '@/lib/format';
import type { CategoryRow } from '@/lib/types';
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
 * One category, whole — including the three pictures it can carry, which the
 * tree has room for none of.
 *
 * Like the brand panel this reads nothing from the network: the categories
 * screen loads its whole set in one go (a drag reorder renumbers the real list,
 * and a tree cannot be batched without cutting a family in half), so every
 * column is already here.
 *
 * The parent is passed in rather than looked up. Only the screen holding the
 * tree knows what a `parent_id` points at, and re-fetching a row the caller is
 * already rendering to resolve one name would be a round trip for a string.
 */
export function CategoryDetail({
  row,
  parent,
  childCount,
  open,
  onOpenChange,
  storefrontBase,
}: {
  row: CategoryRow | null;
  /** The row `parentId` names, when this category is not at the top level. */
  parent: CategoryRow | null;
  /** How many categories sit directly under this one. */
  childCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storefrontBase: string | null;
}) {
  const pictures = row
    ? ([
        ['Image', row.imageUrl],
        ['Menu icon', row.iconUrl],
        ['Banner', row.bannerUrl],
      ] as const).filter(([, url]) => Boolean(url))
    : [];

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row?.name ?? 'Category'}
      subtitle={parent ? `Under ${parent.name}` : row ? 'Top level' : undefined}
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
          <DetailStorefrontLink href={`${storefrontBase}/category/${row.slug}`} />
        ) : null
      }
    >
      {row ? (
        <div className="space-y-6">
          {pictures.length > 0 ? (
            <DetailSection title="Pictures">
              <div className="flex flex-wrap gap-3">
                {pictures.map(([label, url]) => (
                  <div key={label} className="space-y-1">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <a href={url!} target="_blank" rel="noreferrer">
                      <LazyImage
                        src={url}
                        alt=""
                        className="size-24 rounded-lg border border-border bg-muted"
                        fallback={<span className="text-[10px] text-muted-foreground">—</span>}
                      />
                    </a>
                  </div>
                ))}
              </div>
            </DetailSection>
          ) : null}

          <DetailSection title="Category">
            <DetailGrid>
              <DetailField label="Name" value={row.name} />
              <DetailField label="Address" value={row.slug} mono />
              <DetailField label="Parent" value={parent?.name} hint={parent ? undefined : 'Top level.'} />
              <DetailField label="Parent ID" value={<DetailId value={row.parentId} />} />
              <DetailField
                label="Sub-categories"
                value={formatNumber(childCount)}
                hint={childCount > 0 ? 'A category with children cannot be deleted.' : undefined}
              />
              <DetailField
                label="Products"
                value={formatNumber(row.productCount)}
                hint="Filed here directly, whatever their status."
              />
              <DetailField label="Active" value={<DetailBool value={row.isActive} />} />
              <DetailField label="Shown in the menu" value={<DetailBool value={row.showInMenu} />} />
              <DetailField label="Featured" value={<DetailBool value={row.isFeatured} />} />
              <DetailField label="Order among siblings" value={formatNumber(row.sortOrder)} />
              <DetailField label="Category ID" value={<DetailId value={row.id} />} />
              <DetailField label="Created" value={formatDateTime(row.createdAt)} />
              <DetailField label="Updated" value={formatDateTime(row.updatedAt)} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Pictures in full">
            <DetailGrid>
              <DetailField
                label="Image"
                value={row.imageUrl ? <span className="break-all">{row.imageUrl}</span> : null}
                full
              />
              <DetailField
                label="Menu icon"
                value={row.iconUrl ? <span className="break-all">{row.iconUrl}</span> : null}
                full
              />
              <DetailField
                label="Banner"
                value={row.bannerUrl ? <span className="break-all">{row.bannerUrl}</span> : null}
                full
              />
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

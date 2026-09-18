'use client';

import { StatusBadge } from '@/components/ui/status-badge';
import { useT } from '@/lib/i18n';
import type { CategoryRow } from '@/lib/types';
import {
  DetailBool,
  DetailField,
  DetailGrid,
  DetailId,
  DetailSection,
  DetailSheet,
  DetailStorefrontLink,
} from './detail-sheet';
import { LazyImage } from './lazy-image';

/**
 * One category, whole — including its picture, which the tree only has room
 * for as a thumbnail.
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
  const t = useT();
  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row?.name ?? t('Category')}
      subtitle={parent ? t('Under {name}', { name: parent.name }) : row ? t('Top level') : undefined}
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
          <DetailStorefrontLink href={`${storefrontBase}/category/${row.slug}`} />
        ) : null
      }
    >
      {row ? (
        <div className="space-y-6">
          {row.imageUrl ? (
            <DetailSection title={t('Image')}>
              <a href={row.imageUrl} target="_blank" rel="noreferrer" className="block w-fit">
                <LazyImage
                  src={row.imageUrl}
                  alt=""
                  className="size-24 rounded-lg border border-border bg-muted"
                  fallback={<span className="text-[10px] text-muted-foreground">—</span>}
                />
              </a>
            </DetailSection>
          ) : null}

          <DetailSection title={t('Category')}>
            <DetailGrid>
              <DetailField label={t('Name')} value={row.name} />
              <DetailField label={t('Address')} value={row.slug} mono />
              <DetailField label={t('Parent')} value={parent?.name} hint={parent ? undefined : t('Top level.')} />
              <DetailField label={t('Parent ID')} value={<DetailId value={row.parentId} />} />
              <DetailField
                label={t('Sub-categories')}
                value={t.number(childCount)}
                hint={childCount > 0 ? t('A category with children cannot be deleted.') : undefined}
              />
              <DetailField
                label={t('Products')}
                value={t.number(row.productCount)}
                hint={t('Filed here directly, whatever their status.')}
              />
              <DetailField label={t('Active')} value={<DetailBool value={row.isActive} />} />
              <DetailField label={t('Shown in the menu')} value={<DetailBool value={row.showInMenu} />} />
              <DetailField label={t('Featured')} value={<DetailBool value={row.isFeatured} />} />
              <DetailField label={t('Order among siblings')} value={t.number(row.sortOrder)} />
              <DetailField label={t('Category ID')} value={<DetailId value={row.id} />} />
              <DetailField label={t('Created')} value={t.dateTime(row.createdAt)} />
              <DetailField label={t('Updated')} value={t.dateTime(row.updatedAt)} />
              <DetailField
                label={t('Image address')}
                value={row.imageUrl ? <span className="break-all">{row.imageUrl}</span> : null}
                full
              />
            </DetailGrid>
          </DetailSection>

          <DetailSection title={t('Search engines')}>
            <DetailGrid>
              <DetailField label={t('SEO title')} value={row.seoTitle} full />
              <DetailField label={t('SEO description')} value={row.seoDescription} full />
            </DetailGrid>
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}

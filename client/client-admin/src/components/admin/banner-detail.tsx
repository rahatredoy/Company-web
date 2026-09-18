'use client';

import * as React from 'react';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDetail } from '@/hooks/use-detail';
import { useT, type MessageKey } from '@/lib/i18n';
import type { BannerRow, BannerView } from '@/lib/types';
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

/** The placement, in the words `titleCase` used to make of the enum. */
const POSITION_LABEL: Record<BannerRow['position'], MessageKey> = {
  home_hero: 'Home Hero',
  home_promo: 'Home Promo',
  category_top: 'Category Top',
  sidebar: 'Sidebar',
  popup: 'Popup',
};

/**
 * Whether a banner's window has opened or closed yet.
 *
 * Its own component so the clock can be read in a `useState` initializer, which
 * runs once on mount rather than on every render — a component that calls
 * `Date.now()` while rendering is not idempotent, and two badges derived from a
 * value that changes under them is exactly the hazard that rule is about.
 *
 * Mount is the right moment because the sheet's contents are unmounted while it
 * is shut, so this reads the clock afresh on each open and never again while the
 * panel is up. That is right for a schedule measured in days and would be wrong
 * for anything that has to tick.
 */
function ScheduleBadges({ startsAt, endsAt }: { startsAt: string | null; endsAt: string | null }) {
  const t = useT();
  const [now] = React.useState(() => Date.now());

  if (startsAt && new Date(startsAt).getTime() > now) {
    return <StatusBadge status="queued" label={t('Not started')} />;
  }
  if (endsAt && new Date(endsAt).getTime() < now) {
    return <StatusBadge status="expired" label={t('Finished')} />;
  }
  return null;
}

/**
 * One banner, with both artworks shown at the size the record is worth reading
 * at rather than the thumbnail the list has room for.
 *
 * `mobileImageUrl` is the field this panel exists for: it is optional, it is
 * invisible on a desktop preview, and a banner whose desktop artwork is fine and
 * whose phone artwork is missing looks correct in every other screen in the
 * panel.
 */
export function BannerDetail({
  row,
  open,
  onOpenChange,
  storefrontBase,
}: {
  row: BannerRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storefrontBase: string | null;
}) {
  const t = useT();
  const detail = useDetail<BannerView>({
    path: '/api/v1/admin/banners',
    id: row?.id ?? null,
    enabled: open,
  });

  const banner = detail.data;

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={banner?.title ?? row?.title ?? t('Banner')}
      subtitle={
        banner ? t(POSITION_LABEL[banner.position]) : row ? t(POSITION_LABEL[row.position]) : undefined
      }
      badge={
        banner ? (
          <>
            <StatusBadge status={banner.isActive ? 'active' : 'disabled'} />
            <ScheduleBadges startsAt={banner.startsAt} endsAt={banner.endsAt} />
          </>
        ) : null
      }
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
      footer={storefrontBase ? <DetailStorefrontLink href={storefrontBase} label={t('Open the shop')} /> : null}
    >
      {banner ? (
        <div className="space-y-6">
          <DetailSection title={t('Artwork')}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('Desktop')}</p>
                <a href={banner.imageUrl} target="_blank" rel="noreferrer">
                  <LazyImage
                    src={banner.imageUrl}
                    alt=""
                    className="h-32 w-full rounded-lg border border-border bg-muted"
                    fallback={<span className="text-xs text-muted-foreground">{t('No image')}</span>}
                  />
                </a>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">{t('Phone')}</p>
                {banner.mobileImageUrl ? (
                  <a href={banner.mobileImageUrl} target="_blank" rel="noreferrer">
                    <LazyImage
                      src={banner.mobileImageUrl}
                      alt=""
                      className="h-32 w-full rounded-lg border border-border bg-muted"
                      fallback={<span className="text-xs text-muted-foreground">{t('No image')}</span>}
                    />
                  </a>
                ) : (
                  <div className="grid h-32 w-full place-items-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                    {t('The desktop artwork is used')}
                  </div>
                )}
              </div>
            </div>
          </DetailSection>

          <DetailSection title={t('Content')}>
            <DetailGrid>
              <DetailField label={t('Title')} value={banner.title} />
              <DetailField label={t('Subtitle')} value={banner.subtitle} />
              <DetailField label={t('Button')} value={banner.buttonLabel} />
              {/* Where it actually goes, which is the category when one is
                  chosen — `resolveBanners` resolves it to `/category/<slug>`
                  and it outranks the typed address. Both are shown rather than
                  only the winner, because a banner carrying a stale path is
                  worth seeing before it becomes the destination again. */}
              <DetailField
                label={t('Opens')}
                value={
                  banner.categorySlug ? (
                    <span className="break-all">
                      {banner.categoryName} <span className="text-muted-foreground">/category/{banner.categorySlug}</span>
                    </span>
                  ) : banner.linkUrl ? (
                    <span className="break-all">{banner.linkUrl}</span>
                  ) : null
                }
                hint={banner.categorySlug || banner.linkUrl ? undefined : t('Not clickable.')}
                full
              />
              <DetailField
                label={t('Typed address')}
                value={banner.linkUrl ? <span className="break-all">{banner.linkUrl}</span> : null}
                hint={
                  banner.categorySlug && banner.linkUrl
                    ? t('Kept, but the category above is what it opens.')
                    : undefined
                }
                full
              />
              <DetailField
                label={t('Desktop image')}
                value={<span className="break-all">{banner.imageUrl}</span>}
                full
              />
              <DetailField
                label={t('Phone image')}
                value={banner.mobileImageUrl ? <span className="break-all">{banner.mobileImageUrl}</span> : null}
                full
              />
            </DetailGrid>
          </DetailSection>

          <DetailSection title={t('Where and when')}>
            <DetailGrid>
              <DetailField label={t('Position')} value={t(POSITION_LABEL[banner.position])} />
              <DetailField
                label={t('Category')}
                value={banner.categoryName}
                hint={banner.categoryName ? t('Where clicking it goes.') : t('It opens no category.')}
              />
              <DetailField label={t('Category ID')} value={<DetailId value={banner.categoryId} />} />
              <DetailField label={t('Order in its slot')} value={t.number(banner.sortOrder)} />
              <DetailField label={t('Active')} value={<DetailBool value={banner.isActive} />} />
              <DetailField
                label={t('Starts')}
                value={t.dateTime(banner.startsAt)}
                hint={banner.startsAt ? undefined : t('Live as soon as it is active.')}
              />
              <DetailField
                label={t('Ends')}
                value={t.dateTime(banner.endsAt)}
                hint={banner.endsAt ? undefined : t('Runs until it is switched off.')}
              />
              <DetailField label={t('Banner ID')} value={<DetailId value={banner.id} />} />
              <DetailField label={t('Created')} value={t.dateTime(banner.createdAt)} />
              <DetailField label={t('Updated')} value={t.dateTime(banner.updatedAt)} />
            </DetailGrid>
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}

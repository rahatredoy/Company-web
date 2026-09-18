'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useDetail } from '@/hooks/use-detail';
import { useT, type MessageKey } from '@/lib/i18n';
import type { PageDetail as PageDetailPayload, PageRow } from '@/lib/types';
import {
  DetailBool,
  DetailEmpty,
  DetailField,
  DetailGrid,
  DetailId,
  DetailSection,
  DetailSheet,
  DetailStorefrontLink,
} from './detail-sheet';

const STATUS_LABELS: Record<PageRow['status'], MessageKey> = {
  draft: 'Draft',
  published: 'Published',
};

/**
 * One CMS page.
 *
 * `body_html` is the field this exists for. It is **sanitised on write** by
 * `client-api/src/lib/sanitise.ts` and the storefront renders it as HTML
 * trusting exactly that, so what is stored is the only honest answer to "what
 * will the shop actually show" — and the list, which has room for a title and a
 * slug, could not say. It is rendered here as source rather than as markup:
 * this is a panel for reading the record, and a panel that executed the record's
 * HTML would be showing something other than what it holds.
 *
 * `systemKey` is the other one worth surfacing. A policy page cannot be deleted
 * — the footer and the checkout copy link to it — and the list shows that as a
 * badge without saying which key it is.
 */
export function PageDetail({
  row,
  open,
  onOpenChange,
  storefrontBase,
}: {
  row: PageRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storefrontBase: string | null;
}) {
  const t = useT();
  const detail = useDetail<PageDetailPayload>({
    path: '/api/v1/admin/website/pages',
    id: row?.id ?? null,
    enabled: open,
  });

  const page = detail.data;

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={page?.title ?? row?.title ?? t('Page')}
      subtitle={page ? `/page/${page.slug}` : row ? `/page/${row.slug}` : undefined}
      badge={
        <>
          <StatusBadge
            status={page?.status ?? row?.status ?? 'draft'}
            label={t(STATUS_LABELS[page?.status ?? row?.status ?? 'draft'])}
          />
          {(page?.systemKey ?? row?.systemKey) ? <StatusBadge status="info" label={t('Policy')} /> : null}
        </>
      }
      loading={detail.loading}
      error={detail.error}
      onRetry={detail.reload}
      footer={
        row ? (
          <>
            {storefrontBase && (page?.status ?? row.status) === 'published' ? (
              <DetailStorefrontLink
                href={`${storefrontBase}/page/${page?.slug ?? row.slug}`}
                label={t('Open on the shop')}
              />
            ) : null}
            <Button asChild variant="outline" size="sm">
              <Link href={`/website/pages/${row.id}`}>{t('Open the editor')}</Link>
            </Button>
          </>
        ) : null
      }
    >
      {page ? (
        <div className="space-y-6">
          <DetailSection title={t('Page')}>
            <DetailGrid>
              <DetailField label={t('Title')} value={page.title} />
              <DetailField label={t('Address')} value={`/page/${page.slug}`} mono />
              <DetailField
                label={t('Status')}
                value={<StatusBadge status={page.status} label={t(STATUS_LABELS[page.status])} />}
              />
              <DetailField label={t('Shown in the footer')} value={<DetailBool value={page.showInFooter} />} />
              <DetailField label={t('Order in the footer')} value={t.number(page.sortOrder)} />
              <DetailField
                label={t('System key')}
                value={page.systemKey}
                mono
                hint={page.systemKey ? t('A policy page. It cannot be deleted.') : undefined}
              />
              <DetailField label={t('Page ID')} value={<DetailId value={page.id} />} />
              <DetailField label={t('Updated')} value={t.dateTime(page.updatedAt)} />
            </DetailGrid>
          </DetailSection>

          <DetailSection title={t('Excerpt')}>
            {page.excerpt ? (
              <p className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm whitespace-pre-wrap">
                {page.excerpt}
              </p>
            ) : (
              <DetailEmpty>{t('None.')}</DetailEmpty>
            )}
          </DetailSection>

          <DetailSection
            title={t('Body')}
            description={t('Sanitised when it was saved. Shown as source, because that is what is stored.')}
          >
            {page.bodyHtml ? (
              <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-muted/30 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                {page.bodyHtml}
              </pre>
            ) : (
              <DetailEmpty>{t('This page has no body.')}</DetailEmpty>
            )}
          </DetailSection>

          <DetailSection title={t('Search engines')}>
            <DetailGrid>
              <DetailField label={t('SEO title')} value={page.seoTitle} full />
              <DetailField label={t('SEO description')} value={page.seoDescription} full />
            </DetailGrid>
          </DetailSection>
        </div>
      ) : null}
    </DetailSheet>
  );
}

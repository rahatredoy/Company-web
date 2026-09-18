import type { Metadata } from 'next';
import Link from 'next/link';
import { FileText, Plus } from 'lucide-react';
import type { PageRow, SessionResponse } from '@/lib/types';
import { can } from '@/lib/types';
import { currentStoreSlug, serverGet, serverGetListed } from '@/lib/server-api';
import { storefrontUrl } from '@/lib/env';
import { BATCH_SIZE } from '@/lib/list';
import { EmptyState } from '@/components/admin/empty-state';
import { PageHeader } from '@/components/admin/page-header';
import { PageList } from '@/components/admin/page-list';
import { TableFilters } from '@/components/admin/table-filters';
import { Button } from '@/components/ui/button';
import type { MessageKey } from '@/lib/i18n';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Pages') };
}

export const dynamic = 'force-dynamic';

const STATUS_OPTIONS: { value: string; label: MessageKey }[] = [
  { value: 'all', label: 'All pages' },
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Drafts' },
];

export default async function PagesListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getT();
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const session = await serverGet<SessionResponse>('/api/v1/admin/auth/session');
  const canManage = session.authenticated && can(session.admin, 'website.manage');

  // One object, so the first batch here and every batch the browser asks for
  // afterwards read the same filtered list. No cursor on this one, which is what
  // makes the API count it.
  const query = { search: single('search'), status: single('status') };
  const [slug, first] = await Promise.all([
    // For the view panel's link out to the published page.
    currentStoreSlug(),
    serverGetListed<PageRow>('/api/v1/admin/website/pages', { ...query, pageSize: BATCH_SIZE }),
  ]);

  const filtered = Boolean(single('search') || (single('status') && single('status') !== 'all'));

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Pages')}
        description={t('Your About, Contact and policy pages — the copy your storefront links to.')}
        actions={
          canManage ? (
            <Button asChild size="sm">
              <Link href="/website/pages/new">
                <Plus aria-hidden /> {t('New page')}
              </Link>
            </Button>
          ) : null
        }
      />

      <TableFilters
        searchPlaceholder={t('Page title')}
        statusOptions={STATUS_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))}
      />

      {first.data.length === 0 && !filtered ? (
        <EmptyState
          icon={FileText}
          title={t('No pages yet')}
          description={t('Add one to link it from your footer.')}
        />
      ) : (
        <PageList
          initial={{ rows: first.data, meta: first.meta }}
          query={query}
          filtered={filtered}
          storefrontBase={slug ? storefrontUrl(slug) : null}
        />
      )}
    </div>
  );
}

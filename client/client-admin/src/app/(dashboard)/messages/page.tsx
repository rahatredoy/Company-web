import type { Metadata } from 'next';
import { MessageSquareText } from 'lucide-react';
import type { ContactMessageRow } from '@/lib/types';
import { serverGetListed } from '@/lib/server-api';
import { BATCH_SIZE } from '@/lib/list';
import { EmptyState } from '@/components/admin/empty-state';
import { MessageList } from '@/components/admin/message-list';
import { PageHeader } from '@/components/admin/page-header';
import type { MessageKey } from '@/lib/i18n';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Messages') };
}

export const dynamic = 'force-dynamic';

const STATUS_OPTIONS: { value: string; label: MessageKey }[] = [
  { value: 'all', label: 'All messages' },
  { value: 'new', label: 'New' },
  { value: 'read', label: 'Read::message' },
  { value: 'replied', label: 'Replied' },
  { value: 'archived', label: 'Archived' },
];

/**
 * What shoppers sent through the storefront's contact form.
 *
 * Read-only, deliberately: replying happens in the owner's own email, where the
 * thread already lives and where the customer will look for the answer. A reply
 * box here would create a second, worse inbox that nobody checks — and the
 * customer's mail client would still be the place the conversation continued.
 */
export default async function MessagesPage({
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

  // One object, so the first batch here and every batch the browser asks for
  // afterwards read the same filtered list. No cursor on this one, which is what
  // makes the API count it.
  const query = { status: single('status') };
  const first = await serverGetListed<ContactMessageRow>('/api/v1/admin/contact-messages', {
    ...query,
    pageSize: BATCH_SIZE,
  });

  const current = single('status') ?? 'all';
  const filtered = current !== 'all';

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Messages')}
        description={t('Sent through the contact form on your storefront. Reply from your own email.')}
      />

      {/* Links rather than the shared filter bar: this list has no search
          behind it, and a box that does nothing is worse than no box. */}
      <div className="scroll-x flex w-fit items-center gap-1 rounded-lg border bg-card p-1">
        {STATUS_OPTIONS.map((option) => (
          <a
            key={option.value}
            href={option.value === 'all' ? '/messages' : `/messages?status=${option.value}`}
            aria-current={current === option.value ? 'page' : undefined}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
              current === option.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(option.label)}
          </a>
        ))}
      </div>

      {first.data.length === 0 && !filtered ? (
        <EmptyState
          icon={MessageSquareText}
          title={t('No messages yet')}
          description={t('Anything sent through your storefront’s contact form lands here.')}
        />
      ) : (
        <MessageList initial={{ rows: first.data, meta: first.meta }} query={query} filtered={filtered} />
      )}
    </div>
  );
}

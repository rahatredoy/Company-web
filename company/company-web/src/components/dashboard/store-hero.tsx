import { CheckCircle2, Store as StoreIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge, StatusDot } from '@/components/ui/status-badge';
import { CopyButton } from './copy-button';
import { StorefrontIllustration } from './store-illustrations';
import { formatDateTime } from '@/lib/format';
import type { StoreView } from '@/lib/types';

/** "en" → "English (en)". The code stays: it is what the API and the panel use. */
function languageLabel(code: string): string {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code);
    return name && name.toLowerCase() !== code.toLowerCase() ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-sm font-medium">{value}</dd>
    </div>
  );
}

/**
 * The store, at a glance: what it is called, whether it is up, and the settings
 * it was created with.
 *
 * Currency, language and timezone are shown but not editable here — they belong
 * to the owner's own admin panel, and this page is the SaaS account's view of
 * the store rather than a second place to configure it.
 */
export function StoreHero({ store }: { store: StoreView }) {
  const ready = store.storeStatus === 'ready';

  return (
    <Card>
      <CardContent className="flex flex-col gap-6 p-5 sm:p-6 xl:flex-row xl:items-center xl:gap-8">
        <div className="flex min-w-0 flex-1 flex-col gap-5 sm:flex-row sm:gap-6">
          <span className="grid size-20 shrink-0 place-items-center rounded-2xl bg-primary-soft text-primary sm:size-26">
            <StoreIcon className="size-8 sm:size-10" aria-hidden />
          </span>

          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-bold tracking-tight">{store.storeName}</h2>
              {ready ? (
                <Badge variant="success">
                  <CheckCircle2 className="size-3.5" aria-hidden /> Ready
                </Badge>
              ) : (
                <StatusBadge status={store.storeStatus} />
              )}
            </div>

            <dl className="grid gap-x-10 gap-y-3 sm:grid-cols-2">
              <div className="space-y-3">
                <Detail
                  label="Tenant ID"
                  value={
                    <span className="inline-flex items-center gap-1">
                      <span className="font-mono text-[12px]">{store.tenantId}</span>
                      <CopyButton value={store.tenantId} label="" />
                    </span>
                  }
                />
                <Detail label="Store status" value={<StatusDot status={store.storeStatus} />} />
                <Detail label="Tenant status" value={<StatusDot status={store.status} />} />
                <Detail label="Created at" value={formatDateTime(store.createdAt)} />
              </div>

              <div className="space-y-3 sm:border-l sm:border-border sm:pl-10">
                <Detail label="Currency" value={store.currency} />
                <Detail label="Language" value={languageLabel(store.language)} />
                <Detail label="Timezone" value={store.timezone} />
              </div>
            </dl>
          </div>
        </div>

        <div className="grid shrink-0 place-items-center rounded-2xl bg-success-soft px-4 py-2 xl:w-[380px]">
          <StorefrontIllustration className="max-w-[340px]" />
        </div>
      </CardContent>
    </Card>
  );
}

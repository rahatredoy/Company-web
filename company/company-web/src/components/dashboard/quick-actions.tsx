import Link from 'next/link';
import {
  CreditCard,
  ExternalLink,
  FileText,
  Globe,
  LifeBuoy,
  Settings2,
  Store,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { StoreView } from '@/lib/types';

interface Action {
  key: string;
  label: string;
  icon: LucideIcon;
  href: string;
  external?: boolean;
}

/**
 * `View store` and `Open admin` follow whatever address is actually live: a
 * verified custom domain if there is one, the platform address otherwise. That
 * choice is made by the API in `storeView`, so both places always agree.
 */
export function QuickActions({ store }: { store: StoreView | null }) {
  const ready = store?.storeStatus === 'ready';

  const actions: Action[] = [
    ...(ready
      ? ([
          { key: 'store', label: 'View store', icon: Store, href: store!.storefrontUrl, external: true },
          { key: 'admin', label: 'Open store admin', icon: Settings2, href: store!.adminUrl, external: true },
        ] satisfies Action[])
      : []),
    { key: 'plan', label: 'Manage plan', icon: CreditCard, href: '/dashboard/plans' },
    { key: 'domain', label: 'Custom domain', icon: Globe, href: '/dashboard/store' },
    { key: 'invoices', label: 'View invoices', icon: FileText, href: '/dashboard/invoices' },
    { key: 'support', label: 'Contact support', icon: LifeBuoy, href: '/dashboard/support' },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick actions</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {actions.map((action) => {
            const inner = (
              <>
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-soft text-accent-foreground">
                  <action.icon className="size-4.5" aria-hidden />
                </span>
                <span className="flex-1 text-sm font-medium">{action.label}</span>
                {action.external ? (
                  <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                ) : null}
              </>
            );

            const className =
              'flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30';

            return (
              <li key={action.key}>
                {action.external ? (
                  <a href={action.href} target="_blank" rel="noreferrer noopener" className={className}>
                    {inner}
                  </a>
                ) : (
                  <Link href={action.href} className={className}>
                    {inner}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

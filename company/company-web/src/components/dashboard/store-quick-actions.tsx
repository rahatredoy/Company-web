import Link from 'next/link';
import {
  CreditCard,
  ExternalLink,
  Globe,
  Headphones,
  LifeBuoy,
  Pencil,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { StoreView } from '@/lib/types';

const ROW =
  'flex items-center justify-between gap-3 px-4 py-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none';

interface Action {
  key: string;
  label: string;
  icon: LucideIcon;
  href: string;
  external?: boolean;
}

/**
 * The five things people come to this page to do, as a list rather than a grid:
 * they are one-line commands, and a tile each would make five short labels look
 * like a dashboard of their own.
 *
 * The two links out follow whatever address is actually live — the API picks a
 * verified custom domain over the platform one in `storeView`, so this and the
 * Addresses card can never disagree. They are dropped while the store is not
 * ready, because a link into an offline store is worse than no link.
 */
export function StoreQuickActions({ store }: { store: StoreView }) {
  const ready = store.storeStatus === 'ready';

  const actions: Action[] = [
    ...(ready
      ? ([
          { key: 'store', label: 'Visit my store', icon: ExternalLink, href: store.storefrontUrl, external: true },
          { key: 'admin', label: 'Go to admin panel', icon: ExternalLink, href: store.adminUrl, external: true },
        ] satisfies Action[])
      : []),
    { key: 'details', label: 'Edit store details', icon: Pencil, href: '/dashboard/settings' },
    { key: 'domains', label: 'Manage domains', icon: Globe, href: '#addresses' },
    { key: 'billing', label: 'View billing', icon: CreditCard, href: '/dashboard/billing' },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick actions</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {actions.map((action) => (
            <li key={action.key}>
              {action.external ? (
                <a href={action.href} target="_blank" rel="noreferrer noopener" className={ROW}>
                  {action.label}
                  <action.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </a>
              ) : (
                <Link href={action.href} className={ROW}>
                  {action.label}
                  <action.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** The way out of every state this page can be in. */
export function StoreHelpCard() {
  return (
    <Card className="border-transparent bg-primary-soft">
      <CardContent className="space-y-3 p-5">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-card text-primary">
            <LifeBuoy className="size-4.5" aria-hidden />
          </span>
          <p className="text-sm font-semibold">Need help?</p>
        </div>

        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Our support team is here to help you at every step.
        </p>

        <Button asChild variant="outline" className="w-full bg-card">
          <Link href="/dashboard/support">
            <Headphones /> Contact Support
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

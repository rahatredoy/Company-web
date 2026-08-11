import {
  ExternalLink,
  Globe,
  MonitorCog,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CopyButton } from './copy-button';
import { DomainConnect } from './domain-connect';
import { cn } from '@/lib/utils';
import type { DomainView, StoreView } from '@/lib/types';

/** "https://admin.abc-fashion.company.com/" → "admin.abc-fashion.company.com" */
function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function Panel({
  icon: Icon,
  tint,
  title,
  subtitle,
  online,
  children,
}: {
  icon: LucideIcon;
  tint: string;
  title: string;
  subtitle: string;
  online: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4 p-5">
      <div className="flex items-center gap-2.5">
        <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', tint)}>
          <Icon className="size-4" aria-hidden />
        </span>
        <h4 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {title} <span className="font-normal text-muted-foreground">({subtitle})</span>
        </h4>
        <Badge variant={online ? 'success' : 'neutral'}>{online ? 'Active' : 'Offline'}</Badge>
      </div>

      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

/** A platform address: reachable, never removable, so only worth copying. */
function PlatformRow({ label, host }: { label: string; host: string }) {
  return (
    <Row label={label}>
      <div className="flex items-center justify-between gap-2">
        <a
          href={`https://${host}`}
          target="_blank"
          rel="noreferrer noopener"
          className="min-w-0 truncate text-sm font-medium text-primary hover:underline"
        >
          {host}
        </a>
        <CopyButton value={host} label="" className="shrink-0" />
      </div>
    </Row>
  );
}

/** The address that is actually live — a verified custom domain, or the free one. */
function LiveRow({ label, url, openLabel }: { label: string; url: string; openLabel: string }) {
  return (
    <Row label={label}>
      <div className="flex items-center justify-between gap-2">
        <a
          href={url}
          target="_blank"
          rel="noreferrer noopener"
          className="min-w-0 truncate text-sm font-medium text-primary hover:underline"
        >
          {url}
        </a>
        <Button asChild variant="ghost" size="icon-sm" aria-label={openLabel} className="shrink-0">
          <a href={url} target="_blank" rel="noreferrer noopener">
            <ExternalLink />
          </a>
        </Button>
      </div>
    </Row>
  );
}

/**
 * Both doors into the store, side by side: the storefront customers shop at and
 * the panel its owner manages it from.
 *
 * Each side lists the free platform address, the owner's own domain if there is
 * one, and the address the store actually answers on today — which is the custom
 * domain only once DNS has proved it. Connecting, checking and removing a domain
 * all happen inline, because a domain that is added and never verified is a
 * store that quietly does not load at the address its owner just paid for.
 */
export function StoreAddresses({
  store,
  storefrontDomain,
  adminDomain,
  customDomainAllowed,
  customAdminDomainAllowed,
}: {
  store: StoreView;
  storefrontDomain: DomainView | null;
  adminDomain: DomainView | null;
  customDomainAllowed: boolean;
  customAdminDomainAllowed: boolean;
}) {
  const online = store.storeStatus === 'ready';
  const adminHost = hostOf(store.adminUrl);
  const adminLiveUrl = adminDomain?.verified ? `https://${adminDomain.domain}` : store.adminUrl;

  const connected = [storefrontDomain, adminDomain].filter(Boolean) as DomainView[];
  const allVerified = connected.length > 0 && connected.every((domain) => domain.verified);
  const waiting = connected.filter((domain) => !domain.verified);

  const notice = allVerified
    ? {
        icon: ShieldCheck,
        className: 'border-success/25 bg-success-soft',
        iconClassName: 'text-success',
        text: `Your custom domain${connected.length > 1 ? 's are' : ' is'} connected and verified.`,
      }
    : waiting.length > 0
      ? {
          icon: ShieldAlert,
          className: 'border-warning/25 bg-warning-soft',
          iconClassName: 'text-warning',
          text: `Add the DNS records for ${waiting.map((domain) => domain.domain).join(' and ')}, then check them — your store answers on the platform address until they pass.`,
        }
      : {
          icon: ShieldQuestion,
          className: 'border-border bg-muted/40',
          iconClassName: 'text-muted-foreground',
          text: 'Your store is live on its free platform addresses. Connect your own domain whenever you are ready.',
        };

  return (
    <Card id="addresses" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Addresses</CardTitle>
        <CardDescription>Your storefront and admin panel addresses</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid divide-y divide-border overflow-hidden rounded-xl border border-border md:grid-cols-2 md:divide-x md:divide-y-0">
          <Panel
            icon={Globe}
            tint="bg-success-soft text-success"
            title="Storefront"
            subtitle="Customer-facing"
            online={online}
          >
            <PlatformRow label="Platform subdomain" host={store.platformSubdomain} />
            <Row label="Custom storefront domain">
              <DomainConnect
                domain={storefrontDomain}
                domainType="storefront_custom"
                allowed={customDomainAllowed}
              />
            </Row>
            <LiveRow label="Storefront URL" url={store.storefrontUrl} openLabel="Open storefront" />
          </Panel>

          <Panel
            icon={MonitorCog}
            tint="bg-info-soft text-info"
            title="Admin Panel"
            subtitle="Management"
            online={online}
          >
            <PlatformRow label="Platform admin domain" host={adminHost} />
            <Row label="Custom admin domain">
              <DomainConnect
                domain={adminDomain}
                domainType="admin_custom"
                allowed={customAdminDomainAllowed}
              />
            </Row>
            <LiveRow label="Admin panel URL" url={adminLiveUrl} openLabel="Open admin panel" />
          </Panel>
        </div>

        <div
          className={cn(
            'flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm text-muted-foreground',
            notice.className,
          )}
        >
          <notice.icon className={cn('size-4 shrink-0', notice.iconClassName)} aria-hidden />
          {notice.text}
        </div>
      </CardContent>
    </Card>
  );
}

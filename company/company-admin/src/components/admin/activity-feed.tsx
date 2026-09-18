import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  Globe,
  LifeBuoy,
  Server,
  ServerCrash,
  Timer,
  TimerOff,
  UserPlus,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ActivityItem } from '@/lib/types';

export const ACTIVITY_ICONS: Record<ActivityItem['type'], { icon: LucideIcon; tint: string }> = {
  client_registered: { icon: UserPlus, tint: 'bg-primary-soft text-accent-foreground' },
  trial_started: { icon: Timer, tint: 'bg-warning-soft text-warning' },
  trial_expiring: { icon: Timer, tint: 'bg-destructive-soft text-destructive' },
  trial_expired: { icon: TimerOff, tint: 'bg-destructive-soft text-destructive' },
  payment_received: { icon: Wallet, tint: 'bg-success-soft text-success' },
  payment_failed: { icon: AlertTriangle, tint: 'bg-destructive-soft text-destructive' },
  subscription_activated: { icon: CheckCircle2, tint: 'bg-success-soft text-success' },
  subscription_cancelled: { icon: Ban, tint: 'bg-destructive-soft text-destructive' },
  store_provisioned: { icon: Server, tint: 'bg-info-soft text-info' },
  provisioning_failed: { icon: ServerCrash, tint: 'bg-destructive-soft text-destructive' },
  domain_connected: { icon: Globe, tint: 'bg-info-soft text-info' },
  support_ticket_opened: { icon: LifeBuoy, tint: 'bg-info-soft text-info' },
};

const ICONS = ACTIVITY_ICONS;

export function ActivityFeed({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return <p className="py-10 text-center text-sm text-muted-foreground">No activity in this period.</p>;
  }

  return (
    <div className="space-y-1">
      <ul className="space-y-1">
        {items.map((item) => {
          const config = ICONS[item.type] ?? ICONS.client_registered;
          const Icon = config.icon;
          return (
            <li key={item.id} className="flex items-center gap-3 rounded-lg px-1 py-2.5">
              <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', config.tint)}>
                <Icon className="size-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.title}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="max-w-36 truncate text-sm text-muted-foreground">{item.subject}</p>
                <p className="text-[10.5px] text-muted-foreground/70">{formatRelative(item.createdAt)}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <Link
        href="/audit-logs"
        className="inline-flex items-center gap-1.5 px-1 pt-2 text-sm font-medium text-primary hover:underline"
      >
        View all activity <ArrowRight className="size-3.5" />
      </Link>
    </div>
  );
}

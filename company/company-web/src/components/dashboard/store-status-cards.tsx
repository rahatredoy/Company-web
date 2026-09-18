import Link from 'next/link';
import {
  ArrowRight,
  Check,
  ExternalLink,
  FileText,
  Globe,
  Home,
  MonitorSmartphone,
  Store,
  type LucideIcon,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { OnboardingState, StoreView } from '@/lib/types';

interface PieceProps {
  icon: LucideIcon;
  tint: string;
  title: string;
  description: string;
  status: 'Not created' | 'Pending' | 'Ready';
  placeholderIcon: LucideIcon;
  placeholder: string;
  action: { label: string; href: string | null };
}

function Piece({
  icon: Icon,
  tint,
  title,
  description,
  status,
  placeholderIcon: Placeholder,
  placeholder,
  action,
}: PieceProps) {
  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-5 p-6">
        <div className="flex items-start justify-between gap-3">
          <span className={cn('grid size-11 place-items-center rounded-xl', tint)}>
            <Icon className="size-5.5" aria-hidden />
          </span>
          <Badge variant={status === 'Ready' ? 'success' : status === 'Pending' ? 'warning' : 'neutral'}>
            {status}
          </Badge>
        </div>

        <div className="space-y-1.5">
          <h3 className="text-[14px] font-semibold">{title}</h3>
          <p className="text-[12px] leading-relaxed text-muted-foreground">{description}</p>
        </div>

        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border px-3 py-8 text-center">
          <span className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Placeholder className="size-4 shrink-0" aria-hidden />
            {placeholder}
          </span>
        </div>

        {action.href ? (
          <Button asChild variant="outline" className="w-full">
            <a href={action.href} target="_blank" rel="noreferrer noopener">
              {action.label} <ExternalLink />
            </a>
          </Button>
        ) : (
          <Button variant="outline" className="w-full" disabled>
            {action.label} <ExternalLink />
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The pieces setup builds, and how far along each one is.
 *
 * Every status here is read from what actually exists rather than from a step
 * counter, so a half-finished setup shows exactly which half is finished. The
 * actions stay disabled until there is something behind them — a button that
 * opens nothing is worse than no button.
 *
 * The dedicated database no longer has a card of its own: it is not something the
 * owner creates, previews or configures, and a card put our plumbing on the same
 * footing as their storefront. Provisioning still reports it step by step.
 */
export function StoreStatusCards({
  signup,
  store,
}: {
  signup: OnboardingState | null;
  store: StoreView | null;
}) {
  const websiteDone = signup?.website?.configured ?? false;
  const adminDone = signup?.adminPanel?.configured ?? false;
  const verified = signup?.adminPanel?.verified ?? false;
  const ready = store?.storeStatus === 'ready';

  const tasks = [
    { label: 'Set up your website', done: websiteDone },
    { label: 'Configure admin panel', done: adminDone },
    { label: 'Verify your admin login', done: verified },
    { label: 'Launch your store', done: ready },
  ];
  const completed = tasks.filter((task) => task.done).length;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Piece
        icon={Home}
        tint="bg-success-soft text-success"
        title="Storefront Website"
        description="Your customer-facing website will appear here."
        status={ready ? 'Ready' : websiteDone ? 'Pending' : 'Not created'}
        placeholderIcon={Globe}
        placeholder={websiteDone ? (signup?.website?.slug ?? 'Address chosen') : 'No website yet'}
        action={{ label: 'Preview Store', href: ready ? (store?.storefrontUrl ?? null) : null }}
      />

      <Piece
        icon={Store}
        tint="bg-info-soft text-info"
        title="Admin Panel"
        description="Manage products, orders, customers and more."
        status={ready ? 'Ready' : adminDone ? 'Pending' : 'Not created'}
        placeholderIcon={MonitorSmartphone}
        placeholder={adminDone ? (signup?.adminPanel?.adminEmail ?? 'Login chosen') : 'No admin panel yet'}
        action={{ label: 'Preview Admin', href: ready ? (store?.adminUrl ?? null) : null }}
      />

      <Card className="flex flex-col">
        <CardContent className="flex flex-1 flex-col gap-5 p-6">
          <div className="flex items-start justify-between gap-3">
            <span className="grid size-11 place-items-center rounded-xl bg-warning-soft text-warning">
              <FileText className="size-5.5" aria-hidden />
            </span>
            <Badge variant={completed === tasks.length ? 'success' : 'neutral'}>
              {completed} of {tasks.length} completed
            </Badge>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-[14px] font-semibold">Getting Started</h3>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Follow these steps to launch your store.
            </p>
          </div>

          <ul className="flex-1 space-y-3">
            {tasks.map((task) => (
              <li key={task.label} className="flex items-center gap-2.5 text-[12px]">
                <span
                  className={cn(
                    'grid size-4.5 shrink-0 place-items-center rounded-full border',
                    task.done ? 'border-success bg-success text-success-foreground' : 'border-border-strong',
                  )}
                >
                  {task.done ? <Check className="size-2.5" strokeWidth={3} aria-hidden /> : null}
                </span>
                <span className={task.done ? 'text-muted-foreground line-through' : undefined}>
                  {task.label}
                </span>
              </li>
            ))}
          </ul>

          <Button
            asChild
            variant="outline"
            className="w-full border-warning/40 text-warning hover:border-warning/60 hover:bg-warning-soft"
          >
            <Link href="/dashboard">
              View All Steps <ArrowRight />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

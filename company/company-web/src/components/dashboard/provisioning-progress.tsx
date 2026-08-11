'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { StoreView } from '@/lib/types';

const FALLBACK_STEPS = [
  { step: 'tenant_record', label: 'Tenant Created', done: false },
  { step: 'tenant_database', label: 'Database Created', done: false },
  { step: 'tenant_schema', label: 'Schema Migrated', done: false },
  { step: 'store_configuration', label: 'Initial Setup', done: false },
  { step: 'store_admin', label: 'Client Admin Created', done: false },
  { step: 'platform_subdomain', label: 'Subdomain Created', done: false },
  { step: 'store_ready', label: 'Store Ready', done: false },
];

/** Polls the store until provisioning settles, then hands over to the account area. */
export function ProvisioningProgress({ initialStore }: { initialStore: StoreView | null }) {
  const [store, setStore] = React.useState<StoreView | null>(initialStore);
  const [error, setError] = React.useState<string | null>(null);
  const [retrying, setRetrying] = React.useState(false);

  const status = store?.provisioningStatus ?? 'pending';
  const steps = store?.provisioningSteps?.length ? store.provisioningSteps : FALLBACK_STEPS;
  const doneCount = steps.filter((s) => s.done).length;
  const percent = Math.round((doneCount / steps.length) * 100);

  // Bounded polling: ~3 minutes of attempts with a widening interval, then stop
  // and tell the user rather than hammering the API forever.
  const MAX_ATTEMPTS = 40;
  const [attempts, setAttempts] = React.useState(0);
  const stalled = attempts >= MAX_ATTEMPTS && status !== 'completed' && status !== 'failed';

  React.useEffect(() => {
    if (status === 'completed' || status === 'failed' || attempts >= MAX_ATTEMPTS) return;

    const delay = attempts < 10 ? 3000 : attempts < 25 ? 5000 : 10000;
    const timer = setTimeout(async () => {
      try {
        const next = await api.get<StoreView>('/api/v1/client/store');
        setStore(next);
        setError(null);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setAttempts((count) => count + 1);
      }
    }, delay);

    return () => clearTimeout(timer);
  }, [status, attempts]);

  const retry = async () => {
    setRetrying(true);
    setError(null);
    try {
      await api.post('/api/v1/client/store/retry-provisioning');
      const next = await api.get<StoreView>('/api/v1/client/store');
      setStore(next);
      setAttempts(0); // resume polling for the fresh run
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="space-y-2 text-center">
        {status === 'completed' ? (
          <>
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-success-soft text-success">
              <Check className="size-6" strokeWidth={3} />
            </span>
            <h2 className="text-2xl font-bold tracking-tight">Your store is ready</h2>
            <p className="text-sm text-muted-foreground">
              Everything is provisioned. Open your storefront or head to your admin panel.
            </p>
          </>
        ) : status === 'failed' ? (
          <>
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-destructive-soft text-destructive">
              <AlertTriangle className="size-6" />
            </span>
            <h2 className="text-2xl font-bold tracking-tight">Provisioning did not finish</h2>
            <p className="text-sm text-muted-foreground">
              Nothing was charged and no trial days were used. Retry below or contact support.
            </p>
          </>
        ) : (
          <>
            <span className="mx-auto grid size-12 place-items-center rounded-full bg-primary-soft text-accent-foreground">
              <Loader2 className="size-6 animate-spin" />
            </span>
            <h2 className="text-2xl font-bold tracking-tight">Creating your store</h2>
            <p className="text-sm text-muted-foreground">
              This usually takes under a minute. You can leave this page open.
            </p>
          </>
        )}
      </header>

      {error ? <Alert variant="warning">{error}</Alert> : null}

      {stalled ? (
        <Alert variant="warning" title="This is taking longer than usual">
          We have stopped checking automatically. Refresh the page to check again, or contact support
          if your store is still not ready.
        </Alert>
      ) : null}

      <div className="space-y-3 rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Progress</span>
          <span className="text-muted-foreground">
            {doneCount} of {steps.length}
          </span>
        </div>
        <Progress value={percent} indicatorClassName={status === 'failed' ? 'bg-destructive' : undefined} />

        <ul className="space-y-2 pt-2">
          {steps.map((step, index) => {
            const active = !step.done && steps.slice(0, index).every((s) => s.done) && status === 'creating';
            return (
              <li key={step.step} className="flex items-center gap-3 text-sm">
                <span
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full border text-[10px]',
                    step.done
                      ? 'border-success bg-success-soft text-success'
                      : active
                        ? 'border-primary bg-primary-soft text-accent-foreground'
                        : 'border-border text-muted-foreground',
                  )}
                >
                  {step.done ? (
                    <Check className="size-3.5" strokeWidth={3} />
                  ) : active ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className={step.done ? 'text-foreground' : 'text-muted-foreground'}>{step.label}</span>
              </li>
            );
          })}
        </ul>
      </div>

      {status === 'completed' && store ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Button asChild size="lg">
            <a href={store.storefrontUrl} target="_blank" rel="noreferrer noopener">
              Open my store <ArrowRight />
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href={store.adminUrl} target="_blank" rel="noreferrer noopener">
              Open admin panel
            </a>
          </Button>
          <Button asChild variant="ghost" className="sm:col-span-2">
            <Link href="/dashboard">Go to my account</Link>
          </Button>
        </div>
      ) : status === 'failed' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Button size="lg" onClick={retry} loading={retrying}>
            Retry provisioning
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/dashboard/support">Contact support</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}

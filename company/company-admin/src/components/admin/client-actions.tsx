'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Ban,
  CalendarPlus,
  ExternalLink,
  MoreHorizontal,
  PlayCircle,
  RefreshCw,
  Repeat,
  XCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toaster';
import { useReauth } from './reauth-provider';
import { api, errorMessage } from '@/lib/api';
import type { ClientDetail, Plan } from '@/lib/types';

type ActionKey = 'suspend' | 'reactivate' | 'extend-trial' | 'change-plan' | 'cancel-sub' | 'reactivate-sub';

const CONFIRMATIONS: Record<
  Exclude<ActionKey, 'extend-trial' | 'change-plan'>,
  { title: string; description: string; confirm: string; destructive?: boolean }
> = {
  suspend: {
    title: 'Suspend this client?',
    description:
      'The storefront and client admin panel go offline immediately. No data is deleted and the subscription is untouched.',
    confirm: 'Suspend client',
    destructive: true,
  },
  reactivate: {
    title: 'Reactivate this client?',
    description: 'The storefront and admin panel come back online right away.',
    confirm: 'Reactivate client',
  },
  'cancel-sub': {
    title: 'Cancel this subscription?',
    description:
      'It stays active until the end of the paid period, then stops renewing. Client data is retained.',
    confirm: 'Cancel subscription',
    destructive: true,
  },
  'reactivate-sub': {
    title: 'Reactivate this subscription?',
    description: 'Billing resumes on the next renewal date.',
    confirm: 'Reactivate subscription',
  },
};

export function ClientActions({ client, plans }: { client: ClientDetail; plans: Plan[] }) {
  const router = useRouter();
  const { run: withReauth } = useReauth();
  const [action, setAction] = React.useState<ActionKey | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [extraDays, setExtraDays] = React.useState('14');
  const [planId, setPlanId] = React.useState(plans[0]?.id ?? '');
  const [cycle, setCycle] = React.useState<'monthly' | 'yearly'>(client.subscription?.billingCycle ?? 'monthly');

  const close = () => {
    setAction(null);
    setError(null);
  };

  const run = async (fn: () => Promise<unknown>, successMessage: string) => {
    setBusy(true);
    setError(null);
    try {
      // Prompts for the password and retries once if the re-auth window lapsed.
      await withReauth(fn);
      toast.success(successMessage);
      close();
      router.refresh();
    } catch (err) {
      // A cancelled prompt maps to '', so the dialog just stays open.
      setError(errorMessage(err) || null);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    switch (action) {
      case 'suspend':
        return run(() => api.post(`/api/v1/admin/clients/${client.id}/suspend`), 'Client suspended');
      case 'reactivate':
        return run(() => api.post(`/api/v1/admin/clients/${client.id}/reactivate`), 'Client reactivated');
      case 'cancel-sub':
        return run(
          () => api.post(`/api/v1/admin/subscriptions/${client.subscription?.id}/cancel`),
          'Subscription cancelled',
        );
      case 'reactivate-sub':
        return run(
          () => api.post(`/api/v1/admin/subscriptions/${client.subscription?.id}/reactivate`),
          'Subscription reactivated',
        );
      case 'extend-trial':
        return run(
          () => api.post(`/api/v1/admin/clients/${client.id}/extend-trial`, { days: Number(extraDays) }),
          `Trial extended by ${extraDays} days`,
        );
      case 'change-plan':
        return run(
          () => api.post(`/api/v1/admin/clients/${client.id}/change-plan`, { planId, billingCycle: cycle }),
          'Plan changed',
        );
      default:
        return undefined;
    }
  };

  const suspended = client.accountStatus === 'suspended' || client.tenantStatus === 'suspended';
  const hasSubscription = Boolean(client.subscription?.id);
  const subscriptionActive = ['active', 'trial', 'past_due'].includes(client.subscription?.status ?? '');

  const simple = action && action !== 'extend-trial' && action !== 'change-plan' ? CONFIRMATIONS[action] : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {client.storefrontUrl ? (
          <Button asChild variant="outline" size="sm">
            <a href={client.storefrontUrl} target="_blank" rel="noreferrer noopener">
              Open store <ExternalLink />
            </a>
          </Button>
        ) : null}

        {suspended ? (
          <Button size="sm" onClick={() => setAction('reactivate')}>
            <PlayCircle /> Reactivate
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setAction('suspend')}>
            <Ban /> Suspend
          </Button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon-sm" aria-label="More actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Client</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setAction('extend-trial')} disabled={!client.trial}>
              <CalendarPlus /> Extend trial
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setAction('change-plan')} disabled={plans.length === 0}>
              <Repeat /> Change plan
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Subscription</DropdownMenuLabel>
            {subscriptionActive ? (
              <DropdownMenuItem destructive onSelect={() => setAction('cancel-sub')} disabled={!hasSubscription}>
                <XCircle /> Cancel subscription
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => setAction('reactivate-sub')} disabled={!hasSubscription}>
                <RefreshCw /> Reactivate subscription
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Simple confirmations */}
      <Dialog open={!!simple} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{simple?.title}</DialogTitle>
            <DialogDescription>{simple?.description}</DialogDescription>
          </DialogHeader>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant={simple?.destructive ? 'destructive' : 'primary'} onClick={confirm} loading={busy}>
              {simple?.confirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Extend trial */}
      <Dialog open={action === 'extend-trial'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend trial</DialogTitle>
            <DialogDescription>
              Add days to {client.businessName}&apos;s trial. This is recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          {error ? <Alert variant="danger">{error}</Alert> : null}
          <Field label="Additional days" htmlFor="extraDays" required>
            <Input
              id="extraDays"
              type="number"
              min={1}
              max={365}
              value={extraDays}
              onChange={(event) => setExtraDays(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={confirm} loading={busy} disabled={!Number(extraDays)}>
              Extend trial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change plan */}
      <Dialog open={action === 'change-plan'} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change plan</DialogTitle>
            <DialogDescription>
              Moving to a smaller plan is checked against current usage before it is applied.
            </DialogDescription>
          </DialogHeader>
          {error ? <Alert variant="danger">{error}</Alert> : null}

          <div className="space-y-4">
            <Field label="Plan" htmlFor="planId" required>
              <Select value={planId} onValueChange={setPlanId}>
                <SelectTrigger id="planId">
                  <SelectValue placeholder="Select a plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field label="Billing cycle" htmlFor="cycle" required>
              <Select value={cycle} onValueChange={(v) => setCycle(v as 'monthly' | 'yearly')}>
                <SelectTrigger id="cycle">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={confirm} loading={busy} disabled={!planId}>
              Change plan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

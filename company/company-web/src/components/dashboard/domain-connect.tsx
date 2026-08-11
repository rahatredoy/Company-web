'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { BadgeCheck, CheckCircle2, Clock, Plus, RefreshCw, Settings2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { CopyButton } from './copy-button';
import { toast } from '@/components/ui/toaster';
import { api, errorMessage } from '@/lib/api';
import { domainSchema } from '@/lib/validation';
import type { DomainType, DomainView } from '@/lib/types';
import { z } from 'zod';

const connectSchema = z.object({ domain: domainSchema });
type ConnectInput = z.input<typeof connectSchema>;

/**
 * One custom domain, inline on the Addresses card.
 *
 * Connecting a domain is only half of it — DNS has to prove ownership before the
 * store answers on it — so the records and the re-check live here too. Without
 * them a domain could be added and then never verified, which is a store that
 * quietly does not load at the address its owner just paid for.
 */
export function DomainConnect({
  domain,
  domainType,
  allowed,
}: {
  domain: DomainView | null;
  domainType: Extract<DomainType, 'storefront_custom' | 'admin_custom'>;
  allowed: boolean;
}) {
  const router = useRouter();
  const [connecting, setConnecting] = React.useState(false);
  const [records, setRecords] = React.useState<DomainView | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const label = domainType === 'storefront_custom' ? 'storefront' : 'admin panel';

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ConnectInput>({ resolver: zodResolver(connectSchema), defaultValues: { domain: '' } });

  const connect = handleSubmit(async (values) => {
    setError(null);
    try {
      const created = await api.post<DomainView>('/api/v1/client/domains', {
        domain: values.domain,
        domainType,
      });
      setConnecting(false);
      reset();
      // Straight into the records: the domain does nothing until they are added.
      setRecords(created);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  async function verify(target: DomainView) {
    setBusy(true);
    try {
      const result = await api.post<DomainView>(`/api/v1/client/domains/${target.id}/verify`);
      if (result.verified) {
        toast.success('Domain verified', { description: `${target.domain} is now active.` });
        setRecords(null);
      } else {
        toast.warning('Not verified yet', {
          description: 'DNS changes can take up to 24 hours to reach us.',
        });
      }
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(target: DomainView) {
    setBusy(true);
    try {
      await api.delete(`/api/v1/client/domains/${target.id}`);
      toast.success('Domain removed');
      setRecords(null);
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {domain ? (
        <div className="flex items-center gap-2">
          {domain.verified ? (
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
          ) : (
            <Clock className="size-4 shrink-0 text-warning" aria-hidden />
          )}

          <span className="min-w-0 truncate text-sm font-medium">{domain.domain}</span>

          {domain.verified && domain.isPrimary ? (
            <Badge variant="primary" className="shrink-0">
              <BadgeCheck className="size-3.5" aria-hidden /> Primary
            </Badge>
          ) : null}
          {domain.verified ? null : <StatusBadge status={domain.status} className="shrink-0" />}

          <span className="ml-auto flex shrink-0 items-center">
            <CopyButton value={domain.domain} label="" />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`DNS records for ${domain.domain}`}
              onClick={() => setRecords(domain)}
            >
              <Settings2 />
            </Button>
          </span>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted-foreground">Not connected</span>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            aria-label={`Connect a custom ${label} domain`}
            title={allowed ? undefined : 'Your plan does not include custom domains.'}
            disabled={!allowed}
            onClick={() => setConnecting(true)}
          >
            <Plus /> Connect
          </Button>
        </div>
      )}

      <Dialog open={connecting} onOpenChange={setConnecting}>
        <DialogContent>
          <form onSubmit={connect} noValidate>
            <DialogHeader>
              <DialogTitle>Connect a custom {label} domain</DialogTitle>
              <DialogDescription>
                Enter a domain you already own. We will show the DNS records to add, then check them.
              </DialogDescription>
            </DialogHeader>

            <div className="my-5 space-y-4">
              {error ? <Alert variant="danger">{error}</Alert> : null}
              <Field
                label="Domain"
                htmlFor={`domain-${domainType}`}
                required
                error={errors.domain?.message}
                hint={
                  domainType === 'admin_custom'
                    ? 'A subdomain you control, for example admin.abcfashion.com'
                    : 'Without http:// — for example abcfashion.com'
                }
              >
                <Input
                  id={`domain-${domainType}`}
                  placeholder={domainType === 'admin_custom' ? 'admin.abcfashion.com' : 'abcfashion.com'}
                  autoComplete="off"
                  spellCheck={false}
                  invalid={!!errors.domain}
                  {...register('domain')}
                />
              </Field>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConnecting(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={isSubmitting}>
                Connect domain
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!records} onOpenChange={(open) => !open && setRecords(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>DNS records for {records?.domain}</DialogTitle>
            <DialogDescription>
              Add these at your DNS provider, then press Verify. Changes can take up to 24 hours to
              propagate.
            </DialogDescription>
          </DialogHeader>

          <TableWrapper>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>TTL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(records?.dnsInstructions ?? []).map((record) => (
                  <TableRow key={`${record.type}-${record.name}`}>
                    <TableCell className="font-mono text-xs">{record.type}</TableCell>
                    <TableCell className="font-mono text-xs">{record.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1">
                        <code className="font-mono text-xs break-all">{record.value}</code>
                        <CopyButton value={record.value} label="" />
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{record.ttl}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableWrapper>

          <DialogFooter className="sm:justify-between">
            {records ? (
              <Button variant="ghost" onClick={() => remove(records)} disabled={busy}>
                <Trash2 className="text-destructive" /> Remove
              </Button>
            ) : null}
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setRecords(null)}>
                Close
              </Button>
              {records ? (
                <Button onClick={() => verify(records)} loading={busy} disabled={records.verified}>
                  <RefreshCw /> Verify now
                </Button>
              ) : null}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

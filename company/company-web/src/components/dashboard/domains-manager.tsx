'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Globe, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { EmptyState } from './empty-state';
import { CopyButton } from './copy-button';
import { toast } from '@/components/ui/toaster';
import { addDomainSchema, type AddDomainInput } from '@/lib/validation';
import { api, errorMessage } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { DomainView } from '@/lib/types';

export function DomainsManager({
  domains,
  customDomainAllowed,
  customAdminDomainAllowed,
}: {
  domains: DomainView[];
  customDomainAllowed: boolean;
  customAdminDomainAllowed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [instructionsFor, setInstructionsFor] = React.useState<DomainView | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AddDomainInput>({
    resolver: zodResolver(addDomainSchema),
    defaultValues: { domain: '', domainType: 'storefront_custom' },
  });

  const domainType = watch('domainType');

  const addDomain = handleSubmit(async (values) => {
    setError(null);
    try {
      const created = await api.post<DomainView>('/api/v1/client/domains', values);
      toast.success('Domain added', { description: 'Add the DNS records shown, then verify.' });
      setOpen(false);
      reset();
      setInstructionsFor(created);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  const verify = async (domain: DomainView) => {
    setBusyId(domain.id);
    try {
      const result = await api.post<DomainView>(`/api/v1/client/domains/${domain.id}/verify`);
      if (result.verified) {
        toast.success('Domain verified', { description: `${domain.domain} is now active.` });
      } else {
        toast.warning('Not verified yet', {
          description: 'DNS changes can take up to 24 hours to propagate.',
        });
      }
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (domain: DomainView) => {
    setBusyId(domain.id);
    try {
      await api.delete(`/api/v1/client/domains/${domain.id}`);
      toast.success('Domain removed');
      router.refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const canAdd = customDomainAllowed || customAdminDomainAllowed;

  return (
    <div className="space-y-4">
      {!canAdd ? (
        <Alert variant="info" title="Custom domains are not included in your plan">
          Upgrade to connect your own storefront or admin domain. Your free platform subdomain keeps
          working either way.
        </Alert>
      ) : null}

      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button disabled={!canAdd}>
              <Plus /> Add domain
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={addDomain} noValidate>
              <DialogHeader>
                <DialogTitle>Connect a custom domain</DialogTitle>
                <DialogDescription>
                  Enter a domain you already own. We will show the DNS records to add, then verify them.
                </DialogDescription>
              </DialogHeader>

              <div className="my-5 space-y-4">
                {error ? <Alert variant="danger">{error}</Alert> : null}

                <Field label="Domain type" htmlFor="domainType" required>
                  <Select
                    value={domainType}
                    onValueChange={(v) =>
                      setValue('domainType', v as AddDomainInput['domainType'], { shouldValidate: true })
                    }
                  >
                    <SelectTrigger id="domainType">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="storefront_custom" disabled={!customDomainAllowed}>
                        Storefront domain
                      </SelectItem>
                      <SelectItem value="admin_custom" disabled={!customAdminDomainAllowed}>
                        Admin panel domain
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field
                  label="Domain"
                  htmlFor="domain"
                  required
                  error={errors.domain?.message}
                  hint="Without http:// — for example abcfashion.com"
                >
                  <Input id="domain" placeholder="abcfashion.com" invalid={!!errors.domain} {...register('domain')} />
                </Field>
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" loading={isSubmitting}>
                  Add domain
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {domains.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="No domains connected"
          description="Your store is reachable on its free platform subdomain. Connect your own domain whenever you are ready."
        />
      ) : (
        <Card>
          <CardContent className="p-0 sm:p-0">
            <TableWrapper className="rounded-xl border-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Domain</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Primary</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last checked</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {domains.map((domain) => (
                    <TableRow key={domain.id}>
                      <TableCell className="font-medium">{domain.domain}</TableCell>
                      <TableCell>
                        <StatusBadge status={domain.domainType} />
                      </TableCell>
                      <TableCell>{domain.isPrimary ? <Badge variant="primary">Primary</Badge> : '—'}</TableCell>
                      <TableCell>
                        <StatusBadge status={domain.status} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(domain.lastCheckedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {domain.domainType !== 'platform_subdomain' ? (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setInstructionsFor(domain)}
                              >
                                DNS
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => verify(domain)}
                                loading={busyId === domain.id}
                                disabled={domain.verified}
                              >
                                <RefreshCw /> Verify
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Remove ${domain.domain}`}
                                onClick={() => remove(domain)}
                                disabled={busyId === domain.id}
                              >
                                <Trash2 className="text-destructive" />
                              </Button>
                            </>
                          ) : (
                            <span className="px-2 text-xs text-muted-foreground">Managed by platform</span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableWrapper>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!instructionsFor} onOpenChange={(o) => !o && setInstructionsFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>DNS records for {instructionsFor?.domain}</DialogTitle>
            <DialogDescription>
              Add these records at your DNS provider, then come back and press Verify. Changes can take
              up to 24 hours to propagate.
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
                {(instructionsFor?.dnsInstructions ?? []).map((record) => (
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

          <DialogFooter>
            <Button variant="outline" onClick={() => setInstructionsFor(null)}>
              Close
            </Button>
            {instructionsFor ? (
              <Button onClick={() => verify(instructionsFor)} loading={busyId === instructionsFor.id}>
                Verify now
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

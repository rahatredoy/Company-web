import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Check } from 'lucide-react';
import { PageHeader } from '@/components/admin/page-header';
import { ClientActions } from '@/components/admin/client-actions';
import { ActivityFeed } from '@/components/admin/activity-feed';
import { InfoList, InfoRow } from '@/components/admin/info-row';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { StatusBadge } from '@/components/ui/status-badge';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableWrapper,
} from '@/components/ui/table';
import { serverGetOptional } from '@/lib/server-api';
import { formatDate, formatDateTime, formatMoney, titleCase } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ClientDetail, Plan } from '@/lib/types';

export const metadata: Metadata = { title: 'Client' };

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [client, plans] = await Promise.all([
    serverGetOptional<ClientDetail>(`/api/v1/admin/clients/${id}`),
    serverGetOptional<Plan[]>('/api/v1/admin/plans'),
  ]);

  if (!client) notFound();

  return (
    <>
      <Button asChild variant="ghost" size="sm" className="-ml-2 w-fit">
        <Link href="/clients">
          <ArrowLeft /> All clients
        </Link>
      </Button>

      <PageHeader
        title={client.businessName}
        description={`${client.tenantId ?? 'No tenant yet'} · registered ${formatDate(client.registeredAt)}`}
        actions={<ClientActions client={client} plans={plans ?? []} />}
      />

      <div className="flex flex-wrap gap-2">
        <StatusBadge status={client.accountStatus} />
        {client.tenantStatus ? <StatusBadge status={client.tenantStatus} /> : null}
        {client.subscriptionStatus ? <StatusBadge status={client.subscriptionStatus} /> : null}
        {client.storeStatus ? <StatusBadge status={client.storeStatus} /> : null}
        {client.emailVerified ? <Badge variant="success">Email verified</Badge> : <Badge variant="warning">Unverified</Badge>}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start sm:w-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="store">Store</TabsTrigger>
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="domains">Domains</TabsTrigger>
          <TabsTrigger value="support">Support</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <InfoList>
                  <InfoRow label="Business name" value={client.businessName} />
                  <InfoRow label="Tenant ID" value={<code className="font-mono text-xs">{client.tenantId ?? '—'}</code>} />
                  <InfoRow label="Owner" value={client.ownerName} />
                  <InfoRow label="Website login" value={client.email} />
                  {/* The panel login is independent of the one above — resetting either leaves the other alone. */}
                  <InfoRow
                    label="Panel login"
                    value={
                      client.storeAdminEmail ? (
                        <span className="flex flex-wrap items-center gap-2">
                          {client.storeAdminEmail}
                          {client.storeStatus !== 'ready' && !client.storeAdminEmailVerified ? (
                            <Badge variant="warning">Unconfirmed</Badge>
                          ) : null}
                        </span>
                      ) : (
                        'No store yet'
                      )
                    }
                  />
                  <InfoRow label="Phone" value={client.phone ?? '—'} />
                  <InfoRow label="Country" value={client.country ?? '—'} />
                  <InfoRow label="Registered" value={formatDate(client.registeredAt)} />
                  <InfoRow label="Last login" value={formatDateTime(client.lastLoginAt)} />
                </InfoList>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Plan &amp; trial</CardTitle>
              </CardHeader>
              <CardContent>
                <InfoList>
                  <InfoRow label="Plan" value={client.planName ?? '—'} />
                  <InfoRow
                    label="Subscription"
                    value={client.subscriptionStatus ? <StatusBadge status={client.subscriptionStatus} /> : '—'}
                  />
                  <InfoRow label="Renewal" value={formatDate(client.renewalAt)} />
                  <InfoRow
                    label="Amount"
                    value={client.amount ? formatMoney(client.amount, client.currency) : '—'}
                  />
                  <InfoRow
                    label="Trial"
                    value={client.trial ? <StatusBadge status={client.trial.status} /> : '—'}
                  />
                  <InfoRow label="Trial ends" value={formatDate(client.trial?.endsAt)} />
                  <InfoRow
                    label="Days remaining"
                    value={client.trial?.status === 'active' ? `${client.trial.daysRemaining} days` : '—'}
                  />
                </InfoList>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="account">
          <Card>
            <CardHeader>
              <CardTitle>Business profile</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoList>
                <InfoRow label="Business email" value={client.businessEmail ?? '—'} />
                <InfoRow label="Business phone" value={client.businessPhone ?? '—'} />
                <InfoRow label="Business type" value={client.businessType ? titleCase(client.businessType) : '—'} />
                <InfoRow label="Country" value={client.country ?? '—'} />
                <InfoRow label="Address" value={client.address ?? '—'} />
                <InfoRow label="Account status" value={<StatusBadge status={client.accountStatus} />} />
                <InfoRow
                  label="Email verified"
                  value={client.emailVerified ? <StatusBadge status="verified" /> : <StatusBadge status="pending" />}
                />
              </InfoList>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="store">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Store</CardTitle>
              </CardHeader>
              <CardContent>
                <InfoList>
                  <InfoRow label="Tenant status" value={client.tenantStatus ? <StatusBadge status={client.tenantStatus} /> : '—'} />
                  <InfoRow label="Store status" value={client.storeStatus ? <StatusBadge status={client.storeStatus} /> : '—'} />
                  <InfoRow label="Platform subdomain" value={client.platformSubdomain ?? '—'} />
                  <InfoRow label="Custom domain" value={client.customDomain ?? '—'} />
                  <InfoRow
                    label="Storefront"
                    value={
                      client.storefrontUrl ? (
                        <a href={client.storefrontUrl} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                          {client.storefrontUrl}
                        </a>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <InfoRow
                    label="Client admin"
                    value={
                      client.adminUrl ? (
                        <a href={client.adminUrl} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                          {client.adminUrl}
                        </a>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <InfoRow label="Currency / language" value={`${client.currency} · ${client.language ?? '—'}`} />
                  <InfoRow label="Timezone" value={client.timezone ?? '—'} />
                </InfoList>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Provisioning</CardTitle>
                {client.provisioning ? <StatusBadge status={client.provisioning.status} /> : null}
              </CardHeader>
              <CardContent>
                {client.provisioning ? (
                  <>
                    <ul className="space-y-2">
                      {client.provisioning.steps.map((step) => (
                        <li
                          key={step.step}
                          className={cn(
                            'flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm',
                            step.done ? 'border-success/25 bg-success-soft' : 'border-border',
                          )}
                        >
                          <span
                            className={cn(
                              'grid size-5 shrink-0 place-items-center rounded-full',
                              step.done ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground',
                            )}
                          >
                            {step.done ? <Check className="size-3" strokeWidth={3} /> : null}
                          </span>
                          {step.label}
                        </li>
                      ))}
                    </ul>
                    {client.provisioning.errorMessage ? (
                      <p className="mt-3 rounded-lg bg-destructive-soft px-3 py-2 text-xs text-destructive">
                        {client.provisioning.errorMessage}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="py-6 text-sm text-muted-foreground">No provisioning job for this client yet.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="subscription">
          <Card>
            <CardHeader>
              <CardTitle>Subscription</CardTitle>
            </CardHeader>
            <CardContent>
              {client.subscription ? (
                <InfoList>
                  <InfoRow label="Plan" value={client.subscription.planName ?? '—'} />
                  <InfoRow label="Status" value={<StatusBadge status={client.subscription.status} />} />
                  <InfoRow
                    label="Billing cycle"
                    value={client.subscription.billingCycle ? titleCase(client.subscription.billingCycle) : '—'}
                  />
                  <InfoRow
                    label="Price"
                    value={
                      client.subscription.price
                        ? formatMoney(client.subscription.price, client.subscription.currency)
                        : '—'
                    }
                  />
                  <InfoRow label="Started" value={formatDate(client.subscription.startedAt)} />
                  <InfoRow label="Renews" value={formatDate(client.subscription.renewalAt)} />
                  <InfoRow label="Cancelled" value={formatDate(client.subscription.cancelledAt)} />
                </InfoList>
              ) : (
                <p className="py-6 text-sm text-muted-foreground">No subscription on this account.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Payments</CardTitle>
              </CardHeader>
              <CardContent className="p-0 sm:p-0">
                <TableWrapper className="rounded-none border-x-0 border-b-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Transaction</TableHead>
                        <TableHead>Plan</TableHead>
                        <TableHead>Gateway</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {client.payments.length === 0 ? (
                        <TableEmpty colSpan={6}>No payments recorded.</TableEmpty>
                      ) : (
                        client.payments.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell className="font-mono text-xs">{payment.transactionId ?? '—'}</TableCell>
                            <TableCell>{payment.planName ?? '—'}</TableCell>
                            <TableCell>{titleCase(payment.provider)}</TableCell>
                            <TableCell className="text-right font-medium">
                              {formatMoney(payment.amount, payment.currency)}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={payment.status} />
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              {formatDateTime(payment.paidAt ?? payment.createdAt)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableWrapper>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Invoices</CardTitle>
              </CardHeader>
              <CardContent className="p-0 sm:p-0">
                <TableWrapper className="rounded-none border-x-0 border-b-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Invoice</TableHead>
                        <TableHead>Plan</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Issued</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {client.invoices.length === 0 ? (
                        <TableEmpty colSpan={5}>No invoices issued.</TableEmpty>
                      ) : (
                        client.invoices.map((invoice) => (
                          <TableRow key={invoice.id}>
                            <TableCell className="font-medium whitespace-nowrap">{invoice.invoiceNumber}</TableCell>
                            <TableCell>{invoice.planName ?? '—'}</TableCell>
                            <TableCell className="text-right font-medium">
                              {formatMoney(invoice.amount, invoice.currency)}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={invoice.status} />
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-muted-foreground">
                              {formatDate(invoice.issuedAt)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableWrapper>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="domains">
          <Card>
            <CardContent className="p-0 sm:p-0">
              <TableWrapper className="rounded-xl border-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Domain</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Primary</TableHead>
                      <TableHead>Verified</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last checked</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {client.domains.length === 0 ? (
                      <TableEmpty colSpan={6}>No domains connected.</TableEmpty>
                    ) : (
                      client.domains.map((domain) => (
                        <TableRow key={domain.id}>
                          <TableCell className="font-medium">{domain.domain}</TableCell>
                          <TableCell>
                            <StatusBadge status={domain.domainType} />
                          </TableCell>
                          <TableCell>{domain.isPrimary ? <Badge variant="primary">Primary</Badge> : '—'}</TableCell>
                          <TableCell>{domain.verified ? <Badge variant="success">Yes</Badge> : <Badge>No</Badge>}</TableCell>
                          <TableCell>
                            <StatusBadge status={domain.status} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatDate(domain.lastCheckedAt)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableWrapper>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="support">
          <Card>
            <CardContent className="p-0 sm:p-0">
              <TableWrapper className="rounded-xl border-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ticket</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Priority</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last reply</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {client.tickets.length === 0 ? (
                      <TableEmpty colSpan={5}>No support tickets.</TableEmpty>
                    ) : (
                      client.tickets.map((ticket) => (
                        <TableRow key={ticket.id}>
                          <TableCell className="font-mono text-xs">{ticket.reference}</TableCell>
                          <TableCell>
                            <Link href={`/support/${ticket.id}`} className="font-medium text-primary hover:underline">
                              {ticket.subject}
                            </Link>
                          </TableCell>
                          <TableCell>{titleCase(ticket.priority)}</TableCell>
                          <TableCell>
                            <StatusBadge status={ticket.status} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatDateTime(ticket.lastReplyAt ?? ticket.createdAt)}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableWrapper>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardContent className="p-5 sm:p-6">
              <ActivityFeed items={client.activity} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

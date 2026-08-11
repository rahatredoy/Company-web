import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { InfoList, InfoRow } from '@/components/admin/info-row';
import {
  EmailSettingsForm,
  GeneralSettingsForm,
  TrialSettingsForm,
} from '@/components/admin/settings-forms';
import { PasswordForm } from '@/components/admin/password-form';
import { SettingsTabs } from '@/components/admin/settings-tabs';
import { isSettingsTab } from '@/lib/settings-tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { serverGetOptional } from '@/lib/server-api';
import { formatDateTime, titleCase } from '@/lib/format';
import type { AdminMe, PlatformSettings } from '@/lib/types';

export const metadata: Metadata = { title: 'Settings' };

function ConfiguredBadge({ ok }: { ok: boolean }) {
  return <Badge variant={ok ? 'success' : 'warning'}>{ok ? 'Configured' : 'Not configured'}</Badge>;
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const activeTab = isSettingsTab(tab) ? tab : 'general';

  const [settings, admin] = await Promise.all([
    serverGetOptional<PlatformSettings>('/api/v1/admin/settings'),
    serverGetOptional<AdminMe>('/api/v1/admin/me'),
  ]);

  if (!settings) {
    return (
      <>
        <PageHeader title="Settings" />
        <Alert variant="warning" title="Settings are unavailable">
          The company API did not respond. Check that it is running, then refresh.
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Platform configuration. Infrastructure secrets stay in the API environment."
      />

      <SettingsTabs value={activeTab}>
        <TabsList className="w-full justify-start sm:w-auto">
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="trial">Trial</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="email">Email</TabsTrigger>
          <TabsTrigger value="messaging">SMS / WhatsApp</TabsTrigger>
          <TabsTrigger value="domain">Domain</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle>General</CardTitle>
              <CardDescription>Platform identity and defaults shown across the product.</CardDescription>
            </CardHeader>
            <CardContent>
              <GeneralSettingsForm settings={settings.general} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trial">
          <Card>
            <CardHeader>
              <CardTitle>Trial</CardTitle>
              <CardDescription>
                Trial length and the reminder schedule sent before a trial ends.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TrialSettingsForm settings={settings.trial} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
              <CardDescription>
                Gateway keys and the webhook secret are environment-only and never editable here.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <InfoList>
                <InfoRow label="Provider" value={titleCase(settings.payments.provider)} />
                <InfoRow label="Billing currency" value={settings.payments.currency} />
                <InfoRow label="Credentials" value={<ConfiguredBadge ok={settings.payments.configured} />} />
              </InfoList>
              <Alert variant="info" className="mt-4">
                Subscriptions activate only after a signature-verified webhook. A redirect back from the
                gateway is never treated as proof of payment.
              </Alert>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="email">
          <Card>
            <CardHeader>
              <CardTitle>Email</CardTitle>
              <CardDescription>Sender identity used for verification and billing emails.</CardDescription>
            </CardHeader>
            <CardContent>
              <EmailSettingsForm settings={settings.email} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="messaging">
          <Card>
            <CardHeader>
              <CardTitle>SMS / WhatsApp</CardTitle>
              <CardDescription>Optional notification channels.</CardDescription>
            </CardHeader>
            <CardContent>
              <InfoList>
                <InfoRow label="SMS provider" value={settings.messaging.smsProvider ?? 'Not set'} />
                <InfoRow label="SMS credentials" value={<ConfiguredBadge ok={settings.messaging.smsConfigured} />} />
                <InfoRow label="WhatsApp provider" value={settings.messaging.whatsappProvider ?? 'Not set'} />
                <InfoRow
                  label="WhatsApp credentials"
                  value={<ConfiguredBadge ok={settings.messaging.whatsappConfigured} />}
                />
              </InfoList>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="domain">
          <Card>
            <CardHeader>
              <CardTitle>Domain</CardTitle>
              <CardDescription>How client store and admin URLs are constructed.</CardDescription>
            </CardHeader>
            <CardContent>
              <InfoList>
                <InfoRow label="Platform root domain" value={settings.domain.platformRootDomain} />
                <InfoRow label="Client admin URL pattern" value={settings.domain.clientAdminUrlPattern} />
                <InfoRow
                  label="DNS target for custom domains"
                  value={settings.domain.dnsTarget ?? 'Not set'}
                />
              </InfoList>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Sign-in verification</CardTitle>
                <CardDescription>
                  Every sign-in sends a 6-digit passcode to your email address. It expires in a few
                  minutes and can be used once, so a leaked password is not enough on its own.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {admin ? (
                  <p className="text-sm text-muted-foreground">
                    Codes are sent to <span className="font-medium text-foreground">{admin.email}</span>.
                    Change the address from your account details to change where they arrive.
                  </p>
                ) : (
                  <Alert variant="warning">Could not load your account details. Refresh to try again.</Alert>
                )}
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Change password</CardTitle>
                  <CardDescription>At least 12 characters, mixed case, a number and a symbol.</CardDescription>
                </CardHeader>
                <CardContent>
                  <PasswordForm passwordChangedAt={admin?.passwordChangedAt ?? null} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Session policy</CardTitle>
                </CardHeader>
                <CardContent>
                  <InfoList>
                    <InfoRow label="Client session lifetime" value={`${settings.security.sessionTtlMinutes} minutes`} />
                    <InfoRow
                      label="Admin session lifetime"
                      value={`${settings.security.adminSessionTtlMinutes} minutes`}
                    />
                    <InfoRow
                      label="Re-authentication window"
                      value={`${settings.security.reauthWindowMinutes} minutes`}
                    />
                    <InfoRow label="Last sign in" value={formatDateTime(admin?.lastLoginAt)} />
                    <InfoRow label="Last sign-in IP" value={admin?.lastLoginIp ?? '—'} />
                  </InfoList>
                </CardContent>
              </Card>

              <Alert variant="info" title="One company admin, by design">
                There is exactly one company administrator account, enforced by a unique index in the
                database. Creating additional admins, roles or staff members is not supported
                anywhere in this panel or the API.
              </Alert>
            </div>
          </div>
        </TabsContent>
      </SettingsTabs>
    </>
  );
}

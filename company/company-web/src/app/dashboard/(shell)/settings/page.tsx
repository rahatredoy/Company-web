import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/dashboard/page-header';
import { ProfileForm } from '@/components/dashboard/profile-form';
import { BusinessDetailsForm } from '@/components/dashboard/business-details-form';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoList, InfoRow } from '@/components/dashboard/info-row';
import { StatusBadge } from '@/components/ui/status-badge';
import { serverGetOptional } from '@/lib/server-api';
import { formatDate, formatDateTime } from '@/lib/format';
import type { BusinessProfileView, ClientMe } from '@/lib/types';

export const metadata: Metadata = { title: 'Settings', robots: { index: false, follow: false } };

export default async function SettingsPage() {
  const [account, business] = await Promise.all([
    serverGetOptional<ClientMe>('/api/v1/client/me'),
    serverGetOptional<BusinessProfileView | null>('/api/v1/client/business'),
  ]);

  if (!account) redirect('/sign-in?next=%2Fdashboard%2Fsettings');

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your account details and the business information printed on your invoices."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account information</CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileForm account={account} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account status</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoList>
              <InfoRow label="Email" value={account.email} />
              <InfoRow label="Status" value={<StatusBadge status={account.status} />} />
              <InfoRow
                label="Email verified"
                value={account.emailVerified ? <StatusBadge status="verified" /> : <StatusBadge status="pending" />}
              />
              <InfoRow label="Member since" value={formatDate(account.createdAt)} />
              <InfoRow label="Last sign in" value={formatDateTime(account.lastLoginAt)} />
            </InfoList>
            <p className="mt-4 text-xs text-muted-foreground">
              Changing your email address needs a support request, so an address change can never be made
              from a session alone.
            </p>
          </CardContent>
        </Card>
      </div>

      <BusinessDetailsForm profile={business ?? null} />
    </>
  );
}

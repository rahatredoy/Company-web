import type { Metadata } from 'next';
import { PageHeader } from '@/components/dashboard/page-header';
import { ChangePasswordForm } from '@/components/dashboard/change-password-form';
import { SessionsList, type SessionView } from '@/components/dashboard/sessions-list';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { serverGetOptional } from '@/lib/server-api';

export const metadata: Metadata = { title: 'Security', robots: { index: false, follow: false } };

export default async function SecurityPage() {
  const sessions = await serverGetOptional<SessionView[]>('/api/v1/client/sessions');

  return (
    <>
      <PageHeader title="Security" description="Password and active sessions for your account." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>
              Updating your password signs out every other device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm />
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active sessions</CardTitle>
              <CardDescription>Devices currently signed in to your account.</CardDescription>
            </CardHeader>
            <CardContent>
              <SessionsList sessions={sessions ?? []} />
            </CardContent>
          </Card>

          <Alert variant="info" title="How we protect your account">
            Passwords are hashed with Argon2id and never stored in readable form. Sessions use HttpOnly
            cookies, failed sign-in attempts are rate limited, and we log the IP and device of every
            session so you can review them here.
          </Alert>
        </div>
      </div>
    </>
  );
}

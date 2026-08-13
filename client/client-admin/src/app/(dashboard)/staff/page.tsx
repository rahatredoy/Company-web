import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import type { SessionResponse } from '@/lib/types';
import { serverGet } from '@/lib/server-api';
import { PageHeader } from '@/components/admin/page-header';
import { Alert } from '@/components/ui/alert';
import { Avatar, AvatarFallback, initialsOf } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';

export const metadata: Metadata = { title: 'Staff' };
export const dynamic = 'force-dynamic';

/**
 * Who can get into this panel.
 *
 * The answer is one person, and that is enforced by the database rather than by
 * this page: `store_admins_singleton_key` is a unique index on a constant, so a
 * second row is refused however it is attempted. No endpoint creates an admin
 * either — the account is seeded by company provisioning from the login chosen
 * at signup.
 *
 * So this page says so plainly instead of offering an Invite button that would
 * fail. A control that cannot work is worse than an honest explanation.
 */
export default async function StaffPage() {
  const session = await serverGet<SessionResponse>('/api/v1/admin/auth/session');

  if (!session.authenticated) {
    return (
      <div className="space-y-6">
        <PageHeader title="Staff" />
        <Alert variant="danger">Your session has expired. Sign in again.</Alert>
      </div>
    );
  }

  const { admin } = session;

  return (
    <div className="space-y-6">
      <PageHeader title="Staff" description="Who can sign in to this panel." />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4 pt-6">
          <Avatar className="size-12">
            <AvatarFallback>{initialsOf(admin.fullName)}</AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <p className="font-medium">{admin.fullName}</p>
            <p className="text-sm text-muted-foreground">{admin.email}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status="active" />
            <StatusBadge
              status="vip"
              label={admin.roleKey === 'STORE_SUPER_ADMIN' ? 'Owner' : 'Admin'}
            />
            <StatusBadge
              status={admin.mfaEnabled ? 'verified' : 'pending'}
              label={admin.mfaEnabled ? 'Two-factor on' : 'Two-factor off'}
            />
          </div>
        </CardContent>
      </Card>

      <Alert variant="info" title="This store has one admin account">
        That is deliberate, and the database enforces it — a second account cannot be created even
        by mistake. It also means the owner can never be locked out by a permissions error.
        <span className="mt-2 block">
          To hand the store to somebody else, change the email and password on this account from{' '}
          <Link href="/account/security" className="underline">
            Security
          </Link>
          .
        </span>
      </Alert>

      <div className="flex gap-2">
        <Button asChild variant="secondary">
          <Link href="/account/security">
            <ShieldCheck aria-hidden /> Security settings
          </Link>
        </Button>
      </div>
    </div>
  );
}

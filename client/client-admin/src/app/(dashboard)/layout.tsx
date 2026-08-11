import { redirect } from 'next/navigation';
import { AdminShell } from '@/components/admin/admin-shell';
import { ReauthProvider } from '@/components/admin/reauth-provider';
import { SessionProvider } from '@/components/admin/session-provider';
import { serverGetOptional } from '@/lib/server-api';
import type { SessionResponse } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * Gate for everything behind sign-in.
 *
 * This is a convenience, not the security boundary — the API re-checks the
 * session and the permission on every single request, so a forged render here
 * would still get nothing back.
 */
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await serverGetOptional<SessionResponse>('/api/v1/admin/auth/session');

  if (!session || !session.authenticated) redirect('/sign-in');

  return (
    <SessionProvider initial={{ admin: session.admin, store: session.store }}>
      <ReauthProvider mfaEnabled={session.admin.mfaEnabled}>
        <AdminShell>{children}</AdminShell>
      </ReauthProvider>
    </SessionProvider>
  );
}

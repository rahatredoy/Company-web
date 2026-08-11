import { redirect } from 'next/navigation';
import { AdminShell } from '@/components/admin/admin-shell';
import { serverGetOptional } from '@/lib/server-api';
import type { AdminSessionState } from '@/lib/types';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  // `/session` never 401s, so a partial or revoked session resolves to a real
  // state instead of an ambiguous null — this is what stops the redirect loop.
  const session = await serverGetOptional<AdminSessionState>('/api/v1/admin/session');
  if (!session || session.state !== 'authenticated') redirect('/sign-in');

  const counts = await serverGetOptional<{ unread: number }>('/api/v1/admin/notifications/counts');

  return (
    <AdminShell admin={session.admin} unreadCount={counts?.unread ?? 0}>
      {children}
    </AdminShell>
  );
}

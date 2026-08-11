import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AdminSignInForm } from './sign-in-form';
import { AdminLogo } from '@/components/admin/admin-sidebar';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { Card, CardContent } from '@/components/ui/card';
import { serverGetOptional } from '@/lib/server-api';
import type { AdminSessionState } from '@/lib/types';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default async function AdminSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const { next, reason } = await searchParams;

  // Ask the API what the session really is. A null here means the API is
  // unreachable, in which case falling through to the password form is right.
  const session = await serverGetOptional<AdminSessionState>('/api/v1/admin/session');
  if (session?.state === 'authenticated') redirect(next ?? '/dashboard');

  const resuming = session?.state === 'otp_required';

  return (
    <div className="relative isolate grid min-h-dvh place-items-center overflow-hidden px-6 py-12">
      <div className="glow-primary pointer-events-none absolute inset-x-0 top-0 h-96" aria-hidden />

      <div className="absolute top-5 right-5">
        <ThemeToggle />
      </div>

      <div className="relative w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <AdminLogo />
        </div>

        <Card>
          <CardContent className="p-6 sm:p-8">
            <AdminSignInForm
              nextPath={next}
              initialStage={resuming ? 'code' : 'credentials'}
              pendingEmail={resuming ? session.email : undefined}
              notice={reason === 'expired' ? 'Your session expired. Sign in again.' : undefined}
            />
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          This panel is for platform staff only. Client accounts sign in on the public website.
        </p>
      </div>
    </div>
  );
}

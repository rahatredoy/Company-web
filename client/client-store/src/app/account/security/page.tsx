import type { Metadata } from 'next';
import Link from 'next/link';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { getCustomer } from '@/lib/api/account';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export const metadata: Metadata = { title: 'Security', robots: { index: false, follow: false } };

/**
 * Account security.
 *
 * Password change and email change both go through the reset flow rather than
 * being edited in place: the reset link proves control of the inbox, which is
 * the only thing that makes either change safe from a session someone else has
 * got hold of.
 */
export default async function SecurityPage() {
  const customer = await getCustomer();
  if (!customer) return null;

  return (
    <>
      <h1 className="text-2xl font-semibold sm:text-3xl">Security</h1>
      <p className="mt-2 text-muted">How you sign in, and where you are signed in.</p>

      <div className="mt-8 space-y-4">
        <Card
          icon={KeyRound}
          title="Password"
          description="We will email you a link to set a new one. The link is valid for an hour and can be used once."
          action={
            <Button asChild variant="outline">
              <Link href="/forgot-password">Change password</Link>
            </Button>
          }
        />

        <Card
          icon={Mail}
          title="Email address"
          description={
            <>
              Signing in with{' '}
              <span className="font-medium text-foreground">{customer.email}</span>.{' '}
              {customer.emailVerified ? 'Verified.' : 'Not verified yet.'}
            </>
          }
          action={
            customer.emailVerified ? (
              <Button asChild variant="outline" disabled>
                <span>Verified</span>
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link href="/verify-email">Verify</Link>
              </Button>
            )
          }
        />

        <Card
          icon={ShieldCheck}
          title="Signed-in devices"
          description="Signing out here ends this session. Changing your password signs you out everywhere."
          action={
            <form action="/api/auth/logout" method="post">
              <Button type="submit" variant="outline">
                Sign out
              </Button>
            </form>
          }
        />
      </div>

      <Alert tone="info" className="mt-8" title="A note on how we store things">
        We never see your full card number — payments go straight to our provider and we keep only a
        token and the last four digits. Your password is stored hashed and cannot be read back by
        anyone here, including us.
      </Alert>
    </>
  );
}

function Card({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof KeyRound;
  title: string;
  description: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <section className="flex flex-wrap items-start justify-between gap-4 rounded-(--radius-card) border border-border bg-surface p-5">
      <div className="flex min-w-0 flex-1 gap-3">
        <Icon className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted">{description}</p>
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </section>
  );
}

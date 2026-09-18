import type { Metadata } from 'next';
import Link from 'next/link';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { getCustomer } from '@/lib/api/account';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Security'), robots: { index: false, follow: false } };
}

/**
 * Account security.
 *
 * Password change and email change both go through the reset flow rather than
 * being edited in place: the reset link proves control of the inbox, which is
 * the only thing that makes either change safe from a session someone else has
 * got hold of.
 */
export default async function SecurityPage() {
  const [customer, t] = await Promise.all([getCustomer(), getT()]);
  if (!customer) return null;

  return (
    <>
      <h1 className="sr-only">{t('Security')}</h1>

      <div className="space-y-4">
        <Card
          icon={KeyRound}
          title={t('Password')}
          description={t(
            'We will email you a link to set a new one. The link is valid for an hour and can be used once.',
          )}
          action={
            <Button asChild variant="outline">
              <Link href="/forgot-password">{t('Change password')}</Link>
            </Button>
          }
        />

        <Card
          icon={Mail}
          title={t('Email address')}
          description={
            customer.email ? (
              <>
                {t.rich('Signing in with {email}.', {
                  email: <span className="font-medium text-foreground">{customer.email}</span>,
                })}{' '}
                {customer.emailVerified ? t('Verified.') : t('Not verified yet.')}
              </>
            ) : (
              t.rich(
                'You signed up with {phone}. Adding an email means order confirmations have somewhere to go.',
                {
                  phone: (
                    <span className="font-medium text-foreground">
                      {customer.phone ?? t('a phone number')}
                    </span>
                  ),
                },
              )
            )
          }
          action={
            !customer.email ? (
              <Button asChild variant="outline" disabled>
                <span>{t('Not set')}</span>
              </Button>
            ) : customer.emailVerified ? (
              <Button asChild variant="outline" disabled>
                <span>{t('Verified')}</span>
              </Button>
            ) : (
              <Button asChild variant="outline">
                <Link href="/verify-email">{t('Verify')}</Link>
              </Button>
            )
          }
        />

        <Card
          icon={ShieldCheck}
          title={t('Signed-in devices')}
          description={t(
            'Signing out here ends this session. Changing your password signs you out everywhere.',
          )}
          action={
            <form action="/api/auth/logout" method="post">
              <Button type="submit" variant="outline">
                {t('Sign out')}
              </Button>
            </form>
          }
        />
      </div>

      <Alert tone="info" className="mt-8" title={t('A note on how we store things')}>
        {t(
          'We never see your full card number — payments go straight to our provider and we keep only a token and the last four digits. Your password is stored hashed and cannot be read back by anyone here, including us.',
        )}
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

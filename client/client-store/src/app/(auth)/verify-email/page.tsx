import type { Metadata } from 'next';
import Link from 'next/link';
import { MailCheck } from 'lucide-react';
import { AuthCard } from '@/components/auth/auth-card';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Verify your email'),
    robots: { index: false, follow: false },
  };
}

/**
 * Email verification landing.
 *
 * The link in the email carries a token; arriving without one means someone
 * opened the page directly, which is a different situation and gets a different
 * message rather than a spurious failure.
 */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; status?: string }>;
}) {
  const { token, status } = await searchParams;
  const t = await getT();
  const verified = status === 'verified';
  const failed = Boolean(token) && !verified;

  return (
    <AuthCard
      title={verified ? t('Email verified') : t('Verify your email')}
      description={
        verified
          ? t('Thank you — your address is confirmed.')
          : t('We sent a link to the address you signed up with. Open it to confirm your account.')
      }
      footer={
        <Link href="/contact" className="font-medium text-primary hover:underline">
          {t('Not getting the email? Contact us')}
        </Link>
      }
    >
      {verified ? (
        <Button asChild size="lg" className="w-full">
          <Link href="/account">{t('Go to your account')}</Link>
        </Button>
      ) : failed ? (
        <Alert tone="warning" title={t('That link did not work')}>
          {t(
            'Verification links expire after 24 hours and can only be used once. Sign in and we will send a fresh one.',
          )}
        </Alert>
      ) : (
        <div className="flex items-start gap-3 rounded-(--radius-card) bg-surface-alt p-4 text-sm text-muted">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
          <p>
            {t(
              'Check your spam folder if it has not arrived within a few minutes — first emails from a new shop often land there.',
            )}
          </p>
        </div>
      )}
    </AuthCard>
  );
}

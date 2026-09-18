import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';
import { ForgotPasswordForm } from '@/components/auth/password-reset-forms';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Forgot your password'),
    robots: { index: false, follow: true },
  };
}

export default async function ForgotPasswordPage() {
  const t = await getT();

  return (
    <AuthCard
      title={t('Forgot your password?')}
      description={t('Enter your email address and we will send you a link to set a new one.')}
      footer={t.rich('Remembered it? {signIn}', {
        signIn: (
          <Link href="/login" className="font-medium text-primary hover:underline">
            {t('Sign in')}
          </Link>
        ),
      })}
    >
      <ForgotPasswordForm />
    </AuthCard>
  );
}

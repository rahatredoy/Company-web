import type { Metadata } from 'next';
import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';
import { ResetPasswordForm } from '@/components/auth/password-reset-forms';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Set a new password'),
    robots: { index: false, follow: false },
  };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const t = await getT();

  return (
    <AuthCard
      title={t('Set a new password')}
      description={t('Choose something you have not used elsewhere.')}
      footer={
        <Link href="/login" className="font-medium text-primary hover:underline">
          {t('Back to sign in')}
        </Link>
      }
    >
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCustomer } from '@/lib/api/account';
import { getStoreConfig } from '@/lib/api/store';
import { AuthCard } from '@/components/auth/auth-card';
import { SignInMethods } from '@/components/auth/sign-in-methods';
import { Alert } from '@/components/ui/alert';
import { getT } from '@/lib/i18n/server';
import { safeRedirectPath } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Sign in'),
    robots: { index: false, follow: true },
  };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;

  // Someone already signed in has nothing to do here.
  const customer = await getCustomer();
  if (customer) redirect(safeRedirectPath(next, '/account'));

  const [config, t] = await Promise.all([getStoreConfig(), getT()]);

  return (
    <AuthCard
      title={t('Sign in')}
      description={t('Your orders, addresses and returns, all in one place.')}
      footer={t.rich('New here? {createAccount}', {
        createAccount: (
          <Link
            href={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}
            className="font-medium text-primary hover:underline"
          >
            {t('Create an account')}
          </Link>
        ),
      })}
    >
      {/*
        The only thing that sends anyone back here with `?error=google`. Every
        way that flow can fail — the shopper pressed cancel, the state expired,
        Google refused, the API was down — lands on the same message, because
        telling them apart would say more about the shop's configuration than
        about anything they can act on.
      */}
      {error === 'google' ? (
        <Alert tone="warning" title={t('That did not work')} className="mb-6">
          {t(
            'We could not finish signing you in with Google. Try again, or use your phone number or email below.',
          )}
        </Alert>
      ) : null}

      <SignInMethods next={next} auth={config.auth} mode="login" />
    </AuthCard>
  );
}

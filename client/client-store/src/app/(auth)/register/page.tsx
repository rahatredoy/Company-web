import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCustomer } from '@/lib/api/account';
import { getStoreConfig } from '@/lib/api/store';
import { AuthCard } from '@/components/auth/auth-card';
import { SignInMethods } from '@/components/auth/sign-in-methods';
import { getT } from '@/lib/i18n/server';
import { safeRedirectPath } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return {
    title: t('Create an account'),
    robots: { index: false, follow: true },
  };
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  const customer = await getCustomer();
  if (customer) redirect(safeRedirectPath(next, '/account'));

  const [config, t] = await Promise.all([getStoreConfig(), getT()]);

  return (
    <AuthCard
      title={t('Create an account')}
      // No longer "optional — you can check out as a guest": placing an order
      // needs an account now, and a page that says otherwise is a promise the
      // checkout will break.
      description={t('You need one to place an order. It also saves your addresses and makes returns one click.')}
      footer={t.rich('Already have one? {signIn}', {
        signIn: (
          <Link
            href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
            className="font-medium text-primary hover:underline"
          >
            {t('Sign in')}
          </Link>
        ),
      })}
    >
      <SignInMethods next={next} auth={config.auth} mode="register" />
    </AuthCard>
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCustomer } from '@/lib/api/account';
import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';
import { safeRedirectPath } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: true },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  // Someone already signed in has nothing to do here.
  const customer = await getCustomer();
  if (customer) redirect(safeRedirectPath(next, '/account'));

  return (
    <AuthCard
      title="Sign in"
      description="Your orders, addresses and returns, all in one place."
      footer={
        <>
          New here?{' '}
          <Link
            href={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}
            className="font-medium text-primary hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <LoginForm next={next} />
    </AuthCard>
  );
}

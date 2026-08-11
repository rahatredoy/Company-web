import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCustomer } from '@/lib/api/account';
import { AuthCard } from '@/components/auth/auth-card';
import { RegisterForm } from '@/components/auth/register-form';
import { safeRedirectPath } from '@/lib/utils';

export const metadata: Metadata = {
  title: 'Create an account',
  robots: { index: false, follow: true },
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  const customer = await getCustomer();
  if (customer) redirect(safeRedirectPath(next, '/account'));

  return (
    <AuthCard
      title="Create an account"
      description="Optional — you can check out as a guest. An account saves your addresses and makes returns one click."
      footer={
        <>
          Already have one?{' '}
          <Link
            href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'}
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm next={next} />
    </AuthCard>
  );
}

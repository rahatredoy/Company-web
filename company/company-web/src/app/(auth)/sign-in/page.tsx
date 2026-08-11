import { Suspense } from 'react';
import type { Metadata } from 'next';
import { SignInForm } from './sign-in-form';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to manage your store, subscription and billing.',
};

export default function SignInPage() {
  return (
    <div className="space-y-7">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">
          Sign in to manage your store, subscription and billing.
        </p>
      </header>

      <Suspense fallback={<Skeleton className="h-80 w-full" />}>
        <SignInForm />
      </Suspense>
    </div>
  );
}

import { Suspense } from 'react';
import type { Metadata } from 'next';
import { RegisterForm } from './register-form';
import { Skeleton } from '@/components/ui/skeleton';
import { getPublicSettings } from '@/lib/public-data';

export const metadata: Metadata = {
  title: 'Create your account',
  description: 'Start your free trial and launch your online store in minutes.',
};

export default async function RegisterPage() {
  const settings = await getPublicSettings();

  return (
    <div className="space-y-7">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          Start your {settings.trialDays}-day free trial — billed at 0.00, nothing charged today.
        </p>
      </header>

      <Suspense fallback={<Skeleton className="h-[32rem] w-full" />}>
        <RegisterForm />
      </Suspense>
    </div>
  );
}

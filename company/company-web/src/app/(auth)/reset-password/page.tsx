import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ResetPasswordForm } from './reset-password-form';
import { Skeleton } from '@/components/ui/skeleton';

export const metadata: Metadata = {
  title: 'Set a new password',
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ResetPasswordForm />
    </Suspense>
  );
}

import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/server';
import { ResetPasswordForm } from './reset-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Reset password') };
}
export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <ResetPasswordForm token={token ?? ''} />;
}

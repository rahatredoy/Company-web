import type { Metadata } from 'next';
import { getT } from '@/lib/i18n/server';
import { ForgotPasswordForm } from './forgot-password-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Forgot password') };
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}

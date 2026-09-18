import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getT } from '@/lib/i18n/server';
import { serverGetOptional } from '@/lib/server-api';
import type { SessionResponse } from '@/lib/types';
import { SignInForm } from './sign-in-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Sign in') };
}
export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  const session = await serverGetOptional<SessionResponse>('/api/v1/admin/auth/session');
  if (session?.authenticated) redirect('/dashboard');

  // A refresh mid-challenge must land back on the code form, not the password
  // form — otherwise the user re-enters a password that is already accepted.
  const mfaPending = Boolean(session && !session.authenticated && session.mfaPending);

  return <SignInForm mfaPending={mfaPending} />;
}

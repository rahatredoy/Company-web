import type { Metadata } from 'next';
import { getCustomer } from '@/lib/api/account';
import { ProfileForm } from '@/components/account/profile-form';

export const metadata: Metadata = { title: 'Profile', robots: { index: false, follow: false } };

export default async function ProfilePage() {
  const customer = await getCustomer();
  // The layout already redirects a signed-out visitor; this satisfies the type.
  if (!customer) return null;

  return (
    <>
      <h1 className="text-2xl font-semibold sm:text-3xl">Profile</h1>
      <p className="mt-2 text-muted">Your details, and what we may email you about.</p>

      <div className="mt-8 max-w-lg">
        <ProfileForm customer={customer} />
      </div>
    </>
  );
}
